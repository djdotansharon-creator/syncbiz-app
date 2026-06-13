import { NextResponse } from "next/server";
import { getCurrentUserFromCookies, hasTenantAdminRole } from "@/lib/auth-helpers";
import { listBranchStreamerDevices, revokeBranchStreamerDevice } from "@/lib/streamer-device-store";

export async function GET() {
  const user = await getCurrentUserFromCookies();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const isAdmin = await hasTenantAdminRole(user.id);
  if (!isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const devices = await listBranchStreamerDevices(user.tenantId);
  return NextResponse.json({ devices });
}

export async function POST(request: Request) {
  const user = await getCurrentUserFromCookies();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const isAdmin = await hasTenantAdminRole(user.id);
  if (!isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { deviceId?: unknown };
  try {
    body = (await request.json()) as { deviceId?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const ok = await revokeBranchStreamerDevice(user.tenantId, body.deviceId);
  if (!ok) {
    return NextResponse.json({ error: "Device not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
