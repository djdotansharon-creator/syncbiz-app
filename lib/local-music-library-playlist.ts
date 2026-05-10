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
};

export async function createUnifiedPlaylistFromLocalScan(
  scan: LocalMusicLibraryScanShape,
  defaultGenre: string,
): Promise<UnifiedSource | null> {
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
      url: scan.files[0]!,
      genre: defaultGenre,
      type: "local",
      thumbnail: "",
      tracks,
    }),
  });
  if (!res.ok) return null;
  const created = (await res.json()) as Playlist;
  return {
    id: `pl-${created.id}`,
    title: created.name,
    genre: created.genre || defaultGenre,
    cover: created.thumbnail || null,
    type: "local",
    url: created.url,
    origin: "playlist",
    playlist: created,
    ...unifiedFoundationHints("playlist", "local", created.url),
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
  return {
    id: `pl-${created.id}`,
    title: created.name,
    genre: created.genre || defaultGenre,
    cover: created.thumbnail || null,
    type: "local",
    url: created.url,
    origin: "playlist",
    playlist: created,
    ...unifiedFoundationHints("playlist", "local", created.url),
  };
}
