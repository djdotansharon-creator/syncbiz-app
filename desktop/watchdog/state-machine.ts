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
  /** How long MPV has continuously reported engineReady===false (0 if ready). Guards MPV_DOWN so a
   *  transient engine blip the app self-heals is not escalated before WD.mpvDownGraceMs. */
  mpvDownForMs: number;
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
  mpvDownSince: number; // epoch ms MPV first went engineReady=false continuously (0 = ready/unknown)
}

export function initProgressTracker(): ProgressTracker {
  return { attemptId: null, attemptFirstSeenAt: 0, baselinePositionAt: 0, lastPosition: 0, progressObserved: false, mpvDownSince: 0 };
}

/** Track how long MPV has been continuously down (engineReady=false). Resets the moment it's ready
 *  again. Returns the current continuous-down duration in ms (0 when ready or no heartbeat). */
export function observeMpvDown(tr: ProgressTracker, hb: VonoHeartbeat | null, now: number): number {
  if (!hb || hb.mpv.engineReady) {
    tr.mpvDownSince = 0;
    return 0;
  }
  if (tr.mpvDownSince === 0) tr.mpvDownSince = now; // first tick seeing it down
  return now - tr.mpvDownSince;
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
  /** Only set for APP_MISSING: whether the VONO process is still alive. Selects the recovery action —
   *  alive (hung) ⇒ restart_app, dead ⇒ launch_app. */
  appProcessAlive?: boolean;
}

/**
 * True when a control directive should currently SUPPRESS recovery.
 *   - none              → inactive
 *   - maintenance       → active only while now < expiresAt (bounded / anti-stale)
 *   - intentional_stop  → active INDEFINITELY (expiresAt === null) until the marker is explicitly cleared
 */
export function isMaintenanceActive(control: VonoControlState | null, now: number): boolean {
  if (!control) return false;
  if (control.mode === "none") return false;
  if (control.mode === "intentional_stop") return true; // persistent until cleared — never times out
  // maintenance: bounded
  return typeof control.expiresAt === "number" && now < control.expiresAt;
}

/**
 * Detection. Precedence: MAINTENANCE > APP_MISSING > MPV_DOWN > PLAYBACK_STALLED > RENDERER_STALE >
 * HEALTHY. (RECOVERING is owned by `decide`, not derived here.) Deliberately defers to the app: only
 * escalates when a signal is stuck past the app's own longest self-heal.
 */
export function deriveState(input: DeriveInput): DeriveResult {
  const { hb, control, appProcessAlive, now } = input;

  if (isMaintenanceActive(control, now)) {
    // Same suppression state, two shapes of marker: a persistent intentional-stop (expiresAt === null) vs a
    // bounded maintenance window (numeric expiresAt). Format the reason correctly for each so the log doesn't
    // read "maintenance until null".
    const reason =
      control!.mode === "intentional_stop"
        ? `intentional stop active (${control!.reason})`
        : `maintenance until ${control!.expiresAt} (${control!.reason})`;
    return { state: "MAINTENANCE", reason };
  }

  // APP: heartbeat missing/stale OR no process ⇒ the app can't help itself. Two sub-cases, resolved by
  // the ACTION layer via appProcessAlive: process dead ⇒ launch; process ALIVE but heartbeat stale
  // (a hung main process) ⇒ restart (kill the hung pid first, then launch) so case B is never stuck.
  const hbAgeMs = hb ? now - hb.writtenAt : Number.POSITIVE_INFINITY;
  const hbStale = !hb || hbAgeMs > WD.appStaleMs;
  if (hbStale || !appProcessAlive) {
    const why = !appProcessAlive
      ? "process not found"
      : !hb ? "heartbeat missing (process alive)" : `heartbeat stale ${hbAgeMs}ms (process alive — hung)`;
    return { state: "APP_MISSING", reason: why, appProcessAlive };
  }

  // From here hb is fresh and the app is alive.
  const intendsPlay = hb.playback.status === "playing";

  // MPV engine down while we intend to play — but only AFTER a sustained grace, so the app's own
  // internal MPV respawn gets first crack and the watchdog never fights it (requirement).
  if (!hb.mpv.engineReady && intendsPlay && input.mpvDownForMs >= WD.mpvDownGraceMs) {
    return { state: "MPV_DOWN", reason: `engineReady=false for ${input.mpvDownForMs}ms${hb.mpv.lastError ? " err=" + hb.mpv.lastError : ""}` };
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

/** Map a derived (bad) state to its escalation action. APP_MISSING splits by appProcessAlive:
 *  process ALIVE but heartbeat stale = a hung main process ⇒ restart_app (kill the hung pid, then
 *  launch); process DEAD ⇒ launch_app. This is what stops case B (hung app) from staying stuck. */
function actionFor(derived: DeriveResult): RecoveryAction {
  switch (derived.state) {
    case "APP_MISSING":
      return derived.appProcessAlive ? "restart_app" : "launch_app";
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

  const action = actionFor(derived);

  // Hourly hard ceiling on full-app (re)starts ⇒ SAFE_HOLD (observe + alert only). Both launch_app and
  // restart_app are full app starts (and both are counted by recordAttempt), so both hit the ceiling.
  const isFullStart = action === "restart_app" || action === "launch_app";
  const restarts1h = mem.restartTimestamps.filter((t) => now - t < 60 * 60_000).length;
  if (isFullStart && restarts1h >= WD.hardRestartCeilingPerHour) {
    return { state, action: "none", suppressed: true, reason: `SAFE_HOLD: ${restarts1h} full-starts/1h ≥ ceiling — alert only` };
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

/**
 * Record that a recovery action was just EXECUTED. Advances the anti-loop bookkeeping so the next
 * decide() correctly applies cooldown / per-window limit / hourly ceiling, and enters RECOVERING for
 * WD.recoveryConfirmMs. Mutates `mem` in place (the observer calls this only when it actually acts).
 * `launch_app` and `restart_app` count toward the hourly full-restart ceiling; `reload_renderer`
 * (reserved) and non-actions do not.
 */
export function recordAttempt(mem: WatchdogMemory, action: RecoveryAction, now: number): void {
  if (action === "none" || action === "await_recovery") return;
  // Rolling attempt window.
  if (!mem.windowStartedAt || now - mem.windowStartedAt >= WD.attemptWindowMs) {
    mem.windowStartedAt = now;
    mem.attemptsInWindow = 0;
  }
  mem.attemptsInWindow += 1;
  mem.lastAttemptAt = now;
  mem.recoveryInFlightUntil = now + WD.recoveryConfirmMs;
  if (action === "launch_app" || action === "restart_app") {
    mem.restartTimestamps.push(now);
    // Prune to the last hour so the ceiling check stays bounded.
    const cutoff = now - 60 * 60_000;
    mem.restartTimestamps = mem.restartTimestamps.filter((t) => t >= cutoff);
  }
}
