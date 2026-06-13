import { NextResponse } from "next/server";
import { resolveStreamerDeviceByToken, touchStreamerDeviceLastSeen } from "@/lib/streamer-device-store";

const STREAMER_SESSION_COOKIE = "syncbiz-streamer-session";
const COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 365;

/** Validates device token and sets a long-lived httpOnly marker cookie for /streamer middleware bypass. */
export async function POST(request: Request) {
  let body: { deviceToken?: unknown };
  try {
    body = (await request.json()) as { deviceToken?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const deviceToken = typeof body.deviceToken === "string" ? body.deviceToken.trim() : "";
  if (!deviceToken) {
    return NextResponse.json({ error: "deviceToken required" }, { status: 400 });
  }

  const device = await resolveStreamerDeviceByToken(deviceToken);
  if (!device) {
    return NextResponse.json({ error: "Invalid or revoked device" }, { status: 401 });
  }

  await touchStreamerDeviceLastSeen(device.deviceId);

  const response = NextResponse.json({
    ok: true,
    branchId: device.branchId,
    workspaceId: device.workspaceId,
    deviceId: device.deviceId,
  });

  response.cookies.set(STREAMER_SESSION_COOKIE, device.deviceId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SEC,
  });

  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(STREAMER_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
