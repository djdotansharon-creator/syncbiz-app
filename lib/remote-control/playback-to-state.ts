/**
 * Convert PlaybackProvider state to serializable StationPlaybackState.
 */

import type { StationPlaybackState, SessionTrackMirror } from "./types";
import type { PlaybackStatus } from "@/lib/playback-provider";
import { getPlaylistSessionTracks } from "@/lib/playback-provider";
import type { UnifiedSource } from "@/lib/source-types";
import { derivePlaylistTrackCoverArt, derivePlaylistUnifiedCoverArt, effectivePlaybackPlaylistAttachment } from "@/lib/playlist-utils";
import { resolvePlaylistOriginBadgeKey } from "@/lib/deck-source-badge";
import { getPlaylistTracks, type Playlist, type PlaylistTrack } from "@/lib/playlist-types";
import { isPlayNextSourceId } from "@/lib/play-next";
import { isValidLocalFilePlaybackPath } from "@/lib/url-validation";

/**
 * A track url that must NEVER leave this device over WS: an absolute local filesystem path,
 * a `file:` URI, or a `local://` reference. Remote http(s)/YouTube urls are NOT local.
 */
function isLocalOnlyTrackUrl(u: string | null | undefined): boolean {
  const s = (u ?? "").trim();
  if (!s) return false;
  return s.startsWith("local://") || isValidLocalFilePlaybackPath(s);
}

/** Session + Play Next rows mirrored to CONTROL Live Queue. */
export type PlaybackSessionMirrorInput = {
  currentPlaylist: Playlist | null;
  playNextQueue: UnifiedSource[];
  playNextBaseline: {
    currentSource: UnifiedSource;
    currentPlaylist: Playlist | null;
    currentTrackIndex: number;
  } | null;
};

function mirrorSessionTracksFromRows(tracks: PlaylistTrack[]): SessionTrackMirror[] {
  return tracks.map((t) => {
    // Local filesystem paths / local:// refs NEVER leave the device over WS — they can expose the
    // OS username, folder layout, and cache location. CONTROL doesn't need the url for local tracks
    // (playback is index/command-driven); only remote http(s)/YouTube urls are mirrored.
    const local = isLocalOnlyTrackUrl(t.url);
    const rawTitle = t.name ?? (t as { title?: string }).title ?? null;
    return {
      id: t.id,
      // Never let a local path land in the title fallback either.
      title: rawTitle ?? (local ? "Track" : t.url ?? "Track"),
      cover: derivePlaylistTrackCoverArt({
        cover: t.cover,
        url: local ? "" : t.url ?? "",
        type: t.type,
      }),
      durationSeconds: (t as { durationSeconds?: number }).durationSeconds,
      // Omit url for local tracks (SessionTrackMirror.url is optional); keep remote urls intact.
      ...(local ? {} : { url: t.url }),
    };
  });
}

function buildSessionMirrorFields(
  currentSource: UnifiedSource | null,
  currentTrackIndex: number,
  sessionInput?: PlaybackSessionMirrorInput,
): Pick<
  StationPlaybackState,
  "sessionTracks" | "sessionTitle" | "sessionPlaylistId" | "nextSessionTrack" | "playNextQueue"
> {
  if (!sessionInput) {
    return {};
  }

  let sessionSource = currentSource;
  let sessionPlaylist = sessionInput.currentPlaylist;
  let highlightIndex = currentTrackIndex;

  if (isPlayNextSourceId(currentSource?.id) && sessionInput.playNextBaseline) {
    sessionSource = sessionInput.playNextBaseline.currentSource;
    sessionPlaylist = sessionInput.playNextBaseline.currentPlaylist;
    highlightIndex = sessionInput.playNextBaseline.currentTrackIndex;
  }

  const sessionCtx = { currentSource: sessionSource, currentPlaylist: sessionPlaylist };
  let rows = getPlaylistSessionTracks(sessionCtx);
  if (rows.length === 0) {
    const attached = sessionSource ? effectivePlaybackPlaylistAttachment(sessionSource) : null;
    const onPlaylist = attached ?? sessionPlaylist;
    rows = onPlaylist ? getPlaylistTracks(onPlaylist) : [];
  }

  const attached = sessionSource ? effectivePlaybackPlaylistAttachment(sessionSource) : null;
  const onPlaylist = attached ?? sessionPlaylist;
  const sessionTitle = onPlaylist?.name?.trim() || sessionSource?.title?.trim() || null;
  const sessionTracks = mirrorSessionTracksFromRows(rows);

  let nextSessionTrack: { title: string; cover: string | null } | null = null;
  if (sessionTracks.length > 0) {
    const nextIdx =
      sessionTracks.length === 1
        ? 0
        : highlightIndex < sessionTracks.length - 1
          ? highlightIndex + 1
          : 0;
    const next = sessionTracks[nextIdx];
    if (next) nextSessionTrack = { title: next.title, cover: next.cover };
  }

  const playNextQueue = sessionInput.playNextQueue.map((it) => ({
    id: it.id,
    title: it.title,
    cover: it.cover ?? null,
  }));

  return {
    sessionTracks: sessionTracks.length > 0 ? sessionTracks : undefined,
    sessionTitle,
    sessionPlaylistId: onPlaylist?.id ?? null,
    nextSessionTrack: nextSessionTrack ?? undefined,
    playNextQueue: playNextQueue.length > 0 ? playNextQueue : undefined,
  };
}

export function playbackToStationState(
  status: PlaybackStatus,
  currentSource: UnifiedSource | null,
  currentTrackIndex: number,
  queue: UnifiedSource[],
  queueIndex: number,
  shuffle?: boolean,
  autoMix?: boolean,
  repeatMode?: "playlist" | "track" | "off",
  positionDuration?: { position: number; duration: number },
  volume?: number,
  sessionInput?: PlaybackSessionMirrorInput,
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
    repeatMode: repeatMode ?? undefined,
    ...buildSessionMirrorFields(currentSource, currentTrackIndex, sessionInput),
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
