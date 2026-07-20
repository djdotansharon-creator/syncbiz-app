import { NextResponse } from "next/server";

// Reads a server-only env; keep on Node runtime.
export const runtime = "nodejs";

/**
 * Whether in-app microphone song recognition (AudD) is available. Gated purely
 * on the presence of AUDD_API_TOKEN — no token, no feature. Surfaced to the
 * (client-only) mobile tree so the "Identify" button stays hidden until the
 * token is configured. Not sensitive.
 */
export async function GET() {
  return NextResponse.json({ enabled: !!(process.env.AUDD_API_TOKEN ?? "").trim() });
}
