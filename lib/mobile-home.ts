/**
 * THE PHONE'S HOME (owner 2026-11-20: "give a home like Spotify instead of the library") — which shelves it has and what is on each.
 * Pure: the library comes in, shelves go out (components/vm/vm-home.tsx draws them). No path, no URL leaves this file — only the lists the phone already holds.
 *
 *  - PLAYED LATELY   what was sent to a branch from THIS phone (ids kept on the phone — lib/mobile-recent.ts), newest first
 *  - YOUR PLAYLISTS  the business's own lists with several songs, newest first
 *  - READY-MADE      the ready-made lists (`libraryPlacement === "ready_external"`), newest first
 *  - YOUR SONGS      single songs / one-song lists that are not ready-made, newest first
 * Radio stays out of the phone (as before). A list with no tracks of its own is the single song it carries (getPlaylistTracks) — counted the way the library rows count it.
 */
import { getPlaylistTracks } from "@/lib/playlist-types";
import type { UnifiedSource } from "@/lib/source-types";

/** how many covers a shelf carries (the rest is behind "See all") */
export const SHELF_MAX = 12;

export type HomeShelves = {
  recent: UnifiedSource[];
  mine: UnifiedSource[];
  ready: UnifiedSource[];
  songs: UnifiedSource[];
};

/** the key a source is remembered by; a song INSIDE a playlist (`<playlist>:track:<song>`) counts as its playlist */
export function recentKey(s: Pick<UnifiedSource, "origin" | "id">): string {
  const i = s.id.indexOf(":track:");
  return i > 0 ? `playlist:${s.id.slice(0, i)}` : `${s.origin}:${s.id}`;
}

/** `key` goes to the front of the list (once), the list keeps its newest `max` */
export function pushRecent(list: readonly string[], key: string, max = SHELF_MAX): string[] {
  return [key, ...list.filter((k) => k !== key)].slice(0, max);
}

/** what the phone stored → a clean list of keys (anything that is not a list of strings is "nothing") */
export function parseRecent(raw: string | null | undefined, max = SHELF_MAX): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    const out: string[] = [];
    for (const k of v) if (typeof k === "string" && k && !out.includes(k)) out.push(k);
    return out.slice(0, max);
  } catch {
    return [];
  }
}

const songCount = (s: UnifiedSource): number => (s.origin === "playlist" ? (s.playlist ? getPlaylistTracks(s.playlist).length : 0) : 1);
const isReady = (s: UnifiedSource): boolean => s.origin === "playlist" && s.playlist?.libraryPlacement === "ready_external";
const madeAt = (s: UnifiedSource): number => {
  const t = Date.parse(s.playlist?.createdAt ?? "");
  return Number.isFinite(t) ? t : -Infinity;
};
/** newest first; a source with no date (a single song of the library has none) keeps its place after what has one (the sort is stable) */
const newestFirst = (a: UnifiedSource, b: UnifiedSource): number => {
  const x = madeAt(a), y = madeAt(b);
  return x === y ? 0 : y > x ? 1 : -1;
};

export function buildShelves(sources: readonly UnifiedSource[], recentKeys: readonly string[] = [], max = SHELF_MAX): HomeShelves {
  const usable = sources.filter((s) => s.origin !== "radio" && songCount(s) > 0);
  const byKey = new Map<string, UnifiedSource>();
  for (const s of usable) byKey.set(recentKey(s), s);
  const recent: UnifiedSource[] = [];
  for (const k of recentKeys) {
    const s = byKey.get(k);
    if (s && !recent.includes(s)) recent.push(s);
    if (recent.length >= max) break;
  }
  const pick = (f: (s: UnifiedSource) => boolean) => usable.filter(f).sort(newestFirst).slice(0, max);
  return {
    recent,
    mine: pick((s) => !isReady(s) && s.origin === "playlist" && songCount(s) > 1),
    ready: pick(isReady),
    songs: pick((s) => !isReady(s) && songCount(s) === 1),
  };
}
