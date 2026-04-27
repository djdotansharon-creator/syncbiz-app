/**
 * POST /api/admin/platform/workspaces/[id]/delete-test
 *
 * DANGER: irrecoverably removes a `Workspace` and (optionally) its owner
 * `User` in one transaction, intended for **test / sandbox** cleanup.
 *
 * Prisma: almost everything under `Workspace` is `onDelete: Cascade` —
 * members, `UserBranchAssignment` rows for that workspace, branches,
 * devices (via branch), `WorkspaceEntitlement`, billing/addons, sources,
 * playlists, playlist items, schedules, announcements, guest sessions,
 * AI DJ session trees, etc.
 *
 * Exception: `AuditLog` (workspace-scoped) is `onDelete: Restrict` on
 * the workspace, so we **must** `deleteMany` those rows *before*
 * `workspace.delete()`.
 *
 * `PlatformAuditLog` rows with `targetWorkspaceId` on this workspace get
 * `onDelete: SetNull` on the workspace FK; we write the platform audit
 * after the fact with `targetWorkspaceId: null` and full id/name in JSON.
 *
 * `removeOwnerUser` requires (preflight) that after this delete the owner
 * will have no other owned workspaces, no other memberships, no branch
 * rows, and passes the same “safe user” checks as
 * `users/[id]/delete` (not SUPER_ADMIN, not self, no user-level audit /
 * guest / AI-DJ). Otherwise the request fails **before** any mutation.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSuperAdminOrNull } from "@/lib/auth/guards";
import { extractClientIp, writePlatformAuditLog } from "@/lib/admin/platform-audit";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await getSuperAdminOrNull();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: workspaceId } = await params;
  if (!workspaceId?.trim()) {
    return NextResponse.json({ error: "Missing workspace id" }, { status: 400 });
  }

  type Body = {
    confirmName?: unknown;
    removeOwnerUser?: unknown;
  };
  let body: Body;
  try {
    body = (await req.json().catch(() => ({}))) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const confirmName = typeof body.confirmName === "string" ? body.confirmName.trim() : "";
  const removeOwnerUser = body.removeOwnerUser === true;

  const ipAddress = extractClientIp(req);

  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    include: {
      owner: {
        include: {
          _count: {
            select: {
              auditLogs: true,
              createdGuestSessions: true,
              aiDjSessions: true,
            },
          },
        },
      },
    },
  });
  if (!ws) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  if (ws.name.trim() !== confirmName) {
    return NextResponse.json(
      { error: "confirmName must match the workspace `name` (case-sensitive, surrounding spaces ignored on both sides).", code: "NAME_MISMATCH" },
      { status: 400 },
    );
  }

  const otherOwned = await prisma.workspace.count({
    where: { ownerId: ws.ownerId, id: { not: workspaceId } },
  });
  const otherMembers = await prisma.workspaceMember.count({
    where: { userId: ws.ownerId, workspaceId: { not: workspaceId } },
  });
  const otherBranch = await prisma.userBranchAssignment.count({
    where: { userId: ws.ownerId, workspaceId: { not: workspaceId } },
  });

  if (removeOwnerUser) {
    if (ws.ownerId === admin.id) {
      return NextResponse.json(
        { error: "removeOwnerUser cannot be used on a workspace you own; delete the workspace only, or use a different account.", code: "OWNER_IS_SELF" },
        { status: 400 },
      );
    }
    if (ws.owner.role === "SUPER_ADMIN") {
      return NextResponse.json(
        { error: "Cannot auto-delete a SUPER_ADMIN user. Delete the workspace only, or change the user role in the database first.", code: "OWNER_IS_SUPER_ADMIN" },
        { status: 400 },
      );
    }
    if (otherOwned > 0) {
      return NextResponse.json(
        { error: "Owner still owns other workspaces. removeOwnerUser refused.", code: "OWNER_HAS_OTHER_WORKSPACES" },
        { status: 400 },
      );
    }
    if (otherMembers > 0) {
      return NextResponse.json(
        { error: "Owner is still a member of another workspace. removeOwnerUser refused.", code: "OWNER_HAS_OTHER_MEMBERSHIPS" },
        { status: 400 },
      );
    }
    if (otherBranch > 0) {
      return NextResponse.json(
        { error: "Owner has branch rows in another workspace. removeOwnerUser refused.", code: "OWNER_HAS_OTHER_BRANCH" },
        { status: 400 },
      );
    }
    const c = ws.owner._count;
    if (c.auditLogs > 0) {
      return NextResponse.json(
        { error: "Owner has workspace audit log rows (user-side); remove owner refused.", code: "OWNER_HAS_AUDIT" },
        { status: 400 },
      );
    }
    if (c.createdGuestSessions > 0) {
      return NextResponse.json(
        { error: "Owner has created guest sessions; remove owner refused.", code: "OWNER_HAS_GUESTS" },
        { status: 400 },
      );
    }
    if (c.aiDjSessions > 0) {
      return NextResponse.json(
        { error: "Owner has AI DJ session rows; remove owner refused.", code: "OWNER_HAS_AIDJ" },
        { status: 400 },
      );
    }
  }

  const snapshot = {
    workspaceId: ws.id,
    name: ws.name,
    slug: ws.slug,
    ownerId: ws.ownerId,
    ownerEmail: ws.owner.email,
  };

  try {
    const result = await prisma.$transaction(async (tx) => {
      const al = await tx.auditLog.deleteMany({ where: { workspaceId } });
      await tx.workspace.delete({ where: { id: workspaceId } });
      let ownerDeleted = false;
      let ownerGone = false;
      if (removeOwnerUser) {
        const owner = await tx.user.findUnique({
          where: { id: snapshot.ownerId },
          include: {
            _count: {
              select: {
                ownedWorkspaces: true,
                memberships: true,
                branchAssignments: true,
                auditLogs: true,
                createdGuestSessions: true,
                aiDjSessions: true,
              },
            },
          },
        });
        if (!owner) {
          ownerGone = true;
        } else {
          const o = owner._count;
          if (o.ownedWorkspaces > 0 || o.memberships > 0 || o.branchAssignments > 0) {
            throw new Error("INVARIANT: owner has rows after workspace delete");
          }
          if (o.auditLogs > 0 || o.createdGuestSessions > 0 || o.aiDjSessions > 0) {
            throw new Error("INVARIANT: owner not safe to delete");
          }
          if (owner.role === "SUPER_ADMIN" || owner.id === admin.id) {
            throw new Error("INVARIANT: owner delete guard");
          }
          await tx.user.delete({ where: { id: owner.id } });
          ownerDeleted = true;
        }
      }

      await writePlatformAuditLog(tx, {
        action: "workspace.test_delete",
        actorUserId: admin.id,
        targetWorkspaceId: null,
        ipAddress,
        metadata: {
          ...snapshot,
          workspaceAuditLogRowsDeleted: al.count,
          removeOwnerUserRequested: removeOwnerUser,
          ownerUserDeleted: ownerDeleted,
          ownerUserAlreadyGone: ownerGone,
        },
      });

      return { alDeleted: al.count, ownerDeleted, ownerGone } as const;
    });

    return NextResponse.json(
      {
        ok: true,
        deletedWorkspaceId: snapshot.workspaceId,
        ownerUserDeleted: result.ownerDeleted,
        ownerUserAlreadyGone: result.ownerGone,
        workspaceAuditLogRowsDeleted: result.alDeleted,
      },
      { status: 200 },
    );
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("INVARIANT:")) {
      return NextResponse.json({ error: e.message, code: "INVARIANT" }, { status: 500 });
    }
    console.error("[admin/platform/workspaces/delete-test] error:", e);
    return NextResponse.json({ error: "Failed to delete workspace" }, { status: 500 });
  }
}
