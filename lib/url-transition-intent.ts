/**
 * P0 Gate 1b + 1c (2026-10-07) — ONE source-transition intent at a time, for EVERY controller (PURE, no I/O).
 *
 * Used by BOTH shared controller layers — lib/device-player-context.tsx (station renderer, web app, phone source rows)
 * and lib/station-controller-context.tsx (phone remote / player) — so every UI gets the same protection and feedback.
 * MAIN adds defence in depth (Gate 1a: duplicate PLAY_SOURCE / PLAY-while-pending are ignored there too).
 *
 * LOCKED behaviour while URL transition X is pending (phase "loading" / "trying-next"):
 *   same target again → ignored · PLAY → ignored (never restarts the pending load) · NEXT / PREV → ignored (one
 *   navigation intent; no 10-click = 10-track skip) · a DIFFERENT explicit selection → accepted (newest wins) ·
 *   STOP / PAUSE → always accepted · LOCAL selection → accepted (clears the URL intent via the existing LOCAL path).
 *
 * The pending state follows the ACTUAL attempt, never a UI timer:
 *   station (sees MAIN attempt ids via desktop IPC): bound = the first new MAIN attempt (> 1e9) after the send;
 *     confirmed = that attempt playing with an ADVANCING position; failed = that attempt idle + lastError, engine up.
 *   remote (sees only the mirrored STATE_UPDATE): bound = the mirrored source / track equals the target;
 *     confirmed = playing with an advancing position; failed = idle + mpvEngineError.
 *   Safety ends (not delays): station unbound > 15 s → "not sent"; remote unconfirmed > 150 s → cleared.
 * 1b (station only — the controller that OWNS the URL session): a failed bound attempt (any position, incl. pos 0) or a
 *   confirmed attempt that later fails steps the session forward ONCE; at most MAX_CONSECUTIVE_FAILURES in a row
 *   (any confirmed attempt resets the count); no next item / exhausted → message only, never a LOCAL fallback.
 */
export const MAIN_ATTEMPT_BASE = 1_000_000_000;
export const MAX_CONSECUTIVE_FAILURES = 3;
export const STATION_UNBOUND_TIMEOUT_MS = 15_000;
export const REMOTE_UNCONFIRMED_TIMEOUT_MS = 150_000;
export const MESSAGE_MS = 6_000;

export type TransitionOrigin = "select" | "next" | "prev" | "auto-eof" | "auto-failure";
export type TransitionPhase = "loading" | "trying-next" | "confirmed" | "failed-kept" | "failed-idle" | "not-sent";

export type UrlTransition = {
  origin: TransitionOrigin;
  /** `${sourceId}#${trackIndex}` of the requested item (null = unknown). */
  targetKey: string | null;
  phase: TransitionPhase;
  startedAt: number;
  /** Station: MAIN attempt id current when the command was sent (the new attempt must differ). Remote: null. */
  priorAttemptId: number | null;
  boundAttemptId: number | null;
  bound: boolean;
  firstPos: number | null;
  /** Something was audibly playing when the transition began (drives the failure message). */
  audibleAtStart: boolean;
  consecutiveFailures: number;
  messageUntil: number | null;
};

export type TransitionObservation = {
  /** Station only (MAIN attempt id from desktop IPC); null for remote controllers. */
  attemptId: number | null;
  sourceId: string | null;
  trackIndex: number | null;
  status: string;
  position: number;
  error: string | null;
  engineReady: boolean;
};

export type UserCommand =
  | { kind: "select"; targetKey: string | null }
  | { kind: "play" }
  | { kind: "nav" }
  | { kind: "pause" }
  | { kind: "stop" }
  | { kind: "select-local" };

export function targetKeyOf(sourceId: string | null | undefined, trackIndex: number | null | undefined): string | null {
  return sourceId ? `${sourceId}#${typeof trackIndex === "number" && trackIndex >= 0 ? trackIndex : 0}` : null;
}

/** A transition that is still unproven and therefore blocks duplicate / competing user intents. */
export function isBlocking(t: UrlTransition | null | undefined): boolean {
  return !!t && (t.phase === "loading" || t.phase === "trying-next");
}

