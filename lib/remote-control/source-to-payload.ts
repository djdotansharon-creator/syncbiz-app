/**
 * Convert UnifiedSource to PlaySourcePayload for PLAY_SOURCE command.
 * Must carry a non-empty playback `url` — remote payloads omit `playlist`, so when the top-level
 * `url` is empty but tracks exist, we take the first playable track URL.
 */

import type { PlaySourcePayload } from "./types";
import type { UnifiedSource } from "@/lib/source-types";
import { getPlaylistTracks } from "@/lib/playlist-types";
import { canonicalYouTubeWatchUrlForPlayback } from "@/lib/playlist-utils";

export function unifiedSourceToPayload(source: UnifiedSource): PlaySourcePayload {
  let url = (source.url ?? "").trim();
  if (!url && source.playlist) {
    for (const t of getPlaylistTracks(source.playlist)) {
      const raw = (t?.url ?? "").trim();
      if (!raw || raw.startsWith("local://")) continue;
      url = canonicalYouTubeWatchUrlForPlayback(raw);
      break;
    }
  }
  return {
    id: source.id,
    title: source.title,
    genre: source.genre ?? "Mixed",
    cover: source.cover ?? null,
    type: source.type,
    url,
    origin: source.origin,
  };
}
