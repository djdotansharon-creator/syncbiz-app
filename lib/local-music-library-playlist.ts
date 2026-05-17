/**
 * Create library playlist entries from Desktop local paths (same API shapes as paste flow in library input).
 */

import type { Playlist } from "@/lib/playlist-types";
import { titleFromLocalPath } from "@/lib/local-audio-path";
import type { UnifiedSource } from "@/lib/source-types";
import { unifiedFoundationHints } from "@/lib/source-types";

export type LocalMusicLibraryScanShape = {
  playlistName: string;
  files: string[];
  /** Same length as `files` when set (e.g. M3U #EXTINF titles). */
  trackDisplayNames?: string[];
  /** Same length as `files`; source row index when each path resolved (desktop M3U import). Not sent to POST. */
  resolvedSourceOrders?: number[];
  /**
   * When `files` is empty (all playlist entries unresolved under the music folder), the playlist shell still
   * needs a persisted `url` — use the path to the .m3u/.pls file (same as Library paste/drop).
   */
  playlistSourcePath?: string;
};

export async function createUnifiedPlaylistFromLocalScan(
  scan: LocalMusicLibraryScanShape,
  defaultGenre: string,
): Promise<UnifiedSource | null> {
  const urlForPlaylist = (scan.files[0] ?? scan.playlistSourcePath ?? "").trim();
  if (!urlForPlaylist) return null;

  const tracks = scan.files.map((filePath, i) => {
    const fromM3u = scan.trackDisplayNames?.[i]?.trim();
    return {
      id: crypto.randomUUID(),
      name: fromM3u && fromM3u.length > 0 ? fromM3u : titleFromLocalPath(filePath),
      type: "local" as const,
      url: filePath,
    };
  });
  const res = await fetch("/api/playlists", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: scan.playlistName,
      url: urlForPlaylist,
      genre: defaultGenre,
      type: "local",
      thumbnail: "",
      ...(tracks.length > 0 ? { tracks } : {}),
    }),
  });
  if (!res.ok) return null;
  const created = (await res.json()) as Playlist;
  return unifiedSourceFromFetchedPlaylist(created, defaultGenre);
}

/** Map a persisted Playlist row into the library UnifiedSource (local shell-first; tracks may vary). */
export function unifiedSourceFromFetchedPlaylist(
  playlist: Playlist,
  defaultGenre: string,
): UnifiedSource {
  const pt = playlist.type as UnifiedSource["type"];
  return {
    id: `pl-${playlist.id}`,
    title: playlist.name,
    genre: playlist.genre || defaultGenre,
    cover: playlist.thumbnail || playlist.cover || null,
    type: playlist.type === "local" ? "local" : pt,
    url: playlist.url,
    origin: "playlist",
    playlist,
    ...unifiedFoundationHints("playlist", playlist.type === "local" ? "local" : pt, playlist.url),
  };
}

export async function createUnifiedPlaylistFromLocalFile(
  absolutePath: string,
  defaultGenre: string,
  options?: { name?: string },
): Promise<UnifiedSource | null> {
  const trimmed = options?.name?.trim();
  const name = trimmed && trimmed.length > 0 ? trimmed : titleFromLocalPath(absolutePath);
  const res = await fetch("/api/playlists", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      url: absolutePath,
      genre: defaultGenre,
      type: "local",
      thumbnail: "",
    }),
  });
  if (!res.ok) return null;
  const created = (await res.json()) as Playlist;
  return unifiedSourceFromFetchedPlaylist(created, defaultGenre);
}
