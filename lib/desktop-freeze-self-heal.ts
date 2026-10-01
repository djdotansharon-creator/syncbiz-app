/**
 * PR-C — PAUSE invariant for the desktop MPV "playing but frozen" self-heal.
 *
 * Pure, side-effect-free helpers so the pause invariant is testable without rendering the big
 * components/audio-player.tsx client component. The real wiring lives in that file:
 *  - `nextFreezeBaseline` mirrors the snapshot handler (applySnap) that stamps the FREEZE clock.
 *  - `nextStartupBaseline` mirrors the STREAM-startup timeout baseline (attemptStartAt) during pause.
 *  - `isEnginePaused` is the interval-level guard predicate.
 *  - `shouldFreezeSelfHeal` is the fire decision used by the 1s self-heal interval.
 *
 * INVARIANT: PAUSED playback must NEVER accrue freeze/startup time, trigger FREEZE_DETECTED / REDISPATCH /
 * SKIP_FORWARD, or restart the current track. A paused engine's position legitimately does not advance, so
 * "position not moving" is only a freeze signal while the engine genuinely claims to be playing.
 *
 * Real MPV does NOT emit periodic paused snapshots — the typical sequence is: one PLAYING snap, one PAUSED
 * property-change snap, then SILENCE for minutes, then one PLAYING property-change snap at the SAME position.
 * So two things must hold: (1) a PAUSED→PLAYING transition must freshen the baseline even when the position
 * is unchanged (handled here by `prevStatus`), and (2) the 1s interval, which ages independently of
 * snapshots, must not age any clock while the last-known engine state is paused (handled in the component by
 * an `isEnginePaused` guard that holds both baselines fresh and bails).
 */

export type FreezeClockStatus = string; // the MPV snapshot status ("playing" | "paused" | "idle" | …)

/** True when the engine snapshot reports paused. Used by the interval guard to skip all aging/self-heal. */
export function isEnginePaused(snapStatus: FreezeClockStatus | null | undefined): boolean {
  return snapStatus === "paused";
}

/**
 * Compute the next FREEZE-clock baseline from a snapshot. The baseline is "the last time we had real forward
 * progress"; `now - baseline` is the frozen duration the self-heal compares against FREEZE_MS.
 *
 * Rules (in order):
 *  - position advanced                 → baseline = now (normal progress).
 *  - status === paused                 → baseline = now (hold; paused time never accrues).
 *  - prevStatus paused → now playing   → baseline = now (FRESH window on resume, even if position unchanged —
 *                                         covers the real "one paused snap, silence, resume at same pos" case).
 *  - otherwise                         → keep prevBaseline (a genuinely playing-but-stationary engine ages
 *                                         toward FREEZE_MS as before).
 */
export function nextFreezeBaseline(args: {
  prevBaseline: number;
  prevPos: number | null;
  nextPos: number;
  prevStatus: FreezeClockStatus | null;
  snapStatus: FreezeClockStatus;
  now: number;
}): { baseline: number; lastPos: number } {
  const posChanged = args.prevPos === null || args.nextPos !== args.prevPos;
  let baseline = args.prevBaseline;
  if (posChanged) baseline = args.now;
  if (args.snapStatus === "paused") baseline = args.now; // hold while paused
  if (args.prevStatus === "paused" && args.snapStatus === "playing") baseline = args.now; // fresh window on resume
  return { baseline, lastPos: posChanged ? args.nextPos : (args.prevPos ?? args.nextPos) };
}

/**
 * Compute the next STREAM-startup timeout baseline (attemptStartAt). The startup timeout is measured as
 * `now - baseline`; paused wall-clock must be excluded so a long pause during "starting" can't cause an
 * immediate startup_timeout redispatch/skip on resume. No position component — startup is a wall-clock budget.
 *
 * Rules:
 *  - status === paused                 → baseline = now (exclude paused wall-clock).
 *  - prevStatus paused → now playing   → baseline = now (restart the startup window fresh on resume).
 *  - otherwise                         → keep prevBaseline (the normal buffering budget keeps counting).
 *
 * Deliberately does NOT touch the retry budget — only paused wall-clock is excluded.
 */
export function nextStartupBaseline(args: {
  prevBaseline: number;
  prevStatus: FreezeClockStatus | null;
  snapStatus: FreezeClockStatus;
  now: number;
}): number {
  if (args.snapStatus === "paused") return args.now;
  if (args.prevStatus === "paused" && args.snapStatus === "playing") return args.now;
  return args.prevBaseline;
}

/**
 * Decide whether the "playing but frozen" self-heal (redispatch / skip-forward) may fire.
 *
 * Returns true ONLY when BOTH the renderer intends to play AND the engine claims it is playing AND the
 * position has been frozen for at least `freezeMs`. If either side is paused (or not playing), this is
 * false — paused playback never self-heals. Genuine playing stalls still return true.
 */
export function shouldFreezeSelfHeal(args: {
  rendererStatus: FreezeClockStatus; // our transport intent (statusRef)
  snapStatus: FreezeClockStatus;     // the MPV snapshot status
  frozenMs: number;
  freezeMs: number;
}): boolean {
  if (args.rendererStatus !== "playing") return false; // intent paused/stopped → never self-heal
  if (args.snapStatus !== "playing") return false;     // engine paused/idle → never self-heal
  return args.frozenMs >= args.freezeMs;
}
