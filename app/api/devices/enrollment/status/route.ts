import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";
import { getEnrollmentByDevice, getEnrollmentConfig, touchEnrollmentSeen } from "@/lib/device-enrollment-store";
import { toPublicStatus } from "@/lib/device-enrollment";
import { requireEnrollmentCaller } from "@/lib/device-enrollment-auth";

/**
 * Device enrollment — "what am I?" (docs/DEVICE_ENROLLMENT_DESIGN.md §5.1). POST { durableDeviceId } → { enforced:false } when enrollment is off for this workspace (the device behaves exactly as
 * before), otherwise unknown | pending | approved { role, branchIds } | rejected | revoked | expired. The same call for computers, phones and stations. No data of the account is returned.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUserFromCookies();
  const ws = (user?.tenantId ?? "").trim();
  if (!user || !ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { durableDeviceId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const id = typeof body.durableDeviceId === "string" ? body.durableDeviceId.trim() : "";
  if (id.length < 8 || id.length > 128) return NextResponse.json({ error: "invalid_device_id" }, { status: 400 });
  const cfg = await getEnrollmentConfig(ws);
  if (!cfg.enabled) return NextResponse.json({ enforced: false, status: "disabled" }, { headers: { "Cache-Control": "no-store" } });
  const row = await getEnrollmentByDevice(ws, id);
  if (row) void touchEnrollmentSeen(row.id);
  const pub = toPublicStatus(row, new Date());
  // the main admin gets the "I'm the owner" bar on the request screen (his own new computer does not wait for someone else); nobody else is told it exists
  if (pub.enforced && pub.status !== "approved") {
    const caller = await requireEnrollmentCaller();
    if (caller.ok && caller.caller.actor.isAdmin) return NextResponse.json({ ...pub, ownerAllowed: true }, { headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json(pub, { headers: { "Cache-Control": "no-store" } });
}
