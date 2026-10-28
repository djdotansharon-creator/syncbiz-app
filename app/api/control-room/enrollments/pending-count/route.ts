import { NextResponse } from "next/server";
import { requireEnrollmentCaller } from "@/lib/device-enrollment-auth";
import { countPendingForActor } from "@/lib/device-enrollment-store";
import { isEnrollmentEnvEnabled } from "@/lib/device-enrollment";

/** The red circle on the Control Room tab and the "New requests" tile: how many open requests THIS person may decide (+ whether the server has the feature at all and whether this person is the main admin).
 *  `{ enabled:false, count:0 }` while the feature is off or for someone who decides nothing — and then the table is never touched. */
export async function GET() {
  const auth = await requireEnrollmentCaller();
  if (!auth.ok) return NextResponse.json({ available: false, enabled: false, count: 0, canDecide: false, isAdmin: false }, { headers: { "Cache-Control": "no-store" } });
  const { caller } = auth;
  try {
    const r = await countPendingForActor({ workspaceId: caller.workspaceId, actor: caller.actor });
    return NextResponse.json({ ...r, available: isEnrollmentEnvEnabled(), canDecide: caller.actor.isAdmin || caller.actor.isManager, isAdmin: caller.actor.isAdmin }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[device-enrollment] pending count failed", e instanceof Error ? e.message : String(e));
    return NextResponse.json({ available: false, enabled: false, count: 0, canDecide: false, isAdmin: false }, { headers: { "Cache-Control": "no-store" } });
  }
}
