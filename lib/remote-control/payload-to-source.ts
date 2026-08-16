/**
 * Convert PlaySourcePayload back to UnifiedSource for playback.
 */

import type { PlaySourcePayload } from "./types";
import type { UnifiedSource, SourceProviderType } from "@/lib/source-types";
import { pickUnifiedFoundationFields } from "@/lib/source-types";
import type { Playlist, PlaylistTrack, PlaylistType } from "@/lib/playlist-types";

export function payloadToUnifiedSource(payload: PlaySourcePayload): UnifiedSource {
  const source: UnifiedSource = {
    id: payload.id,
    title: payload.title,
    genre: payload.genre ?? "Mixed",
    cover: payload.cover ?? null,
    type: payload.type as SourceProviderType,
    url: payload.url,
    origin: payload.origin,
    ...pickUnifiedFoundationFields(payload as Record<string, unknown>),
  };
  // Rebuild the full playlist attachment from the CONTROL-supplied snapshot so the MASTER's
  // existing playSource() builds the complete multi-track queue — NO DB/network re-fetch, so
  // the zero-latency start behavior is preserved. MASTER stays the queue authority.
  if (payload.playlistId && payload.sessionTracks && payload.sessionTracks.length > 0) {
    const plType = payload.type as PlaylistType;
    const tracks: PlaylistTrack[] = payload.sessionTracks.map((st) => ({
      id: st.id,
      name: st.title,
      title: st.title,
      type: plType,
      url: st.url ?? "",
      ...(st.cover ? { cover: st.cover } : {}),
      ...(typeof st.durationSeconds === "number" ? { durationSeconds: st.durationSeconds } : {}),
    }));
    const playlist: Playlist = {
      id: payload.playlistId,
      name: payload.title,
      genre: payload.genre ?? "Mixed",
      type: plType,
      url: payload.url,
      thumbnail: payload.cover ?? "",
      createdAt: new Date().toISOString(),
      tracks,
      order: tracks.map((t) => t.id),
    };
    source.playlist = playlist;
  }
  return source;
}
