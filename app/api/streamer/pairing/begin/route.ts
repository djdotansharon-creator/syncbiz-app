import { NextResponse } from "next/server";
import { beginStreamerPairing } from "@/lib/streamer-device-store";

/** Public: streamer device requests a short pairing code (no user login). */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { deviceId?: unknown };
    const result = await beginStreamerPairing(body.deviceId);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Pairing failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
