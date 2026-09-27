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
} as const;
