/**
 * POST /api/admin/platform/workspaces/[id]/extend-trial
 *
 * Platform-admin (`SUPER_ADMIN`) action: extend a workspace's trial.
 * Body: `{ days: number }` (1..365).
 *
 * Semantics:
 * - The new `trialEndsAt` is computed from `max(now, currentTrialEndsAt)`
 *   plus `days`. So "extend by 30" always grants at least 30 more days
 *   from now, even if the trial already lapsed.
 * - If the workspace is currently `ACTIVE` or `SUSPENDED`, the trial date
 *   is updated but the status is not changed. Use unsuspend separately.
 *   (We deliberately do not flip a paid `ACTIVE` workspace back to
 *   `TRIALING` here — that's a billing concern outside V1.)
 * - If the workspace is currently `TRIALING`, status remains `TRIALING`.
 *
 * Same transactional guarantee as the other Week 2 routes.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSuperAdminOrNull } from "@/lib/auth/guards";
import { extractClientIp, writePlatformAuditLog } from "@/lib/admin/platform-audit";

const MIN_DAYS = 1;
const MAX_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

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

  let days: number;
  try {
    const body = (await req.json().catch(() => ({}))) as { days?: unknown };
    const raw = body.days;
    if (typeof raw !== "number" || !Number.isFinite(raw) || !Number.isInteger(raw)) {
      return NextResponse.json(
        { error: "Body must include an integer `days`" },
        { status: 400 },
      );
    }
    if (raw < MIN_DAYS || raw > MAX_DAYS) {
      return NextResponse.json(
        { error: `\`days\` must be between ${MIN_DAYS} and ${MAX_DAYS}` },
        { status: 400 },
      );
    }
    days = raw;
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
        select: { id: true, status: true, trialEndsAt: true },
      });
      if (!entitlement) {
        return { kind: "no_entitlement" as const };
      }

      const now = Date.now();
      const baseMs =
        entitlement.trialEndsAt !== null && entitlement.trialEndsAt.getTime() > now
          ? entitlement.trialEndsAt.getTime()
          : now;
      const newTrialEndsAt = new Date(baseMs + days * DAY_MS);

      const updated = await tx.workspaceEntitlement.update({
        where: { workspaceId },
        data: { trialEndsAt: newTrialEndsAt },
      });

      await writePlatformAuditLog(tx, {
        action: "entitlement.extend_trial",
        actorUserId: admin.id,
        targetWorkspaceId: workspaceId,
        ipAddress,
        metadata: {
          workspaceName: ws.name,
          days,
          previousTrialEndsAt: entitlement.trialEndsAt?.toISOString() ?? null,
          newTrialEndsAt: newTrialEndsAt.toISOString(),
          statusUnchanged: entitlement.status,
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
    return NextResponse.json({ ok: true, entitlement: result.entitlement }, { status: 200 });
  } catch (e) {
    console.error("[admin/platform/extend-trial] error:", e);
    return NextResponse.json({ error: "Failed to extend trial" }, { status: 500 });
  }
}
