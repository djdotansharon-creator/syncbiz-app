/**
 * PR-C — PAUSE invariant for the desktop MPV "playing but frozen" self-heal.
 *
 * Pure, side-effect-free helpers so the pause invariant is testable without rendering the big
 * components/audio-player.tsx client component. The real wiring lives in that file:
 *  - `nextFreezeBaseline` mirrors the snapshot handler (applySnap) that stamps the freeze clock.
 *  - `shouldFreezeSelfHeal` is the fire decision used by the 1s self-heal interval.
 *
 * INVARIANT: PAUSED playback must NEVER accrue freeze time, trigger FREEZE_DETECTED / REDISPATCH /
 * SKIP_FORWARD, or restart the current track. A paused engine's position legitimately does not advance,
 * so "position not moving" is only a freeze signal while the engine genuinely claims to be playing.
 */

export type FreezeClockStatus = string; // the MPV snapshot status ("playing" | "paused" | "idle" | …)

/**
 * Compute the next freeze-clock baseline from a snapshot. The baseline is "the last time we had real
 * forward progress"; `now - baseline` is the frozen duration the self-heal compares against FREEZE_MS.
 *
 * Rules:
 *  - position advanced  → stamp baseline = now (normal progress).
 *  - status === paused  → HOLD baseline = now every paused tick. Paused time never accrues, and when
 *                         playback resumes the baseline is fresh (a long pause can't become an instant
 *                         "freeze" the moment it resumes).
 *  - otherwise          → keep the previous baseline (a genuinely playing-but-stationary engine ages
 *                         toward FREEZE_MS as before).
 */
export function nextFreezeBaseline(args: {
  prevBaseline: number;
  prevPos: number | null;
  nextPos: number;
  snapStatus: FreezeClockStatus;
  now: number;
}): { baseline: number; lastPos: number } {
  const posChanged = args.prevPos === null || args.nextPos !== args.prevPos;
  let baseline = args.prevBaseline;
  if (posChanged) baseline = args.now;
  // PAUSE INVARIANT: hold the clock fresh while paused (covers the paused-but-stationary case, and
  // gives resume a fresh baseline).
  if (args.snapStatus === "paused") baseline = args.now;
  return { baseline, lastPos: posChanged ? args.nextPos : (args.prevPos ?? args.nextPos) };
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
