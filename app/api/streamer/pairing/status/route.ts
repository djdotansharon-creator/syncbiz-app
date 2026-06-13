import { NextResponse } from "next/server";
import { getStreamerPairingStatus } from "@/lib/streamer-device-store";

/** Public: streamer polls pairing progress and receives one-time device token when ready. */
export async function GET(request: Request) {
  const deviceId = new URL(request.url).searchParams.get("deviceId");
  const status = await getStreamerPairingStatus(deviceId);
  return NextResponse.json(status);
}
