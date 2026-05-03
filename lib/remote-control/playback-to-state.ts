/**
 * Convert PlaybackProvider state to serializable StationPlaybackState.
 */

import type { StationPlaybackState } from "./types";
import type { PlaybackStatus } from "@/lib/playback-provider";
import type { UnifiedSource } from "@/lib/source-types";
import { derivePlaylistTrackCoverArt, derivePlaylistUnifiedCoverArt } from "@/lib/playlist-utils";
import { resolvePlaylistOriginBadgeKey } from "@/lib/deck-source-badge";
import { getPlaylistTracks } from "@/lib/playlist-types";

export function playbackToStationState(
  status: PlaybackStatus,
  currentSource: UnifiedSource | null,
  currentTrackIndex: number,
  queue: UnifiedSource[],
  queueIndex: number,
  shuffle?: boolean,
  autoMix?: boolean,
  positionDuration?: { position: number; duration: number },
  volume?: number
): StationPlaybackState {
  const tracks = currentSource?.playlist ? getPlaylistTracks(currentSource.playlist) : [];
  const track = tracks[currentTrackIndex] ?? tracks[0];
  const trackTitle = track?.name ?? (track as { title?: string })?.title ?? currentSource?.title ?? null;

  let resolvedTrackCover: string | null =
    track != null
      ? derivePlaylistTrackCoverArt({
          cover: track.cover,
          url: track.url ?? "",
          type: track.type,
        })
      : null;
  if (!resolvedTrackCover && currentSource?.playlist) {
    resolvedTrackCover = derivePlaylistUnifiedCoverArt(currentSource.playlist);
  }
  if (!resolvedTrackCover) resolvedTrackCover = currentSource?.cover ?? null;

  const sourceRowCover =
    currentSource?.origin === "playlist" && currentSource.playlist
      ? derivePlaylistUnifiedCoverArt(currentSource.playlist) ?? currentSource.cover ?? null
      : currentSource?.cover ?? null;

  const playlistBadge =
    currentSource?.origin === "playlist" ? resolvePlaylistOriginBadgeKey(currentSource.playlist ?? null) : null;

  const base: StationPlaybackState = {
    status,
    currentTrack: trackTitle
      ? { title: trackTitle, cover: resolvedTrackCover }
      : currentSource
        ? { title: currentSource.title, cover: resolvedTrackCover ?? currentSource.cover ?? null }
        : null,
    currentSource: currentSource
      ? {
          id: currentSource.id,
          title: currentSource.title,
          cover: sourceRowCover,
          editHref:
            currentSource.origin === "playlist" && currentSource.playlist
              ? `/playlists/${currentSource.playlist.id}/edit`
              : currentSource.origin === "radio" && currentSource.radio
                ? `/radio/${currentSource.radio.id}/edit`
                : currentSource.origin === "source" && currentSource.source
                  ? `/sources/${currentSource.source.id}/edit`
                  : null,
          ...(playlistBadge ? { playlistOriginBadge: playlistBadge } : {}),
        }
      : null,
    currentTrackIndex,
    queue: queue.map((s) => ({ id: s.id, title: s.title, cover: s.cover ?? null })),
    queueIndex,
    shuffle: typeof shuffle === "boolean" ? shuffle : undefined,
    autoMix: typeof autoMix === "boolean" ? autoMix : undefined,
  };

  if (positionDuration && Number.isFinite(positionDuration.position) && Number.isFinite(positionDuration.duration)) {
    base.position = positionDuration.position;
    base.duration = positionDuration.duration;
    base.positionAt = Date.now();
  }
  if (typeof volume === "number" && Number.isFinite(volume)) {
    base.volume = Math.max(0, Math.min(100, volume));
  }

  return base;
}
