import { getPlaylistTracks } from "@/lib/playlist-types";
import type { UnifiedSource } from "@/lib/source-types";

/** Same storage key as `components/sources-manager.tsx`. */
export const SYNC_PLAYLIST_ASSIGNMENTS_STORAGE_KEY = "syncbiz-playlist-item-assignments";

export function expandPlaylistEntityToItems(source: UnifiedSource): UnifiedSource[] {
  if (!source.playlist) return [];
  const tracks = getPlaylistTracks(source.playlist);
  if (tracks.length === 0) return [];
  return tracks.map((track, index) => ({
    id: `${source.id}:track:${track.id || index}`,
    title: track.name || track.title || source.title,
    genre: source.genre || "Mixed",
    cover: track.cover ?? source.cover ?? null,
    type: (track.type ?? source.type) as UnifiedSource["type"],
    url: track.url,
    origin: "source",
    contentNodeKind: "single_track",
    /** Lets PlaybackProvider resolve URL/embed via parent tracks + playSource(_, trackIndex). */
    playlist: source.playlist,
  }));
}

/** Index of this leaf inside `getPlaylistTracks(item.playlist)` (expanded-queue rows only). */
export function playlistLeafTrackIndexForQueueItem(item: UnifiedSource): number {
  if (!item.playlist || !item.id.includes(":track:")) return 0;
  const marker = ":track:";
  const i = item.id.indexOf(marker);
  const tid = item.id.slice(i + marker.length);
  const tracks = getPlaylistTracks(item.playlist);
  const idx = tracks.findIndex((t) => String(t.id ?? "") === String(tid));
  return idx >= 0 ? idx : 0;
}

/** Center grid only: hide legacy single-URL row (playlist header is the entity). */
export function expandPlaylistEntityToItemsForGrid(source: UnifiedSource): UnifiedSource[] {
  if (!source.playlist) return [];
  const hasRealTracks = !!(source.playlist.tracks && source.playlist.tracks.length > 0);
  const full = expandPlaylistEntityToItems(source);
  if (!hasRealTracks && full.length <= 1) return [];
  return full;
}

/** Play / drag: expanded tracks + assigned library items; never duplicate the playlist shell. */
export function resolveSyncbizPlaylistPlayQueue(
  key: string,
  /** Full library list — must not be genre-filtered or the playlist shell may be missing. */
  librarySources: UnifiedSource[],
  playlistItemAssignments: Record<string, string[]>
): UnifiedSource[] {
  const source = librarySources.find((s) => s.origin === "playlist" && `syncbiz:${s.id}` === key);
  if (!source) return [];
  const assignedIds = playlistItemAssignments[key] ?? [];
  const assignedItems = librarySources.filter((s) => assignedIds.includes(s.id) && s.id !== source.id);
  const expanded = expandPlaylistEntityToItems(source);
  const playItems = expanded.length > 0 ? expanded : [source];
  const map = new Map<string, UnifiedSource>();
  for (const s of [...playItems, ...assignedItems]) map.set(s.id, s);
  return [...map.values()];
}

/** Center grid: same as play merge, but legacy shell hidden; never show the playlist container card. */
export function visibleItemsForSyncbizPlaylistGrid(
  key: string,
  /** Full library list — must not be genre-filtered or the playlist shell / assignments may be missing. */
  librarySources: UnifiedSource[],
  playlistItemAssignments: Record<string, string[]>
): UnifiedSource[] {
  const source = librarySources.find((s) => `syncbiz:${s.id}` === key);
  const assignedIds = playlistItemAssignments[key] ?? [];
  const assignedItems = librarySources.filter(
    (s) => assignedIds.includes(s.id) && (!source || s.id !== source.id)
  );
  const expandedGrid = source ? expandPlaylistEntityToItemsForGrid(source) : [];
  const map = new Map<string, UnifiedSource>();
  for (const s of [...expandedGrid, ...assignedItems]) map.set(s.id, s);
  return [...map.values()].filter((s) => !(source && s.origin === "playlist" && s.id === source.id));
}
