import { NextResponse } from "next/server";
import { runStopLocal } from "@/lib/play-local";
import { db } from "@/lib/store";

/**
 * POST /api/commands/stop-local
 * MVP: Stop Winamp on Windows (taskkill /IM winamp.exe /F).
 */
export async function POST() {
  console.log("[stop-local] Endpoint hit");

  const result = await runStopLocal();

  if (result.success) {
    db.addLog({
      timestamp: new Date().toISOString(),
      level: "info",
      message: "Local playback: stop command sent (taskkill winamp.exe).",
    });
    return NextResponse.json({ ok: true, message: "Stop command sent" });
  }

  db.addLog({
    timestamp: new Date().toISOString(),
    level: "error",
    message: `Local stop failed: ${result.error}`,
  });
  return NextResponse.json(
    { error: result.error },
    { status: 500 },
  );
}
