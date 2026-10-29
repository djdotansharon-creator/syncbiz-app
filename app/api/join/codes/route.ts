import { NextRequest, NextResponse } from "next/server";
import { requireWorkspaceAdmin } from "@/lib/auth-helpers";
import { isJoinEnvEnabled } from "@/lib/join-by-code";
import { JoinError, createJoinCode } from "@/lib/join-by-code-store";
import { extractClientIp } from "@/lib/admin/tenant-audit";

/** A workspace admin makes a one-time join code (shown once; only its hash is stored). */
export async function POST(req: NextRequest) {
  if (!isJoinEnvEnabled()) return NextResponse.json({ error: "disabled" }, { status: 404 });
  const guard = await requireWorkspaceAdmin();
  if (!guard) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const out = await createJoinCode({ workspaceId: guard.workspaceId, actorUserId: guard.userId, ip: extractClientIp(req) });
    return NextResponse.json(out, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof JoinError) return NextResponse.json({ error: e.code }, { status: e.httpStatus });
    console.error("[api/join/codes] failed", e instanceof Error ? e.message : String(e));
    return NextResponse.json({ error: "other" }, { status: 500 });
  }
}
