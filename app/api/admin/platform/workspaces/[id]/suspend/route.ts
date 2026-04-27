/**
 * POST /api/admin/platform/workspaces/[id]/suspend
 *
 * Platform-admin (`SUPER_ADMIN`) action: mark a workspace as
 * `SUSPENDED`. Body is optional `{ reason?: string }`.
 *
 * V1 scope (Week 2):
 * - Writes to `WorkspaceEntitlement` and `PlatformAuditLog` happen in a
 *   single Prisma transaction so partial failures cannot leave the audit
 *   log out of sync with the actual status.
 * - This route does NOT enforce the suspension on workspace members
 *   (no middleware, no suspended page yet — that ships in Week 3 behind
 *   a feature flag, per the V1 audit §6).
 * - Idempotent: suspending an already-suspended workspace returns 200
 *   with no new audit row.
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
        select: { id: true, status: true, suspendedAt: true, suspendedReason: true },
      });
      if (!entitlement) {
        // Backfill should have created one. If it's missing, surface an
        // explicit 409 — it means manual DB cleanup is needed before
        // mutating state. We don't auto-create here to avoid masking
        // schema drift.
        return { kind: "no_entitlement" as const };
      }

      if (entitlement.status === "SUSPENDED") {
        // Idempotent: already suspended → no state change, no audit row.
        return { kind: "already_suspended" as const, entitlement };
      }

      const previousStatus = entitlement.status;
      const updated = await tx.workspaceEntitlement.update({
        where: { workspaceId },
        data: {
          status: "SUSPENDED",
          suspendedAt: new Date(),
          suspendedReason: reason,
        },
      });

      await writePlatformAuditLog(tx, {
        action: "workspace.suspend",
        actorUserId: admin.id,
        targetWorkspaceId: workspaceId,
        ipAddress,
        metadata: {
          workspaceName: ws.name,
          previousStatus,
          reason,
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
    if (result.kind === "already_suspended") {
      return NextResponse.json(
        { ok: true, alreadySuspended: true, entitlement: result.entitlement },
        { status: 200 },
      );
    }
    return NextResponse.json({ ok: true, entitlement: result.entitlement }, { status: 200 });
  } catch (e) {
    console.error("[admin/platform/suspend] error:", e);
    return NextResponse.json({ error: "Failed to suspend workspace" }, { status: 500 });
  }
}
