/**
 * P0 (2026-10-07) — URL session natural-EOF auto-advance on the designated station (PURE, no I/O).
 *
 * ROOT CAUSE: a designated-station URL playlist session is played by MAIN via WS PLAY_SOURCE, so MAIN mints its own
 * attempt id (>= MAIN_WS_ATTEMPT_BASE, desktop/src/main/main-attempt-id.ts). The renderer's existing natural-end
 * handler (components/audio-player.tsx) only acts on ITS OWN attempts (mpvAttemptId === playbackAttemptGenRef) while
 * its provider is playing — never true for a MAIN URL session — and MAIN only holds session METADATA (no URLs). So a
 * URL item reaching `end-file reason=eof` left the station idle forever.
 *
 * FIX: the co-located renderer that COMMITTED the URL session observes MAIN's music status and, on the natural end of
 * the CONFIRMED current MAIN attempt, steps the SAME session forward exactly once (existing PLAY_SOURCE N+1 path).
 *
 * EOF = the CURRENT MAIN attempt went playing (real decode: position or duration > 0) → idle, with NO lastError and
 * engineReady !== false. Explicit STOP publishes "stopped"; a load/decode ERROR or an MPV process exit / QUIT
 * publishes idle WITH lastError (and engineReady=false) — none of them advance. A stale event of an older attempt
 * cannot match: MAIN's orchestrator always publishes the CURRENT attempt id (an outgoing crossfade deck's / superseded
 * attempt's idle is relabeled as a non-confirming pending snapshot of the new attempt).
 * One attempt can advance at most ONCE (consumed id). A manual NEXT / PREV / new selection disarms (no double step).
 */
export const MAIN_WS_ATTEMPT_BASE = 1_000_000_000;

export type MainMusicSnapshot = {
  status: string;
  attemptId: number;
  position: number;
  duration: number;
  lastError: string | null;
  engineReady: boolean;
};

export type UrlEofState = { armedAttemptId: number | null; consumedAttemptId: number | null };

export const initialUrlEofState = (): UrlEofState => ({ armedAttemptId: null, consumedAttemptId: null });

/** Disarm (manual transport / new selection): a pending natural end of the current attempt must not step again. */
export function disarmUrlEof(s: UrlEofState): UrlEofState {
  return { armedAttemptId: null, consumedAttemptId: s.armedAttemptId ?? s.consumedAttemptId };
}

/**
 * PURE: observe one MAIN music snapshot. `urlSessionActive` = this renderer committed the URL playlist session MAIN is
 * playing (designated co-located station, LOCAL ownership relinquished, a playlist leaf sent). Returns the new state and
 * whether to step the session forward NOW.
 */
export function observeUrlEof(
  s: UrlEofState,
  snap: MainMusicSnapshot,
  urlSessionActive: boolean,
): { state: UrlEofState; advance: boolean; reason: string } {
  if (!urlSessionActive) return { state: { ...s, armedAttemptId: null }, advance: false, reason: "no-url-session" };
  const id = snap.attemptId;
  if (!(typeof id === "number" && id > MAIN_WS_ATTEMPT_BASE)) {
    return { state: { ...s, armedAttemptId: null }, advance: false, reason: "not-a-main-ws-attempt" };
  }
  const healthy = !snap.lastError && snap.engineReady !== false;
  if (snap.status === "playing" && healthy && (snap.position > 0 || snap.duration > 0)) {
    if (s.consumedAttemptId === id) return { state: s, advance: false, reason: "already-consumed" };
    return { state: { ...s, armedAttemptId: id }, advance: false, reason: "armed" };
  }
  if (s.armedAttemptId !== id) {
    // a different attempt (new load pending / superseded) — never let an older arm fire on it
    return { state: { ...s, armedAttemptId: null }, advance: false, reason: "different-attempt" };
  }
  if (snap.status === "idle" && healthy && s.consumedAttemptId !== id) {
    return { state: { armedAttemptId: null, consumedAttemptId: id }, advance: true, reason: "natural-eof" };
  }
  if (snap.status === "paused") return { state: s, advance: false, reason: "paused" };
  // stopped (explicit STOP) / idle with error or engine down (ERROR / QUIT / process exit) → disarm, no advance
  return { state: { ...s, armedAttemptId: null }, advance: false, reason: snap.status === "stopped" ? "explicit-stop" : "error-or-engine-down" };
}
