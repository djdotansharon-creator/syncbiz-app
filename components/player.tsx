"use client";

/**
 * Legacy controller-only `<Player />` — DISABLED for pilot.
 *
 * This component used to side-effect on `usePlayback()` state by POSTing
 * `/api/commands/play-local` / `/api/commands/stop-local`, which shelled out
 * `cmd /c start "" "<path>"` (Winamp on machines where Winamp is the default
 * audio handler) / `taskkill /IM winamp.exe /F`. That violates the rule
 * "SyncBiz never opens external players".
 *
 * Audio output is now owned by:
 *   - `components/audio-player.tsx` (Desktop MPV via `window.syncbizDesktop`,
 *     or browser HTMLAudio / YT iframe).
 *   - `lib/device-player-context.tsx` when this client is in branch CONTROL —
 *     `PLAY_SOURCE` is sent to the MASTER device over WS instead.
 *
 * We render nothing and keep no effects.
 */
export function Player(): null {
  return null;
}
