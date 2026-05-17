/**
 * Temporary local playback queues for My Music Library (no POST /api/playlists).
 */

import { createPlayNextLocalSource } from "@/lib/play-next";
import { titleFromLocalPath } from "@/lib/local-audio-path";
import type { Playlist, PlaylistTrack } from "@/lib/playlist-types";
import type { UnifiedSource } from "@/lib/source-types";
import { EPHEMERAL_LOCAL_PLAYLIST_PREFIX } from "@/lib/local-playlist-artwork";

/** One ephemeral source per file path — same semantics as Live Play Next for locals. */
export function buildEphemeralLocalQueueFromPaths(absolutePaths: string[]): UnifiedSource[] {
  return absolutePaths.map((p) => createPlayNextLocalSource(p.trim()));
}

export function ephemeralLocalSourceWithCover(absolutePath: string, cover: string | null): UnifiedSource {
  return createPlayNextLocalSource(absolutePath.trim(), cover);
}

function newEphemeralPlaylistId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${EPHEMERAL_LOCAL_PLAYLIST_PREFIX}${crypto.randomUUID()}`;
  }
  return `${EPHEMERAL_LOCAL_PLAYLIST_PREFIX}t-${Date.now()}`;
}

/**
 * In-memory-only playlist so PlaybackProvider next/prev use multi-track session semantics.
 * Id prefix must match skip-hydration in playback-provider (never GET /api/playlists).
 */
export function buildEphemeralLocalFolderPlaylist(
  absolutePaths: string[],
  opts?: { folderLabel?: string; thumbnail?: string | null; perTrackCovers?: (string | null)[] },
): Playlist {
  const cleaned = absolutePaths.map((p) => p.trim()).filter(Boolean);
  const first = cleaned[0] ?? "";
  const name = (opts?.folderLabel ?? "").trim() || (first ? titleFromLocalPath(first) : "") || "Local folder";
  const per = opts?.perTrackCovers;
  const tracks: PlaylistTrack[] = cleaned.map((url, i) => {
    const c = per?.[i];
    const cover = typeof c === "string" && c.trim() ? c.trim() : undefined;
    return {
      id: `elocal-${i}`,
      name: titleFromLocalPath(url),
      type: "local" as const,
      url,
      ...(cover ? { cover } : {}),
    };
  });
  const thumb = `${opts?.thumbnail ?? ""}`.trim();
  return {
    id: newEphemeralPlaylistId(),
    name,
    genre: "Mixed",
    type: "local",
    url: first,
    thumbnail: thumb,
    ...(thumb ? { cover: thumb } : {}),
    createdAt: new Date().toISOString(),
    tracks,
    order: tracks.map((t) => t.id),
  };
}
