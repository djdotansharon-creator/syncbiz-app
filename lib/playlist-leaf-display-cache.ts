/**
 * In-memory memo for expanded playlist grid leaves (track list per playlist object).
 */

import { invalidateAiPlaylistTracksMetaMemory } from "@/lib/ai-playlist-track-meta-cache";
import { getPlaylistTracks, type Playlist, type PlaylistTrack } from "@/lib/playlist-types";

const tracksByPlaylist = new WeakMap<Playlist, PlaylistTrack[]>();

export function getMemoizedPlaylistTracks(playlist: Playlist): PlaylistTrack[] {
  let cached = tracksByPlaylist.get(playlist);
  if (!cached) {
    cached = getPlaylistTracks(playlist);
    tracksByPlaylist.set(playlist, cached);
  }
  return cached;
}

export function invalidatePlaylistLeafDisplayCache(playlistId?: string): void {
  invalidateAiPlaylistTracksMetaMemory(playlistId);
}
