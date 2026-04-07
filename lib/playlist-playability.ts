import type { Playlist } from "./playlist-types";
import { getPlaylistTracks } from "./playlist-types";

/** True if playlist top-level url or any track url is http(s). */
export function playlistHasHttpPlayableUrl(playlist: Playlist): boolean {
  const top = (playlist.url ?? "").trim();
  if (top.startsWith("http://") || top.startsWith("https://")) return true;
  for (const t of getPlaylistTracks(playlist)) {
    const u = (t?.url ?? "").trim();
    if (u.startsWith("http://") || u.startsWith("https://")) return true;
  }
  return false;
}

/** First http(s) URL from top-level or tracks, or "". */
export function firstHttpUrlFromPlaylist(playlist: Playlist): string {
  const top = (playlist.url ?? "").trim();
  if (top.startsWith("http://") || top.startsWith("https://")) return top;
  for (const t of getPlaylistTracks(playlist)) {
    const u = (t?.url ?? "").trim();
    if (u.startsWith("http://") || u.startsWith("https://")) return u;
  }
  return "";
}
