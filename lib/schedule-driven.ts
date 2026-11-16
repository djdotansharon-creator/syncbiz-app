/**
 * "THE SCHEDULE'S MUSIC" (owner 2026-11-15: "a song must not start over; after it — if there is a gap — the player itself pushes suitable songs, as we have; only a defined quiet time is silent").
 *
 * When the schedule engine starts a block it marks the music it started. While that music (or a song the player lined up after it) is what plays, the player's own
 * AutoplayRecommender is allowed to line up the NEXT song — YouTube's suggestion for the song, else another single from the library — exactly as it does when the operator
 * switches it on, and the LAST song of a list gets one too even with LOOP on, so nothing starts over. A quiet block (the engine's stop) or the next block (a new mark) ends
 * it; a song the operator plays by hand is not the marked music, so it behaves as before (VONO still never lines up a song after the operator's own choice — owner 2026-10-27).
 * Renderer memory only (never stored, never sent); nothing here touches playback.
 */
import { useSyncExternalStore } from "react";

export const AUTOPLAY_GENRE_MARK = "Autoplay"; // the genre the recommender gives the songs it lines up (components/autoplay-recommender.tsx)

let rootId: string | null = null;
let version = 0;
const listeners = new Set<() => void>();
const emit = () => {
  version += 1;
  listeners.forEach((l) => l());
};

/** the engine started this source (a UnifiedSource id) */
export function markScheduleDriven(sourceId: string): void {
  if (!sourceId) return;
  rootId = sourceId;
  emit();
}

/** a quiet block / stop: the schedule's music is over */
export function clearScheduleDriven(): void {
  if (rootId === null) return;
  rootId = null;
  emit();
}

/** is `sourceId` (with its `genre`) the music the schedule started, or a song the player lined up after it? */
export function isScheduleDriven(sourceId: string | null | undefined, genre?: string | null): boolean {
  if (rootId === null) return false;
  return (!!sourceId && sourceId === rootId) || genre === AUTOPLAY_GENRE_MARK;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** React: does the schedule own what plays now? */
export function useScheduleDriven(sourceId: string | null | undefined, genre?: string | null): boolean {
  useSyncExternalStore(subscribe, () => version, () => 0);
  return isScheduleDriven(sourceId, genre);
}
