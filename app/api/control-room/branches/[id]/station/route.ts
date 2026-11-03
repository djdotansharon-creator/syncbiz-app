import { NextRequest, NextResponse } from "next/server";
import { requireBranchManager } from "@/lib/control-room-auth";
import { BranchInputError, removeBranchStation } from "@/lib/branch-management";
import { extractClientIp } from "@/lib/admin/tenant-audit";

/**
 * Control Room — take the PLAYER (station) off a branch of THIS organization (owner only; body `{ confirmName }` = the branch's name). Refusals answer 409 (400 for a wrong name) with a
 * `code` the screen words itself; the answer is `{ ok, stations, designations }`. The branch itself stays — deleting it is a separate step (DELETE /api/control-room/branches/[id]).
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireBranchManager();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { confirmName?: unknown };
  try {
    const removed = await removeBranchStation(auth.workspaceId, id, { userId: auth.userId, confirmName: body?.confirmName, ipAddress: extractClientIp(req) });
    return NextResponse.json({ ok: true, ...removed });
  } catch (e) {
    if (e instanceof BranchInputError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    console.error("[control-room/branches] remove station failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Could not remove the player." }, { status: 500 });
  }
}
