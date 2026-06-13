import { NextResponse } from "next/server";

/**
 * POST /api/commands/play-local — DISABLED for pilot.
 *
 * This route previously shelled out via `cmd /c start "" "<path>"` and could launch
 * Winamp or any other OS-registered default audio app. That violates the product rule
 * "SyncBiz never opens external players". All playback now runs through
 * `PlaybackProvider` (Desktop MPV via `window.syncbizDesktop`, or HTML/YT embeds in
 * browser, or routed to the MASTER device via WS `PLAY_SOURCE` when this client is in
 * branch CONTROL mode).
 *
 * The route is left in place only so any cached client that still POSTs here gets a
 * clean 410 with no side effect.
 */
export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      disabled: true,
      error:
        "Local OS shell-out is disabled. Use the in-app player (SyncBiz Desktop MPV or browser embed).",
    },
    { status: 410 },
  );
}
