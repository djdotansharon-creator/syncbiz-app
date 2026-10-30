import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";
import { autoApproveRemote, getEnrollmentByDevice, getEnrollmentConfig, touchEnrollmentSeen } from "@/lib/device-enrollment-store";
import { toPublicStatus } from "@/lib/device-enrollment";
import { clientIp } from "@/lib/device-enrollment-auth";

/**
 * Device enrollment — "what am I?" (docs/DEVICE_ENROLLMENT_DESIGN.md §5.1). POST { durableDeviceId } → { enforced:false } when enrollment is off for this workspace (the device behaves exactly as
 * before), otherwise unknown | pending | approved { role, branchIds } | rejected | revoked | expired. The same call for computers, phones and stations. No data of the account is returned.
 * A signed-in member's new browser / phone is approved as a REMOTE right here (autoApproveRemote) — there is no "I'm the owner" button any more.
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
  let row = await getEnrollmentByDevice(ws, id);
  const now = new Date();
  // owner 2026-10-31: the ACCOUNT decides — a signed-in member's new browser / phone is a Remote at once (no request screen, no form, nobody to approve). Anything it cannot settle (a device a manager revoked,
  // a suspended person, too many devices) falls through to the normal request screen below.
  if (!row || toPublicStatus(row, now).status !== "approved") {
    try {
      const auto = await autoApproveRemote({ workspaceId: ws, userId: user.id, durableDeviceId: id, userAgent: req.headers.get("user-agent") ?? "", ip: clientIp(req) });
      if (auto) row = auto;
    } catch (e) {
      console.error("[device-enrollment] auto approve failed", e instanceof Error ? e.message : String(e));
    }
  }
  if (row) void touchEnrollmentSeen(row.id);
  const pub = toPublicStatus(row, now);
  return NextResponse.json(pub, { headers: { "Cache-Control": "no-store" } });
}