/** Decide one user-originated command against the current transition. */
export function decideUserCommand(t: UrlTransition | null, cmd: UserCommand): "accept" | "ignore-duplicate" | "ignore-pending" {
  if (cmd.kind === "stop" || cmd.kind === "pause" || cmd.kind === "select-local") return "accept";
  if (!isBlocking(t)) return "accept";
  if (cmd.kind === "select") return cmd.targetKey !== null && cmd.targetKey === t!.targetKey ? "ignore-duplicate" : "accept";
  return "ignore-pending"; // play / nav while a transition is pending
}

export function beginTransition(args: {
  origin: TransitionOrigin;
  targetKey: string | null;
  now: number;
  priorAttemptId: number | null;
  audibleAtStart: boolean;
  consecutiveFailures?: number;
}): UrlTransition {
  return {
    origin: args.origin,
    targetKey: args.targetKey,
    phase: args.origin === "auto-failure" ? "trying-next" : "loading",
    startedAt: args.now,
    priorAttemptId: args.priorAttemptId,
    boundAttemptId: null,
    bound: false,
    firstPos: null,
    audibleAtStart: args.audibleAtStart,
    consecutiveFailures: args.consecutiveFailures ?? 0,
    messageUntil: null,
  };
}

/** Terminal visible failure (message for MESSAGE_MS, then cleared by `tickTransition`). */
export function failTransition(t: UrlTransition, now: number): UrlTransition {
  return { ...t, phase: t.audibleAtStart ? "failed-kept" : "failed-idle", messageUntil: now + MESSAGE_MS };
}

export type ObserveEvent = "none" | "bound" | "confirmed" | "failed";

/** PURE: fold one observation into the transition. */
export function observeTransition(t: UrlTransition | null, o: TransitionObservation): { t: UrlTransition | null; event: ObserveEvent } {
  if (!t || t.phase === "failed-kept" || t.phase === "failed-idle" || t.phase === "not-sent") return { t, event: "none" };
  const station = o.attemptId !== null;
  let next = t;
  let event: ObserveEvent = "none";
  // ── binding ──
  if (!next.bound) {
    if (station) {
      const id = o.attemptId as number;
      if (id > MAIN_ATTEMPT_BASE && id !== next.priorAttemptId && (next.priorAttemptId === null || id > next.priorAttemptId)) {
        next = { ...next, bound: true, boundAttemptId: id };
        event = "bound";
      }
    } else if (next.targetKey !== null && targetKeyOf(o.sourceId, o.trackIndex) === next.targetKey) {
      next = { ...next, bound: true };
      event = "bound";
    }
    if (!next.bound) return { t: next, event: "none" };
  }
  // ── the bound attempt only ──
  if (station && o.attemptId !== next.boundAttemptId) return { t: next, event };
  if (!station && targetKeyOf(o.sourceId, o.trackIndex) !== next.targetKey) return { t: next, event };
  if (o.status === "idle" && o.error && o.engineReady !== false) return { t: next, event: "failed" };
  if (next.phase === "confirmed") return { t: next, event };
  if (o.status === "playing" && !o.error) {
    if (next.firstPos === null) return { t: { ...next, firstPos: o.position }, event };
    if (o.position > next.firstPos) return { t: { ...next, phase: "confirmed", consecutiveFailures: 0 }, event: "confirmed" };
  }
  return { t: next, event };
}

/** PURE: time-based ends (safety, not UI delays) + message expiry. */
export function tickTransition(t: UrlTransition | null, now: number, isStation: boolean): UrlTransition | null {
  if (!t) return null;
  if (t.messageUntil !== null) return now >= t.messageUntil ? null : t;
  if (!isBlocking(t)) return t;
  if (isStation && !t.bound && now - t.startedAt > STATION_UNBOUND_TIMEOUT_MS) return { ...t, phase: "not-sent", messageUntil: now + MESSAGE_MS };
  if (!isStation && now - t.startedAt > REMOTE_UNCONFIRMED_TIMEOUT_MS) return null;
  return t;
}

/** User-facing status line (null = show the normal player status). */
export function transitionLabel(t: UrlTransition | null | undefined): string | null {
  if (!t) return null;
  switch (t.phase) {
    case "loading": return "Loading…";
    case "trying-next": return "Couldn't play — trying next…";
    case "failed-kept": return "Couldn't play — current music kept";
    case "failed-idle": return "Couldn't play this URL";
    case "not-sent": return "Couldn't reach the store player";
    default: return null;
  }
}
