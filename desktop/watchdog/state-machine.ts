/**
 * VONO Watchdog — PURE state machine (no I/O, no side effects).
 *
 * `deriveState` = detection layer (heartbeat + control + now → one of the 7 states).
 * `decide`      = recovery/anti-loop layer (state + memory + now → a recommended action, possibly
 *                 suppressed by cooldown / retry-limit / hourly ceiling).
 *
 * The POC observer computes both but EXECUTES nothing (read-only). Recovery execution lands in PR-C.
 */

import {
  WD,
  type VonoHeartbeat,
  type VonoControlState,
  type WatchdogState,
  type RecoveryAction,
} from "./contract";

export interface DeriveInput {
  hb: VonoHeartbeat | null; // parsed heartbeat.json, or null if missing/unreadable
  control: VonoControlState | null; // parsed control.json, or null
  appProcessAlive: boolean; // is a VONO process actually running (PID probe)
  now: number;
  /** Per-attempt progress facts (from ProgressTracker). Guards PLAYBACK_STALLED so a fresh
   *  stream attempt that hasn't advanced yet (legit 20–30s startup) is never called stalled. */
  progress: AttemptProgress;
}

/** What the observer knows about the CURRENT attempt's real progress (see ProgressTracker). */
export interface AttemptProgress {
  /** true once THIS attempt showed at least one real position advance since first observed. */
  progressObserved: boolean;
  /** ms since the observer first saw this attemptId. */
  attemptAgeMs: number;
}

// ── Per-attempt progress tracking (the "minimal local sample/history" the observer keeps) ──────
// READ-ONLY: this only samples heartbeats the observer already reads; it changes nothing on disk or
// in any process. A new attemptId resets the history so an old attempt's progress can't leak in.
export interface ProgressTracker {
  attemptId: number | null;
  attemptFirstSeenAt: number;
  baselinePositionAt: number; // hb.playback.positionAt captured at first sight of this attempt
  lastPosition: number;
  progressObserved: boolean;
}

export function initProgressTracker(): ProgressTracker {
  return { attemptId: null, attemptFirstSeenAt: 0, baselinePositionAt: 0, lastPosition: 0, progressObserved: false };
}

/** Update the tracker from the latest heartbeat and return the current attempt's progress facts. */
export function observeProgress(tr: ProgressTracker, hb: VonoHeartbeat | null, now: number): AttemptProgress {
  if (!hb) return { progressObserved: false, attemptAgeMs: 0 };
  const aid = hb.playback.attemptId;
  if (tr.attemptId !== aid) {
    // New attempt → reset stall history (requirement #4).
    tr.attemptId = aid;
    tr.attemptFirstSeenAt = now;
    tr.baselinePositionAt = hb.playback.positionAt;
    tr.lastPosition = hb.playback.position;
    tr.progressObserved = false;
  } else {
    // Same attempt: a forward position move OR a positionAt change past the baseline = real progress.
    if (hb.playback.position > tr.lastPosition || hb.playback.positionAt !== tr.baselinePositionAt) {
      tr.progressObserved = true;
    }
    if (hb.playback.position > tr.lastPosition) tr.lastPosition = hb.playback.position;
  }
  return { progressObserved: tr.progressObserved, attemptAgeMs: now - tr.attemptFirstSeenAt };
}

export interface DeriveResult {
  state: WatchdogState;
  reason: string;
}

/** True when a control state is a valid, non-expired maintenance/stop directive. */
export function isMaintenanceActive(control: VonoControlState | null, now: number): boolean {
  if (!control) return false;
  if (control.mode === "none") return false;
  return now < control.expiresAt; // self-expiring: a stale directive can never keep a branch down
}

/**
 * Detection. Precedence: MAINTENANCE > APP_MISSING > MPV_DOWN > PLAYBACK_STALLED > RENDERER_STALE >
 * HEALTHY. (RECOVERING is owned by `decide`, not derived here.) Deliberately defers to the app: only
 * escalates when a signal is stuck past the app's own longest self-heal.
 */
