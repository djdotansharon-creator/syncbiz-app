import { NextResponse } from "next/server";

/**
 * POST /api/commands/stop-local — DISABLED for pilot.
 *
 * Previously ran `taskkill /IM winamp.exe /F`. Killing Winamp is no longer meaningful
 * because SyncBiz never launches Winamp in the first place (see
 * app/api/commands/play-local/route.ts). The in-app player owns stop().
 */
export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      disabled: true,
      error: "Local OS stop is disabled. Use the in-app player stop().",
    },
    { status: 410 },
  );
}
