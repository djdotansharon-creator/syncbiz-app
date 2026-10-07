/**
 * P0 (2026-10-07) — URL ownership vs stale LOCAL automix (PURE).
 *
 * The renderer's AUTONOMOUS LOCAL transition machinery (desktop near-end AUTOMIX in components/audio-player.tsx) reads
 * MAIN's live MPV snapshot. Every LOCAL load the renderer dispatches carries the renderer's own attempt generation
 * (`playbackAttemptGenRef`); a MAIN URL session runs under a MAIN-minted id (>= 1e9). The renderer may act on a
 * snapshot ONLY when it is the renderer's OWN current attempt — otherwise a URL session's position / duration would
 * drive the (stale) LOCAL provider into next() → PLAY_REQUEST local-file → LOCAL takeover before the URL's EOF.
 * Same rule (INV1) the natural-end, load-error and freeze self-heal paths already apply.
 */
export function rendererOwnsSnapshot(snapAttemptId: unknown, rendererAttemptGen: number): boolean {
  return typeof snapAttemptId === "number" && snapAttemptId === rendererAttemptGen;
}
