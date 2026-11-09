/**
 * The song's position / length / status as the PLAYER shows them — one small shared store so the display screen draws the same progress bar as the player
 * (browser engine, desktop MPV or a controller mirror: `audio-player.tsx` already computes the right value for each and publishes it here).
 * Read-only for everyone else; publishing is a plain assignment (no subscribers → no work).
 */
import { useSyncExternalStore } from "react";

export type NowPosition = { position: number; duration: number; status: string };

let current: NowPosition = { position: 0, duration: 0, status: "idle" };
const listeners = new Set<() => void>();

export function publishNowPosition(position: number, duration: number, status: string): void {
  const p = Number.isFinite(position) ? position : 0;
  const d = Number.isFinite(duration) ? duration : 0;
  if (current.position === p && current.duration === d && current.status === status) return;
  current = { position: p, duration: d, status };
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
const subscribeNothing = () => () => {};

/**
 * `active` = whether the caller is on screen. 2026-11-09 (CDP on a live station): the display screen is mounted all the time but
 * shown only when locked; it listened anyway and redrew ~20× a second while hidden. Inactive → no subscription (no redraws); it
 * still reads the latest value whenever it renders, so it is current the moment it opens.
 */
export function useNowPosition(active = true): NowPosition {
  return useSyncExternalStore(active ? subscribe : subscribeNothing, () => current, () => current);
}
