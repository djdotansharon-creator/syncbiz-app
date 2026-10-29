import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";
import { EnrollmentError, submitRequest, submitRequestWithSelfApproval } from "@/lib/device-enrollment-store";
import { toPublicStatus, validateRequestInput } from "@/lib/device-enrollment";
import { clientIp, requireEnrollmentCaller } from "@/lib/device-enrollment-auth";

/**
 * Device enrollment — a device asks for a role (docs/DEVICE_ENROLLMENT_DESIGN.md §5.2). POST { durableDeviceId, role: PLAYER|REMOTE, platform, branchId?, label?, note? }.
 * Any signed-in member may ask; only a manager decides — except that an ADMIN of the workspace asking from his own device is approved at once (owner 2026-10-31: the account is his). An already-approved device keeps what it has; a pending one is refreshed.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUserFromCookies();
  const ws = (user?.tenantId ?? "").trim();
  if (!user || !ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const input = validateRequestInput(raw);
  if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 });
  const auth = await requireEnrollmentCaller();
  const args = { workspaceId: ws, userId: user.id, input: input.value, ip: clientIp(req), userAgent: req.headers.get("user-agent") ?? "" };
  try {
    // anyone who is not a member we can classify asks exactly as before; only a workspace ADMIN is settled on the spot
    const row = auth.ok ? await submitRequestWithSelfApproval({ ...args, actor: auth.caller.actor }) : await submitRequest(args);
    return NextResponse.json(toPublicStatus(row, new Date()), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof EnrollmentError) return NextResponse.json({ error: e.code }, { status: e.httpStatus });
    console.error("[device-enrollment] request failed", e instanceof Error ? e.message : String(e));
    return NextResponse.json({ error: "request_failed" }, { status: 500 });
  }
}
