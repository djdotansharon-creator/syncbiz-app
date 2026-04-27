/**
 * DELETE /api/admin/platform/users/[id]/delete
 *
 * Safe hard-delete of a non-owner `User` who is not the platform actor
 * and not `SUPER_ADMIN`. Eligible when the user does **not** own any
 * workspace — ownership would require transfer/delete of the workspace
 * elsewhere (explicit workspace-level action) and is out of scope here.
 *
 * If the user is only a *member* (or has branch rows) in other people’s
 * workspaces, this route **strips** all `UserBranchAssignment` and
 * `WorkspaceMember` rows for that `userId` in the *same* transaction, then
 * deletes the `User`. Pure orphans (0 members, 0 branches) skip the strip.
 *
 * Blockers (checked before any mutation): `AuditLog` count, guest sessions,
 * AI DJ sessions — same as the original orphan path (FK / product safety).
 *
 * Strong confirmation: JSON body must include `confirmEmail` —
 * case-insensitive match to the user’s email (trimmed).
 *
 * Audit: `user.safe_account_delete` with `membershipsRemoved` and
 * `branchAssignmentsRemoved` counts.
 *
 * @see `user.orphan_delete` — legacy action string in older `PlatformAuditLog` rows
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSuperAdminOrNull } from "@/lib/auth/guards";
import { extractClientIp, writePlatformAuditLog } from "@/lib/admin/platform-audit";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await getSuperAdminOrNull();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: userId } = await params;
  if (!userId?.trim()) {
    return NextResponse.json({ error: "Missing user id" }, { status: 400 });
  }

  if (userId === admin.id) {
    return NextResponse.json(
      { error: "You cannot delete your own account", code: "SELF" },
      { status: 400 },
    );
  }

  let confirmEmail: string | undefined;
  try {
    const body = (await req.json().catch(() => ({}))) as {
      confirmEmail?: unknown;
    };
    if (typeof body.confirmEmail === "string") {
      confirmEmail = body.confirmEmail.trim().toLowerCase();
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!confirmEmail) {
    return NextResponse.json(
      { error: "confirmEmail is required (must match the user’s email)" },
      { status: 400 },
    );
  }

  const ipAddress = extractClientIp(req);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({
        where: { id: userId },
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
      if (!target) {
        return { kind: "not_found" as const };
      }
      if (target.email.toLowerCase() !== confirmEmail) {
        return { kind: "email_mismatch" as const };
      }
      if (target.role === "SUPER_ADMIN") {
        return { kind: "is_super_admin" as const };
      }

      const c = target._count;
      if (c.ownedWorkspaces > 0) {
        return {
          kind: "is_workspace_owner" as const,
        };
      }
      if (c.auditLogs > 0) {
        return {
          kind: "blocked" as const,
          reason: "user has workspace-scoped audit log history (DB Restrict) — reassign or archive elsewhere first",
        };
      }
      if (c.createdGuestSessions > 0) {
        return { kind: "blocked" as const, reason: "user has created guest sessions" };
      }
      if (c.aiDjSessions > 0) {
        return { kind: "blocked" as const, reason: "user has AI DJ session rows" };
      }

      const mCount = c.memberships;
      const bCount = c.branchAssignments;
      if (mCount > 0) {
        await tx.workspaceMember.deleteMany({ where: { userId } });
      }
      if (bCount > 0) {
        await tx.userBranchAssignment.deleteMany({ where: { userId } });
      }

      await writePlatformAuditLog(tx, {
        action: "user.safe_account_delete",
        actorUserId: admin.id,
        targetWorkspaceId: null,
        ipAddress,
        metadata: {
          targetUserId: target.id,
          targetEmail: target.email,
          membershipsRemoved: mCount,
          branchAssignmentsRemoved: bCount,
        },
      });

      await tx.user.delete({ where: { id: userId } });
      return { kind: "ok" as const, email: target.email, membershipsRemoved: mCount, branchRemoved: bCount };
    });

    if (result.kind === "not_found") {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    if (result.kind === "email_mismatch") {
      return NextResponse.json(
        { error: "confirmEmail does not match this user", code: "EMAIL_MISMATCH" },
        { status: 400 },
      );
    }
    if (result.kind === "is_super_admin") {
      return NextResponse.json(
        { error: "Cannot delete a SUPER_ADMIN user", code: "IS_SUPER_ADMIN" },
        { status: 403 },
      );
    }
    if (result.kind === "is_workspace_owner") {
      return NextResponse.json(
        {
          error:
            "Cannot delete: this user owns at least one workspace. Use workspace-level tools to transfer or remove the workspace first; deleting an owner is never implicit here.",
          code: "IS_WORKSPACE_OWNER",
        },
        { status: 400 },
      );
    }
    if (result.kind === "blocked") {
      return NextResponse.json(
        { error: `Not eligible for safe delete: ${result.reason}`, code: "NOT_ELIGIBLE" },
        { status: 400 },
      );
    }
    return NextResponse.json(
      {
        ok: true,
        deleted: true,
        email: result.email,
        membershipsRemoved: result.membershipsRemoved,
        branchAssignmentsRemoved: result.branchRemoved,
      },
      { status: 200 },
    );
  } catch (e) {
    console.error("[admin/platform/users/delete] error:", e);
    return NextResponse.json({ error: "Failed to delete user" }, { status: 500 });
  }
}
