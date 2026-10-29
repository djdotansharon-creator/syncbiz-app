import { NextResponse } from "next/server";
import { requireWorkspaceAdmin } from "@/lib/auth-helpers";
import { isJoinEnvEnabled } from "@/lib/join-by-code";
import { listJoinRequests } from "@/lib/join-by-code-store";

/** The people waiting for a workspace admin's decision. */
export async function GET() {
  if (!isJoinEnvEnabled()) return NextResponse.json({ enabled: false, requests: [] }, { headers: { "Cache-Control": "no-store" } });
  const guard = await requireWorkspaceAdmin();
  if (!guard) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    return NextResponse.json({ enabled: true, requests: await listJoinRequests(guard.workspaceId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[api/join/requests] failed", e instanceof Error ? e.message : String(e));
    return NextResponse.json({ error: "other" }, { status: 500 });
  }
}
