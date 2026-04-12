/**
 * Shared client helpers for search → playlist create / YouTube playable resolution.
 * Uses credentials: "include" so session cookies are always sent to same-origin API routes.
 */

import {
  canonicalYouTubeWatchUrlForPlayback,
  inferPlaylistType,
  getYouTubeThumbnail,
  getYouTubeVideoId,
} from "./playlist-utils";
import type { Playlist } from "./playlist-types";

export type CreatePlaylistFromSearchMeta = {
  title: string;
  genre: string;
  cover: string | null;
  type: string;
  viewCount?: number;
  durationSeconds?: number;
};

export type CreatePlaylistFromUrlOptions = {
  playlistOwnershipScope?: "branch" | "owner_personal";
};

/** Resolve search/playlist YouTube URLs to a watch URL with `v=` for embed + persistence. */
export async function resolveYouTubePlayableUrlForSearch(url: string): Promise<string> {
  if (getYouTubeVideoId(url)) return canonicalYouTubeWatchUrlForPlayback(url);
  try {
    const res = await fetch("/api/sources/resolve-youtube-playable-url", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) return url;
    const data = (await res.json()) as { playableUrl?: string };
    const out = data.playableUrl || url;
    return getYouTubeVideoId(out) ? canonicalYouTubeWatchUrlForPlayback(out) : out;
  } catch {
    return url;
  }
}

export async function createPlaylistFromUrl(
  url: string,
  meta?: CreatePlaylistFromSearchMeta,
  options?: CreatePlaylistFromUrlOptions
): Promise<Playlist | null> {
  const type = meta?.type || inferPlaylistType(url);
  const cover = meta?.cover || (type === "youtube" ? getYouTubeThumbnail(url) : null);
  const res = await fetch("/api/playlists", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: meta?.title || "Untitled",
      url,
      genre: meta?.genre || "Mixed",
      type,
      thumbnail: cover || "",
      viewCount: meta?.viewCount,
      durationSeconds: meta?.durationSeconds,
      ...(options?.playlistOwnershipScope
        ? { playlistOwnershipScope: options.playlistOwnershipScope }
        : {}),
    }),
  });
  if (!res.ok) return null;
  return res.json();
}
