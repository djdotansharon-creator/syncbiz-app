import { NextRequest, NextResponse } from "next/server";
import { requireWorkspaceAdmin } from "@/lib/auth-helpers";
import { isJoinEnvEnabled } from "@/lib/join-by-code";
import { JoinError, decideJoinRequest } from "@/lib/join-by-code-store";
import { EntitlementLimitError } from "@/lib/entitlement-limits";
import { extractClientIp } from "@/lib/admin/tenant-audit";

/** Approve (with a role) or reject one request. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!isJoinEnvEnabled()) return NextResponse.json({ error: "disabled" }, { status: 404 });
  const guard = await requireWorkspaceAdmin();
  if (!guard) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { id } = await ctx.params;
    const b = (await req.json().catch(() => ({}))) as { decision?: unknown; role?: unknown };
    if (b.decision !== "approve" && b.decision !== "reject") return NextResponse.json({ error: "decision_required" }, { status: 400 });
    const out = await decideJoinRequest({ workspaceId: guard.workspaceId, requestId: id, actorUserId: guard.userId, decision: b.decision, role: b.role, ip: extractClientIp(req) });
    return NextResponse.json(out);
  } catch (e) {
    if (e instanceof JoinError) return NextResponse.json({ error: e.code }, { status: e.httpStatus });
    if (e instanceof EntitlementLimitError) return NextResponse.json({ error: "limit", message: e.message }, { status: 403 });
    console.error("[api/join/requests/id] failed", e instanceof Error ? e.message : String(e));
    return NextResponse.json({ error: "other" }, { status: 500 });
  }
}
