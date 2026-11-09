"use client";

/**
 * 2026-11-09 (owner: "only the bar should refresh — why the whole player?"). The progress bar, the elapsed time and the display
 * screen's copy of the position move 4× a second while a station / controller plays. Before, that was done by a 250 ms
 * setState in AudioPlayer itself, which re-rendered the WHOLE player (≈6,000 lines: buttons, titles, video, queue) four
 * times a second just to move one bar. Now only these tiny leaves re-render on that tick; the player re-renders only when
 * its real state changes (new snapshot, play / pause, a new song).
 *
 * Display-only. The position is computed by the player exactly as before (`getPosition` is the player's own function, handed
 * down fresh on every player render; it reads the latest snapshot + the clock each time it is called); nothing here reads or
 * writes playback state.
 */
import { useEffect, useSyncExternalStore } from "react";
import { publishNowPosition } from "@/lib/now-position";

/** One shared 250 ms ticker for every leaf of every player instance; it runs only while at least one leaf is subscribed. */
const PLAYER_CLOCK_MS = 250;
const subscribers = new Set<() => void>();
let tickCount = 0;
let ticker: ReturnType<typeof setInterval> | null = null;

function subscribeClock(cb: () => void): () => void {
  subscribers.add(cb);
  if (ticker === null) {
    ticker = setInterval(() => {
      tickCount++;
      subscribers.forEach((f) => f());
    }, PLAYER_CLOCK_MS);
  }
  return () => {
    subscribers.delete(cb);
    if (subscribers.size === 0 && ticker !== null) {
      clearInterval(ticker);
      ticker = null;
    }
  };
}
const subscribeNothing = () => () => {};

/** Re-renders the calling leaf every 250 ms while `running`; does nothing (and holds no timer) otherwise. */
export function usePlayerClock(running: boolean): void {
  useSyncExternalStore(running ? subscribeClock : subscribeNothing, () => (running ? tickCount : -1), () => -1);
}

/** The player's own position function (it reads the latest snapshot + the clock each time it is called). */
export type LivePosition = () => number;

/** The elapsed-time text. `override` = the pointer's second while a scrub is in progress. */
export function LiveTimeText({
  getPosition,
  running,
  override,
  format,
}: {
  getPosition: LivePosition;
  running: boolean;
  override: number | null;
  format: (seconds: number) => string;
}) {
  usePlayerClock(running);
  const displayPosition = getPosition();
  return <>{format(override ?? displayPosition)}</>;
}

/** The played fill + the thumb of the progress bar (same markup and rules the player drew inline before). */
export function LiveTimelineFill({
  getPosition,
  running,
  displayDuration,
  optimistic,
  isScrubbing,
  playedClassName,
  thumbClassName,
}: {
  getPosition: LivePosition;
  running: boolean;
  displayDuration: number;
  optimistic: { pct: number; target: number } | null;
  isScrubbing: boolean;
  playedClassName: string;
  thumbClassName: string;
}) {
  usePlayerClock(running);
  const displayPosition = getPosition();
  const displayProgressPercent =
    Number.isFinite(displayPosition) &&
    Number.isFinite(displayDuration) &&
    displayDuration > 0
      ? Math.min(100, (displayPosition / displayDuration) * 100)
      : 0;
  /* what the bar draws: the pointer's position while a scrub/tap is pending, else the real one (rule unchanged, 2026-11-06) */
  const shownProgressPercent =
    optimistic && (isScrubbing || !(Math.abs(displayPosition - optimistic.target) < 1.5)) ? optimistic.pct : displayProgressPercent;
  return (
    <>
      <div className={playedClassName} style={{ width: `${shownProgressPercent}%` }} />
      <div className={thumbClassName} style={{ left: `${Math.max(0, Math.min(100, shownProgressPercent))}%` }} />
    </>
  );
}

/** Hands the position the bar shows to the display screen (lib/now-position.ts), at the same 4×/s as before. Renders nothing. */
export function NowPositionPublisher({
  getPosition,
  running,
  displayDuration,
  displayStatus,
}: {
  getPosition: LivePosition;
  running: boolean;
  displayDuration: number;
  displayStatus: string;
}) {
  usePlayerClock(running);
  const displayPosition = getPosition();
  useEffect(() => {
    publishNowPosition(displayPosition, displayDuration, displayStatus);
  }, [displayPosition, displayDuration, displayStatus]);
  return null;
}
