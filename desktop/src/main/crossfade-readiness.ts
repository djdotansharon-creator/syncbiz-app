/**
 * P0 (2026-10-07) — crossfade incoming-deck readiness. Pure (no electron / MPV imports) so it is unit-testable.
 *
 * The A/B ramp fades the AUDIBLE deck out, so it may only start once the INCOMING deck is truly producing audio.
 * MPV reports status "playing" on start-file and a URL/yt-dlp source can know its duration while still
 * buffering (core-idle / paused-for-cache) — so for STREAM sources "playing + duration>0" is NOT readiness.
 *
 *  - STREAM (http/https/ytdl): playing AND coreIdle !== true AND pausedForCache !== true AND a REAL time-pos
 *    advance was observed for this load. A known duration alone never qualifies.
 *  - LOCAL file: unchanged legacy rule (playing AND (duration > 0 OR position > 0)) — local decode is instant,
 *    so LOCAL→LOCAL keeps its existing fast behavior.
 *
 * Local to the crossfade path: does NOT redefine MpvManager's global "playing" semantics.
 */
export type IncomingDeckSignals = {
  status: string;
  position: number;
  duration: number;
  coreIdle: boolean | null;
  pausedForCache: boolean | null;
  progressObserved: boolean;
};

export function isCrossfadeIncomingReady(s: IncomingDeckSignals, incomingIsStream: boolean): boolean {
  if (s.status !== "playing") return false;
  if (!incomingIsStream) return s.duration > 0 || s.position > 0;
  return s.coreIdle !== true && s.pausedForCache !== true && s.progressObserved === true;
}
