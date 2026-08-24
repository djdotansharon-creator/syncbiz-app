/**
 * Convert UnifiedSource to PlaySourcePayload for PLAY_SOURCE command.
 * Must carry a non-empty playback `url` — remote payloads omit `playlist`, so when the top-level
 * `url` is empty but tracks exist, we take the first playable track URL.
 */

import type { PlaySourcePayload } from "./types";
import type { UnifiedSource } from "@/lib/source-types";
import { getPlaylistTracks } from "@/lib/playlist-types";
import { canonicalYouTubeWatchUrlForPlayback } from "@/lib/playlist-utils";
import { isValidLocalFilePlaybackPath } from "@/lib/url-validation";

/**
 * A track url that must NEVER leave this device over WS (absolute local filesystem path, `file:`
 * URI, or `local://` ref). A remote MASTER can't play another device's local path anyway, so
 * stripping it is fail-safe and does not change remote http(s)/YouTube behavior.
 */
function isLocalOnlyTrackUrl(u: string | null | undefined): boolean {
  const s = (u ?? "").trim();
  if (!s) return false;
  return s.startsWith("local://") || isValidLocalFilePlaybackPath(s);
}

export function unifiedSourceToPayload(source: UnifiedSource): PlaySourcePayload {
  let url = (source.url ?? "").trim();
  if (isLocalOnlyTrackUrl(url)) url = ""; // never send a local filesystem path as the top-level url
  const playlistTracks = source.playlist ? getPlaylistTracks(source.playlist) : [];
  if (!url && source.playlist) {
    for (const t of playlistTracks) {
      const raw = (t?.url ?? "").trim();
      if (!raw || isLocalOnlyTrackUrl(raw)) continue; // skip ALL local urls, not just local://
      url = canonicalYouTubeWatchUrlForPlayback(raw);
      break;
    }
  }
  const payload: PlaySourcePayload = {
    id: source.id,
    title: source.title,
    genre: source.genre ?? "Mixed",
    cover: source.cover ?? null,
    type: source.type,
    url,
    origin: source.origin,
  };
  // Playlist sources: carry the playlist id + the FULL ordered track snapshot (existing
  // SessionTrackMirror shape) so the MASTER rebuilds the complete queue rather than a 1-track
  // shell. Single-source (non-playlist) payloads are unchanged — no extra fields added.
  if (source.playlist?.id && playlistTracks.length > 0) {
    payload.playlistId = source.playlist.id;
    payload.sessionTracks = playlistTracks.map((t) => ({
      id: t.id,
      title: t.title ?? t.name,
      cover: t.cover ?? null,
      ...(typeof t.durationSeconds === "number" ? { durationSeconds: t.durationSeconds } : {}),
      ...(t.url && !isLocalOnlyTrackUrl(t.url) ? { url: t.url } : {}), // omit local paths on the wire
    }));
  }
  return payload;
}
