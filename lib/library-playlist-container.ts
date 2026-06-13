/**
 * Distinguish real playlist/list containers from single-track URLs persisted as 1-item playlist rows.
 * Persistence may use a Playlist document with one track; library UI must not treat those as LIST shells.
 */

import { getPlaylistTracks } from "@/lib/playlist-types";
import { getYouTubeSourceKind, isYouTubeMultiTrackUrl } from "@/lib/playlist-utils";
import type { UnifiedSource } from "@/lib/source-types";

function playlistUrl(source: UnifiedSource): string {
  return (source.url ?? source.playlist?.url ?? "").trim();
}

/** URL shape is a multi-track container (YouTube list, Spotify playlist, M3U path, etc.). */
export function isExternalMultiTrackUrl(url: string): boolean {
  const u = url.trim();
  if (!u) return false;
  const lower = u.toLowerCase();
  if (lower.includes("youtube.com") || lower.includes("youtu.be")) {
    return getYouTubeSourceKind(u) === "multi" || isYouTubeMultiTrackUrl(u);
  }
  if (lower.includes("open.spotify.com") || lower.includes("spotify.com")) {
    return /\/playlist\//i.test(u) || /\/album\//i.test(u);
  }
  if (lower.includes("soundcloud.com") && /\/sets\//i.test(u)) return true;
  if (/\.(m3u8?|pls)(\?|$)/i.test(u)) return true;
  if (/youtube\.com\/playlist/i.test(u)) return true;
  return false;
}

export function getEffectivePlaylistTrackCount(source: UnifiedSource): number {
  if (!source.playlist) return 0;
  return getPlaylistTracks(source.playlist).length;
}

/**
 * True when the library should treat this row as a playlist/list container (LIST badge, open container, AI playlist tools).
 */
export function isRealPlaylistLibraryContainer(source: UnifiedSource): boolean {
  if (source.origin !== "playlist" || !source.playlist) return false;

  const url = playlistUrl(source);
  if (source.playlist.libraryPlacement === "ready_external") return true;
  if (source.contentNodeKind === "external_playlist") return true;
  if (isExternalMultiTrackUrl(url)) return true;

  const persisted = source.playlist.tracks;
  if (persisted && persisted.length > 1) return true;

  if (source.contentNodeKind === "syncbiz_playlist" && getEffectivePlaylistTrackCount(source) > 1) {
    return true;
  }

  if (getEffectivePlaylistTrackCount(source) > 1) return true;

  return false;
}

/** Single URL stored as a playlist row with one playable item — render as TRACK/SINGLE, not LIST. */
export function isSingleTrackPlaylistShell(source: UnifiedSource): boolean {
  if (source.origin !== "playlist" || !source.playlist) return false;
  return !isRealPlaylistLibraryContainer(source);
}

/** AI ⋯ menu: improve/expand only on real multi-track (or external) playlists. */
export function shouldShowPlaylistAiPlaylistActions(source: UnifiedSource): boolean {
  if (!source.playlist?.id) return false;
  return isRealPlaylistLibraryContainer(source);
}
