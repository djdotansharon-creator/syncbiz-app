/**
 * POST /api/admin/platform/workspaces/[id]/unsuspend
 *
 * Platform-admin (`SUPER_ADMIN`) action: lift suspension. Returns the
 * workspace to `TRIALING` if `trialEndsAt` is still in the future,
 * otherwise to `ACTIVE`. Clears `suspendedAt` and `suspendedReason`.
 *
 * Idempotent: unsuspending a workspace that isn't suspended returns 200
 * with no audit row.
 *
 * V1 scope: no middleware/page enforcement is involved — this route only
 * mutates the entitlement row and logs the action. Same transactional
 * guarantee as `/suspend`: status change + audit row commit together.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSuperAdminOrNull } from "@/lib/auth/guards";
import { extractClientIp, writePlatformAuditLog } from "@/lib/admin/platform-audit";

const MAX_REASON_LENGTH = 500;

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

  let reason: string | null = null;
  try {
    const body = (await req.json().catch(() => ({}))) as { reason?: unknown };
    if (typeof body.reason === "string") {
      const trimmed = body.reason.trim();
      if (trimmed.length > MAX_REASON_LENGTH) {
        return NextResponse.json(
          { error: `Reason must be ${MAX_REASON_LENGTH} characters or less` },
          { status: 400 },
        );
      }
      reason = trimmed.length > 0 ? trimmed : null;
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const ipAddress = extractClientIp(req);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const ws = await tx.workspace.findUnique({
        where: { id: workspaceId },
        select: { id: true, name: true },
      });
      if (!ws) return { kind: "not_found" as const };

      const entitlement = await tx.workspaceEntitlement.findUnique({
        where: { workspaceId },
        select: {
          id: true,
          status: true,
          trialEndsAt: true,
          suspendedAt: true,
          suspendedReason: true,
        },
      });
      if (!entitlement) {
        return { kind: "no_entitlement" as const };
      }

      if (entitlement.status !== "SUSPENDED") {
        return { kind: "not_suspended" as const, entitlement };
      }

      // Decide where to restore to: trial if it's still active, else ACTIVE.
      // We never auto-extend the trial here — the admin should use the
      // extend-trial endpoint explicitly if they want to.
      const trialStillActive =
        entitlement.trialEndsAt !== null &&
        entitlement.trialEndsAt.getTime() > Date.now();
      const restoredTo: "TRIALING" | "ACTIVE" = trialStillActive ? "TRIALING" : "ACTIVE";

      const suspendedDurationMs =
        entitlement.suspendedAt !== null
          ? Date.now() - entitlement.suspendedAt.getTime()
          : null;

      const updated = await tx.workspaceEntitlement.update({
        where: { workspaceId },
        data: {
          status: restoredTo,
          suspendedAt: null,
          suspendedReason: null,
        },
      });

      await writePlatformAuditLog(tx, {
        action: "workspace.unsuspend",
        actorUserId: admin.id,
        targetWorkspaceId: workspaceId,
        ipAddress,
        metadata: {
          workspaceName: ws.name,
          previousStatus: "SUSPENDED",
          restoredTo,
          previousReason: entitlement.suspendedReason,
          suspendedDurationMs,
          ...(reason ? { adminNote: reason } : {}),
        },
      });

      return { kind: "ok" as const, entitlement: updated };
    });

    if (result.kind === "not_found") {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }
    if (result.kind === "no_entitlement") {
      return NextResponse.json(
        { error: "Workspace has no entitlement row. Run the backfill script first." },
        { status: 409 },
      );
    }
    if (result.kind === "not_suspended") {
      return NextResponse.json(
        { ok: true, notSuspended: true, entitlement: result.entitlement },
        { status: 200 },
      );
    }
    return NextResponse.json({ ok: true, entitlement: result.entitlement }, { status: 200 });
  } catch (e) {
    console.error("[admin/platform/unsuspend] error:", e);
    return NextResponse.json({ error: "Failed to unsuspend workspace" }, { status: 500 });
  }
}
