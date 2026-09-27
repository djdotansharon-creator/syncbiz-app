/**
 * VONO Watchdog — contract surface.
 *
 * SINGLE SOURCE OF TRUTH: the heartbeat / control / health-state schema lives in
 * `desktop/src/shared/vono-runtime-state.ts`. This file re-exports it (no copy → no drift) and ADDS
 * only the watchdog's OPERATIONAL thresholds `WD` (tuning, not part of the writer's on-disk schema).
 */

export {
  VONO_HEARTBEAT_SCHEMA_VERSION,
  VONO_HEARTBEAT_INTERVAL_MS,
} from "../src/shared/vono-runtime-state";
export type {
  VonoPlaybackStatus,
  VonoHeartbeat,
  VonoControlMode,
  VonoControlState,
  WatchdogState,
  RecoveryAction,
} from "../src/shared/vono-runtime-state";

import { VONO_HEARTBEAT_INTERVAL_MS } from "../src/shared/vono-runtime-state";

/** All thresholds in ms (see docs/VONO_CORE_PROTECTION.md §E). Loose relative to the app's own
 *  self-heal so the two never fight. Watchdog-operational only — NOT part of the on-disk contract. */
export const WD = {
  TICK_MS: 2000,
  appStaleMs: 3 * VONO_HEARTBEAT_INTERVAL_MS, // 15s: heartbeat missing/stale ⇒ APP_MISSING
  mpvDownGraceMs: 10_000,
  playbackStallMs: 12_000, // mid-playback: no position advance for this long ⇒ (candidate) STALLED
  // Startup grace: a FRESH attempt is never STALLED until it has (a) proven real progress at least
  // once AND (b) lived at least this long. >= the app's own stream-startup policy (~30s) so the
  // watchdog can never fight a legitimate 20–30s URL/YouTube startup.
  startupGraceMs: 30_000,
  rendererStaleMs: 20_000,
  recoveryConfirmMs: 20_000,
  interAttemptCooldownMs: 30_000,
  appAttemptsPerWindow: 3,
  otherAttemptsPerWindow: 2,
  attemptWindowMs: 10 * 60_000,
  hardRestartCeilingPerHour: 6, // beyond this ⇒ observe+alert only (SAFE_HOLD behavior)
  // Recovery execution (PR-C):
  killGraceMs: 5000, // wait after a NON-force taskkill before escalating to /F
  killForceMs: 3000, // wait after a force taskkill /F before giving up
  killPollMs: 500, // poll interval while waiting for the process to exit
  restartHistoryMax: 200, // bounded restart-history.json ring
} as const;

/** Default install path used ONLY as a last-resort fallback when neither the heartbeat nor the cache
 *  carries an execPath. Matches the NSIS per-user install (perMachine:false). */
export function defaultVonoExePath(): string {
  const localAppData = process.env.LOCALAPPDATA || "";
  return `${localAppData}\\Programs\\SyncBiz Player\\SyncBiz Player.exe`;
}

/** Accepted VONO executable file names — current pilot name + the future VONO rename. The watchdog
 *  will ONLY launch a file whose basename is in this allowlist (case-insensitive). */
export const VONO_EXE_BASENAMES = ["SyncBiz Player.exe", "VONO.exe", "VONO Player.exe"] as const;
export function isExpectedVonoBasename(basename: string): boolean {
  const b = basename.trim().toLowerCase();
  return VONO_EXE_BASENAMES.some((n) => n.toLowerCase() === b);
}

/** Absolute path to Windows taskkill (never rely on PATH resolution). */
export function taskkillPath(): string {
  const sysRoot = process.env.SystemRoot || process.env.windir || "C:\\Windows";
  return `${sysRoot}\\System32\\taskkill.exe`;
}

/** Absolute path to Windows tasklist (never rely on PATH resolution). */
export function tasklistPath(): string {
  const sysRoot = process.env.SystemRoot || process.env.windir || "C:\\Windows";
  return `${sysRoot}\\System32\\tasklist.exe`;
}
