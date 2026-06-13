import { NextResponse } from "next/server";
import { createWsToken } from "@/lib/auth-ws-token";
import {
  resolveStreamerDeviceByToken,
  touchStreamerDeviceLastSeen,
} from "@/lib/streamer-device-store";

function readDeviceToken(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    const token = auth.slice(7).trim();
    if (token) return token;
  }
  return null;
}

/**
 * Mint short-lived WS REGISTER token for a paired branch streamer device.
 * Accepts `Authorization: Bearer <deviceToken>` only — not user session cookies.
 */
export async function GET(request: Request) {
  const deviceToken = readDeviceToken(request);
  if (!deviceToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const device = await resolveStreamerDeviceByToken(deviceToken);
  if (!device) {
    return NextResponse.json({ error: "Invalid or revoked device" }, { status: 401 });
  }

  try {
    await touchStreamerDeviceLastSeen(device.deviceId);
    const token = createWsToken(device.branchUserId);
    return NextResponse.json({
      token,
      branchId: device.branchId,
      workspaceId: device.workspaceId,
      devicePurpose: device.devicePurpose,
    });
  } catch {
    return NextResponse.json({ error: "Token creation failed" }, { status: 500 });
  }
}
