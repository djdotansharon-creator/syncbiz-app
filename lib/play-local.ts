/**
 * Legacy Windows shell-out bridge (DISABLED for pilot).
 *
 * Previously: ran `cmd /c start "" "<path>"` (opens with the OS default app — Winamp on
 * machines where Winamp is the default audio handler) and `taskkill /IM winamp.exe /F`.
 *
 * Pilot rule: SyncBiz must never open Winamp or any external player from product playback.
 * All playback is owned by `PlaybackProvider` (lib/playback-provider.tsx) which drives
 * the in-app `AudioPlayer` → MPV on Desktop, HTML audio / YouTube embed in browser. When
 * the renderer is in branch CONTROL mode, playback is routed to the MASTER device via
 * the WebSocket `PLAY_SOURCE` command, not via this bridge.
 *
 * The functions below are kept as fail-closed no-ops so any residual server route still
 * type-checks but cannot launch Winamp. The `exec()` / `child_process` import has been
 * removed entirely so an accidental import path cannot reintroduce shell-out.
 *
 * If you are looking for the canonical local playback path, see:
 *   - lib/playback-provider.tsx (`playSource`)
 *   - lib/device-player-context.tsx (`playSourceOrSend`)
 *   - components/audio-player.tsx (Desktop MPV bridge via `window.syncbizDesktop`)
 */

import type { BrowserPreference } from "@/lib/types";

const DISABLED_MESSAGE =
  "Local OS shell-out is disabled. Playback now runs only through PlaybackProvider / MPV.";

export type PlayLocalResult =
  | { success: true; command: string; fallbackUsed: boolean }
  | { success: false; error: string; command: string; fallbackUsed: boolean };

export async function runLocalPlaylist(
  _targetPath: string,
  _browserPreference: BrowserPreference = "default",
): Promise<PlayLocalResult> {
  return Promise.resolve({
    success: false,
    error: DISABLED_MESSAGE,
    command: "",
    fallbackUsed: false,
  });
}

export type StopLocalResult = { success: true } | { success: false; error: string };

export async function runStopLocal(): Promise<StopLocalResult> {
  return Promise.resolve({ success: false, error: DISABLED_MESSAGE });
}
