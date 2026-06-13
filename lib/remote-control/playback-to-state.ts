/**
 * Convert PlaybackProvider state to serializable StationPlaybackState.
 */

import type { StationPlaybackState, SessionTrackMirror } from "./types";
import type { PlaybackStatus } from "@/lib/playback-provider";
import { getPlaylistSessionTracks } from "@/lib/playback-provider";
import type { Playlist } from "@/lib/playlist-types";
import type { UnifiedSource } from "@/lib/source-types";
import { derivePlaylistTrackCoverArt, derivePlaylistUnifiedCoverArt, effectivePlaybackPlaylistAttachment } from "@/lib/playlist-utils";
import { resolvePlaylistOriginBadgeKey } from "@/lib/deck-source-badge";
import { getPlaylistTracks } from "@/lib/playlist-types";

function buildSessionTrackMirrors(
  currentSource: UnifiedSource | null,
  currentPlaylist: Playlist | null
): SessionTrackMirror[] {
  const rows = getPlaylistSessionTracks({ currentSource, currentPlaylist });
  return rows.map((t, i) => {
    const title = (t.name ?? (t as { title?: string }).title ?? "Track").trim() || "Track";
    const cover = derivePlaylistTrackCoverArt({
      cover: t.cover,
      url: t.url ?? "",
      type: t.type,
    });
    const durationSeconds = (t as { durationSeconds?: number }).durationSeconds;
    return {
      id: t.id || `${currentSource?.id ?? "session"}-track-${i}`,
      title,
      cover,
      ...(typeof durationSeconds === "number" && durationSeconds >= 0 ? { durationSeconds } : {}),
    };
  });
}

export function playbackToStationState(
  status: PlaybackStatus,
  currentSource: UnifiedSource | null,
  currentTrackIndex: number,
  queue: UnifiedSource[],
  queueIndex: number,
  shuffle?: boolean,
  autoMix?: boolean,
  positionDuration?: { position: number; duration: number },
  volume?: number,
  currentPlaylist?: Playlist | null,
  playNextQueue?: UnifiedSource[]
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

  const sessionPlaylistAttachment = currentSource
    ? effectivePlaybackPlaylistAttachment(currentSource)
    : null;
  const sessionPlaylist = sessionPlaylistAttachment ?? currentPlaylist ?? null;
  const sessionTracks = buildSessionTrackMirrors(currentSource, currentPlaylist ?? null);
  const sessionTitle =
    sessionPlaylist?.name?.trim() ||
    currentSource?.title?.trim() ||
    null;

  let nextSessionTrack: { title: string; cover: string | null } | null = null;
  if (sessionTracks.length > 0) {
    const nextIdx =
      sessionTracks.length === 1
        ? 0
        : currentTrackIndex < sessionTracks.length - 1
          ? currentTrackIndex + 1
          : 0;
    const nextRow = sessionTracks[nextIdx];
    if (nextRow && nextIdx !== currentTrackIndex) {
      nextSessionTrack = { title: nextRow.title, cover: nextRow.cover };
    }
  }

  if (process.env.NODE_ENV === "development") {
    console.info("[SyncBiz:playback-to-state] session mirror", {
      sessionTracksLen: sessionTracks.length,
      sessionPlaylistId: sessionPlaylist?.id ?? null,
      currentTrackIndex,
    });
  }

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
    ...(sessionTracks.length > 0 ? { sessionTracks } : {}),
    ...(sessionPlaylist?.id ? { sessionPlaylistId: sessionPlaylist.id } : {}),
    ...(sessionTitle ? { sessionTitle } : {}),
    ...(nextSessionTrack ? { nextSessionTrack } : {}),
    ...(playNextQueue && playNextQueue.length > 0
      ? {
          playNextQueue: playNextQueue.map((s) => ({
            id: s.id,
            title: s.title,
            cover: s.cover ?? null,
          })),
        }
      : {}),
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
