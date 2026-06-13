/**
 * Typed no-op replacements for the legacy `/api/commands/play-local` and
 * `/api/commands/stop-local` POSTs.
 *
 * Why this file exists:
 *   - The previous Windows shell-out rail (`cmd /c start "" "<path>"` → Winamp /
 *     default OS handler; `taskkill /IM winamp.exe /F`) is permanently disabled for
 *     pilot. See lib/play-local.ts + app/api/commands/play-local/route.ts.
 *   - Several UI surfaces still had `fetch("/api/commands/play-local", …)` /
 *     `fetch("/api/commands/stop-local", …)` side effects woven into their effects
 *     and click handlers. Removing those lines outright would leave dangling
 *     `await` / `Promise.then` chains. Replacing the inline fetch with these
 *     helpers keeps control flow identical while guaranteeing **no network call
 *     and no shell-out**.
 *
 * Canonical playback now lives in:
 *   - `lib/playback-provider.tsx` (`playSource`, `playSourceWithQueue`)
 *   - `lib/device-player-context.tsx` (`playSourceOrSend` — routes to MASTER over WS
 *     when this client is in branch CONTROL mode)
 *   - `components/audio-player.tsx` (Desktop MPV via `window.syncbizDesktop`, or
 *     in-browser HTMLAudio / YT embed)
 *
 * Do NOT add network calls inside these helpers. If you find yourself wanting to,
 * you are almost certainly looking for `usePlayback()` / `useDevicePlayer()`.
 */

export type LegacyShelloutPlayLocalArgs = {
  target: string;
  browserPreference?: "default" | "chrome" | "edge" | "firefox";
};

export type LegacyShelloutPlayLocalResponse = {
  ok: false;
  disabled: true;
};

const NOOP_RESPONSE: LegacyShelloutPlayLocalResponse = { ok: false, disabled: true };

export async function legacyPlayLocalDisabled(
  _args: LegacyShelloutPlayLocalArgs,
): Promise<LegacyShelloutPlayLocalResponse> {
  return Promise.resolve(NOOP_RESPONSE);
}

export async function legacyStopLocalDisabled(): Promise<LegacyShelloutPlayLocalResponse> {
  return Promise.resolve(NOOP_RESPONSE);
}