export function deriveState(input: DeriveInput): DeriveResult {
  const { hb, control, appProcessAlive, now } = input;

  if (isMaintenanceActive(control, now)) {
    return { state: "MAINTENANCE", reason: `maintenance until ${control!.expiresAt} (${control!.reason})` };
  }

  // APP: heartbeat missing/stale OR no process ⇒ the app can't help itself.
  const hbAgeMs = hb ? now - hb.writtenAt : Number.POSITIVE_INFINITY;
  const hbStale = !hb || hbAgeMs > WD.appStaleMs;
  if (hbStale || !appProcessAlive) {
    const why = !appProcessAlive ? "process not found" : !hb ? "heartbeat missing" : `heartbeat stale ${hbAgeMs}ms`;
    return { state: "APP_MISSING", reason: why };
  }

  // From here hb is fresh and the app is alive.
  const intendsPlay = hb.playback.status === "playing";

  // MPV engine down while we intend to play.
  if (!hb.mpv.engineReady && intendsPlay) {
    return { state: "MPV_DOWN", reason: `engineReady=false${hb.mpv.lastError ? " err=" + hb.mpv.lastError : ""}` };
  }

  // Playback stalled — STARTUP-SAFE, and duration-agnostic. Only after THIS attempt has (a) proven
  // real progress at least once AND (b) lived past the startup grace may a >playbackStallMs freeze be
  // called STALLED. A fresh URL/YouTube attempt still buffering (no progress yet, or < startup grace)
  // is NEVER stalled, so the watchdog can't fight a legitimate 20–30s startup; attemptId change resets
  // this (see tracker). NOTE: duration is NOT part of the gate — for VONO, duration===0 is live/radio,
  // whose position still advances while healthy, so a frozen positionAt after progress = a live stall.
  if (intendsPlay) {
    const stalledMs = now - hb.playback.positionAt;
    const pastStartup = input.progress.attemptAgeMs >= WD.startupGraceMs;
    if (input.progress.progressObserved && pastStartup && stalledMs > WD.playbackStallMs) {
      return { state: "PLAYBACK_STALLED", reason: `no progress ${stalledMs}ms after startup (pos=${hb.playback.position}, dur=${hb.playback.duration})` };
    }
  }

  // Renderer signal (reserved until the renderer ping exists → alive===null is treated as healthy).
  if (hb.renderer.alive === false) {
    const seenAgo = hb.renderer.lastSeenAt ? now - hb.renderer.lastSeenAt : Number.POSITIVE_INFINITY;
    if (seenAgo > WD.rendererStaleMs) {
      return { state: "RENDERER_STALE", reason: `renderer stale ${seenAgo}ms` };
    }
  }

  return { state: "HEALTHY", reason: "app+mpv+playback ok" };
}

// ── Recovery / anti-loop layer ────────────────────────────────────────────────

export interface WatchdogMemory {
  lastAttemptAt: number; // last recovery action wall-clock (0 = none)
  attemptsInWindow: number; // attempts within the current rolling window
  windowStartedAt: number; // start of the current rolling window
  restartTimestamps: number[]; // full-app restarts in the last hour (for the hourly ceiling)
  recoveryInFlightUntil: number; // >now ⇒ we are RECOVERING (awaiting HEALTHY)
}

export function initialMemory(): WatchdogMemory {
  return { lastAttemptAt: 0, attemptsInWindow: 0, windowStartedAt: 0, restartTimestamps: [], recoveryInFlightUntil: 0 };
}

export interface Decision {
  state: WatchdogState; // effective state (may be RECOVERING while an action settles)
  action: RecoveryAction; // recommended action (POC logs it; PR-C executes)
  suppressed: boolean; // true when the action is held back (cooldown / limit / ceiling / maintenance)
  reason: string;
}

/** Map a derived (bad) state to its escalation action. */
function actionFor(state: WatchdogState): RecoveryAction {
  switch (state) {
    case "APP_MISSING":
      return "launch_app";
    case "RENDERER_STALE":
      return "reload_renderer";
    case "MPV_DOWN":
    case "PLAYBACK_STALLED":
      return "restart_app";
    default:
      return "none";
  }
}

/**
 * Given the derived state + memory + now, decide the recommended action and whether it is suppressed.
 * PURE: does not mutate `mem` (the observer applies mutations when it actually acts — PR-C).
 */
export function decide(derived: DeriveResult, mem: WatchdogMemory, now: number): Decision {
  const { state, reason } = derived;

  if (state === "HEALTHY") {
    return { state: "HEALTHY", action: "none", suppressed: false, reason };
  }
  if (state === "MAINTENANCE") {
    return { state: "MAINTENANCE", action: "none", suppressed: true, reason: `suppressed: ${reason}` };
  }

  // A recovery is still settling → RECOVERING, take no new action.
  if (now < mem.recoveryInFlightUntil) {
    return { state: "RECOVERING", action: "await_recovery", suppressed: true, reason: `awaiting HEALTHY (${mem.recoveryInFlightUntil - now}ms left)` };
  }

  const action = actionFor(state);

  // Hourly hard ceiling on full-app restarts ⇒ SAFE_HOLD behavior (observe + alert only).
  const restarts1h = mem.restartTimestamps.filter((t) => now - t < 60 * 60_000).length;
  if (action === "restart_app" && restarts1h >= WD.hardRestartCeilingPerHour) {
    return { state, action: "none", suppressed: true, reason: `SAFE_HOLD: ${restarts1h} restarts/1h ≥ ceiling — alert only` };
  }

  // Inter-attempt cooldown.
  if (mem.lastAttemptAt && now - mem.lastAttemptAt < WD.interAttemptCooldownMs) {
    return { state, action: "none", suppressed: true, reason: `cooldown ${WD.interAttemptCooldownMs - (now - mem.lastAttemptAt)}ms` };
  }

  // Retry limit within the rolling window.
  const windowActive = mem.windowStartedAt && now - mem.windowStartedAt < WD.attemptWindowMs;
  const limit = state === "APP_MISSING" ? WD.appAttemptsPerWindow : WD.otherAttemptsPerWindow;
  const used = windowActive ? mem.attemptsInWindow : 0;
  if (used >= limit) {
    return { state, action: "none", suppressed: true, reason: `BACKOFF: ${used}/${limit} attempts in window — alert` };
  }

  return { state, action, suppressed: false, reason };
}
