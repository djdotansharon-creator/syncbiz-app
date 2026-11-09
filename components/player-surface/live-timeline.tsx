"use client";

/**
 * 2026-11-09 (owner: "only the bar should refresh — why the whole player?"). The progress bar, the elapsed time and the display
 * screen's copy of the position move while a station / controller plays. Before, that was done by a 250 ms setState in
 * AudioPlayer itself, which re-rendered the WHOLE player (≈6,000 lines: buttons, titles, video, queue) four times a second just
 * to move one bar. Now only these tiny leaves follow the clock; the player re-renders only when its real state changes.
 *
 * 2026-11-09 later (owner: "the clock can run once a second"): the leaves no longer redraw on every clock tick — each one
 * redraws only when what it SHOWS changes: the time text when its second changes, the bar when the whole second it stands on
 * changes (the CSS glide smooths the step), the display-screen copy once per whole second. So each redraws once a second while
 * playing. The cheap 250 ms tick only LOOKS (it calls the position function); sampling 4× a second keeps the seconds exact (a
 * plain 1 s timer would sometimes skip or repeat a second).
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
let ticker: ReturnType<typeof setInterval> | null = null;

function subscribeClock(cb: () => void): () => void {
  subscribers.add(cb);
  if (ticker === null) {
    ticker = setInterval(() => {
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

/** The player's own position function (it reads the latest snapshot + the clock each time it is called). */
export type LivePosition = () => number;

/** The elapsed-time text. `override` = the pointer's second while a scrub is in progress. Redraws only when the text changes. */
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
  const text = useSyncExternalStore(
    running ? subscribeClock : subscribeNothing,
    () => {
      const displayPosition = getPosition();
      return format(override ?? displayPosition);
    },
    () => "",
  );
  return <>{text}</>;
}

/** The played fill + the thumb of the progress bar (same markup and rules the player drew inline before). Redraws once per whole second. */
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
  const shownProgressPercent = useSyncExternalStore(
    running ? subscribeClock : subscribeNothing,
    () => {
      const displayPosition = getPosition();
      const wholeSecond = Math.floor(displayPosition); // the bar steps once a second; the CSS width glide smooths the step
      const displayProgressPercent =
        Number.isFinite(wholeSecond) &&
        Number.isFinite(displayDuration) &&
        displayDuration > 0
          ? Math.min(100, Math.max(0, (wholeSecond / displayDuration) * 100))
          : 0;
      /* what the bar draws: the pointer's position while a scrub/tap is pending, else the real one (rule unchanged, 2026-11-06) */
      return optimistic && (isScrubbing || !(Math.abs(displayPosition - optimistic.target) < 1.5)) ? optimistic.pct : displayProgressPercent;
    },
    () => 0,
  );
  return (
    <>
      <div className={playedClassName} style={{ width: `${shownProgressPercent}%` }} />
      <div className={thumbClassName} style={{ left: `${Math.max(0, Math.min(100, shownProgressPercent))}%` }} />
    </>
  );
}

/** Hands the position the bar shows to the display screen (lib/now-position.ts), once per whole second. Renders nothing. */
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
  const displayPosition = useSyncExternalStore(
    running ? subscribeClock : subscribeNothing,
    () => Math.floor(getPosition()),
    () => 0,
  );
  useEffect(() => {
    publishNowPosition(displayPosition, displayDuration, displayStatus);
  }, [displayPosition, displayDuration, displayStatus]);
  return null;
}
