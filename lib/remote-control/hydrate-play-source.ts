/**
 * Resolve a remote PLAY_SOURCE payload into a UnifiedSource suitable for MASTER playSource.
 * Fetches full playlist rows when playlistId is present so multi-track sessions work on GOtv.
 * When API fetch fails (e.g. streamer without user session), uses sessionTracks from CONTROL.
 */

import type { Playlist, PlaylistTrack, PlaylistType } from "@/lib/playlist-types";
import { getPlaylistTracks } from "@/lib/playlist-types";
import type { UnifiedSource } from "@/lib/source-types";
import { EPHEMERAL_LOCAL_PLAYLIST_PREFIX } from "@/lib/local-playlist-artwork";
import { payloadToUnifiedSource } from "@/lib/remote-control/payload-to-source";
import type { PlaySourcePayload, SessionTrackMirror } from "@/lib/remote-control/types";
import { canonicalYouTubeWatchUrlForPlayback, derivePlaylistTrackCoverArt } from "@/lib/playlist-utils";

async function fetchPlaylistById(playlistId: string): Promise<Playlist | null> {
  try {
    const res = await fetch(`/api/playlists/${encodeURIComponent(playlistId)}`, {
      credentials: "include",
      cache: "no-store",
    });
    if (!res.ok) return null;
    const full = (await res.json()) as Playlist;
    return full?.id ? full : null;
  } catch {
    return null;
  }
}

function playlistTypeFromPayload(type: string): PlaylistType {
  const t = type as PlaylistType;
  if (t === "youtube" || t === "soundcloud" || t === "spotify" || t === "local" || t === "stream-url") {
    return t;
  }
  return "youtube";
}

/** Build a persisted-shaped playlist from CONTROL mirror rows (GOtv cannot always GET /api/playlists). */
export function playlistFromPayloadSession(payload: PlaySourcePayload): Playlist | null {
  const playlistId = (payload.playlistId ?? "").trim();
  const mirrors = payload.sessionTracks;
  if (!playlistId || !mirrors?.length) return null;

  const plType = playlistTypeFromPayload(payload.type);
  const tracks: PlaylistTrack[] = mirrors.map((row, i) => {
    const trackUrl = row.url?.trim() ?? "";
    return {
      id: row.id || `${playlistId}-mirror-${i}`,
      name: row.title,
      title: row.title,
      type: plType,
      url: trackUrl,
      cover: row.cover ?? undefined,
      ...(typeof row.durationSeconds === "number" && row.durationSeconds >= 0
        ? { durationSeconds: row.durationSeconds }
        : {}),
    };
  });

  return {
    id: playlistId,
    name: payload.title,
    genre: payload.genre ?? "Mixed",
    type: plType,
    url: payload.url,
    thumbnail: payload.cover ?? "",
    cover: payload.cover ?? undefined,
    createdAt: new Date(0).toISOString(),
    tracks,
    order: tracks.map((t) => t.id),
  };
}

/**
 * When CONTROL sends PLAY_SOURCE with playlistId, hydrate the full playlist before MASTER playSource.
 */
export async function hydratePlaySourceFromPayload(payload: PlaySourcePayload): Promise<UnifiedSource> {
  const base = payloadToUnifiedSource(payload);
  const playlistId = (payload.playlistId ?? "").trim();

  if (process.env.NODE_ENV === "development") {
    console.info("[SyncBiz:hydrate-play-source] payload", {
      playlistId: playlistId || null,
      origin: payload.origin,
      sessionTracksLen: payload.sessionTracks?.length ?? 0,
    });
  }

  if (!playlistId) return base;
  if (playlistId.startsWith(EPHEMERAL_LOCAL_PLAYLIST_PREFIX)) return base;

  const existing = base.playlist;
  if (existing && getPlaylistTracks(existing).length > 1) {
    if (process.env.NODE_ENV === "development") {
      console.info("[SyncBiz:hydrate-play-source] using existing playlist on payload", {
        trackCount: getPlaylistTracks(existing).length,
      });
    }
    return { ...base, origin: "playlist", playlist: existing };
  }

  const full = await fetchPlaylistById(playlistId);
  if (full) {
    const trackCount = getPlaylistTracks(full).length;
    if (process.env.NODE_ENV === "development") {
      console.info("[SyncBiz:hydrate-play-source] fetched playlist", { playlistId, trackCount });
    }
    return { ...base, origin: "playlist", playlist: full };
  }

  const fromMirror = playlistFromPayloadSession(payload);
  if (fromMirror) {
    const trackCount = getPlaylistTracks(fromMirror).length;
    if (process.env.NODE_ENV === "development") {
      console.info("[SyncBiz:hydrate-play-source] built playlist from sessionTracks mirror", {
        playlistId,
        trackCount,
      });
    }
    return { ...base, origin: "playlist", playlist: fromMirror };
  }

  if (process.env.NODE_ENV === "development") {
    console.info("[SyncBiz:hydrate-play-source] no playlist attachment", { playlistId });
  }
  return base;
}

/** Map library playlist rows to wire mirrors for CONTROL → MASTER PLAY_SOURCE. */
export function playlistToSessionTrackMirrors(
  playlist: Playlist,
  fallbackSourceId?: string,
): SessionTrackMirror[] {
  return getPlaylistTracks(playlist).map((t, i) => {
    const title = (t.name ?? (t as { title?: string }).title ?? "Track").trim() || "Track";
    const rawUrl = (t.url ?? "").trim();
    return {
      id: t.id || `${fallbackSourceId ?? playlist.id}-track-${i}`,
      title,
      cover: derivePlaylistTrackCoverArt({ cover: t.cover, url: rawUrl, type: t.type }),
      ...(typeof (t as { durationSeconds?: number }).durationSeconds === "number"
        ? { durationSeconds: (t as { durationSeconds?: number }).durationSeconds }
        : {}),
      ...(rawUrl ? { url: canonicalYouTubeWatchUrlForPlayback(rawUrl) } : {}),
    };
  });
}
