import { NextResponse } from "next/server";
import { requireWorkspaceAdmin } from "@/lib/auth-helpers";
import { isJoinEnvEnabled } from "@/lib/join-by-code";
import { countPendingJoinRequests } from "@/lib/join-by-code-store";

/** How many people wait for a workspace admin's approval (the red circle). The flag first — a server with the feature off answers `{enabled:false,count:0}` without touching the database or the session. */
export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  if (!isJoinEnvEnabled()) return NextResponse.json({ enabled: false, count: 0 }, { headers });
  const guard = await requireWorkspaceAdmin();
  if (!guard) return NextResponse.json({ enabled: true, count: 0 }, { headers });
  try {
    return NextResponse.json({ enabled: true, count: await countPendingJoinRequests(guard.workspaceId) }, { headers });
  } catch (e) {
    console.error("[api/join/pending-count] failed", e instanceof Error ? e.message : String(e));
    return NextResponse.json({ enabled: true, count: 0 }, { headers });
  }
}
