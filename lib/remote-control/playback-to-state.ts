/**
 * Convert PlaybackProvider state to serializable StationPlaybackState.
 */

import type { StationPlaybackState } from "./types";
import type { PlaybackStatus } from "@/lib/playback-provider";
import type { UnifiedSource } from "@/lib/source-types";
import { getPlaylistTracks } from "@/lib/playlist-types";

export function playbackToStationState(
  status: PlaybackStatus,
  currentSource: UnifiedSource | null,
  currentTrackIndex: number,
  queue: UnifiedSource[],
  queueIndex: number,
  positionDuration?: { position: number; duration: number },
  volume?: number
): StationPlaybackState {
  const tracks = currentSource?.playlist ? getPlaylistTracks(currentSource.playlist) : [];
  const track = tracks[currentTrackIndex] ?? tracks[0];
  const trackTitle = track?.name ?? (track as { title?: string })?.title ?? currentSource?.title ?? null;
  const trackCover = track?.cover ?? currentSource?.cover ?? null;

  const base: StationPlaybackState = {
    status,
    currentTrack: trackTitle
      ? { title: trackTitle, cover: trackCover ?? null }
      : currentSource
        ? { title: currentSource.title, cover: currentSource.cover ?? null }
        : null,
    currentSource: currentSource
      ? { id: currentSource.id, title: currentSource.title, cover: currentSource.cover ?? null }
      : null,
    currentTrackIndex,
    queue: queue.map((s) => ({ id: s.id, title: s.title, cover: s.cover ?? null })),
    queueIndex,
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
