/**
 * P0 (2026-10-07) — attempt ids for MAIN / WS-initiated MPV loads.
 *
 * Every load MAIN starts on behalf of a WS command (PLAY_SOURCE, PLAY with a url, catalog PLAY) gets a FRESH
 * attempt id. Before this, those loads all used the orchestrator default 0, so the watchdog (which resets its
 * per-attempt progress history only when the heartbeat attemptId changes) saw successive URL loads as ONE old
 * attempt and could call a fresh, still-resolving URL (pos=0 / dur=0) PLAYBACK_STALLED after ~12s.
 *
 * Ids are unique and strictly increasing for the MAIN process lifetime and live in their own range
 * (>= MAIN_WS_ATTEMPT_BASE) so they never collide with renderer-owned attempt ids (a small per-renderer
 * generation counter starting at 0). The id flows unchanged through orchestrator → MpvManager → status
 * snapshot (mpvAttemptId) → heartbeat. Pure module (no electron / MPV imports) so it is unit-testable.
 */
export const MAIN_WS_ATTEMPT_BASE = 1_000_000_000;

let seq = 0;

/** Next MAIN/WS attempt id (unique + monotonically increasing for this process). */
export function nextMainWsAttemptId(): number {
  seq += 1;
  return MAIN_WS_ATTEMPT_BASE + seq;
}

/** True when an attempt id was minted by MAIN for a WS-initiated load (vs a renderer-owned attempt). */
export function isMainWsAttemptId(id: number | null | undefined): boolean {
  return typeof id === "number" && id > MAIN_WS_ATTEMPT_BASE;
}
