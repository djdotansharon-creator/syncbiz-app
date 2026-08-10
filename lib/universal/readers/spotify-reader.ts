/**
 * Phase A2 — Spotify PlatformReader adapter.
 *
 * Wraps the EXISTING lib/spotify-playlist-import-client.ts (Spotify Web API preview
 * for public playlists/albums). This is the ONLY real non-YouTube playlist reader.
 *
 * IMPORTANT HONESTY NOTE: Spotify audio is NOT played. This reader extracts the
 * tracklist (title/artist/duration) so a later resolver can map each track to a
 * playable provider. nativePlayback is therefore false. This adapter is CLIENT-side
 * (fetchSpotifyPlaylistPreview calls a same-origin API route).
 */

import {
  fetchSpotifyPlaylistPreview,
  parseSpotifyPlaylistOrAlbumUrl,
  type SpotifyPlaylistPreviewTrack,
} from "@/lib/spotify-playlist-import-client";
import type { PlatformDetection, PlatformReader, ReaderCapabilities } from "@/lib/universal/platform-reader";
import type { NormalizedCollection, NormalizedTrack } from "@/lib/universal/universal-track";
import { singleArtist } from "@/lib/universal/universal-track";

const CAPABILITIES: ReaderCapabilities = {
  detect: true,
  readPlaylist: true,
  readAlbum: true,
  readTrack: false, // single-track Spotify URLs resolve-to-YouTube via the legacy path, not here.
  nativePlayback: false,
  note: "Real: public playlist/album tracklist via Web API. No Spotify playback — tracks resolve later.",
};

function trackToNormalized(t: SpotifyPlaylistPreviewTrack): NormalizedTrack {
  return {
    displayTitle: t.title,
    artists: singleArtist(t.artist),
    durationMs: t.durationMs > 0 ? t.durationMs : undefined,
    raw: t,
  };
}

export const spotifyReader: PlatformReader = {
  id: "spotify",
  capabilities: CAPABILITIES,

  detect(url: string): PlatformDetection | null {
    if (!/(?:^|\.)spotify\.(?:com|link)/i.test(url) && !/toi\.link/i.test(url)) return null;
    const parsed = parseSpotifyPlaylistOrAlbumUrl(url);
    if (parsed) return { provider: "spotify", kind: parsed.kind, supported: true };
    // A track/artist URL is recognized but has no real reader here.
    return { provider: "spotify", kind: "track", supported: false };
  },

  async readPlaylist(url: string): Promise<NormalizedCollection> {
    return readCollection(url);
  },

  async readAlbum(url: string): Promise<NormalizedCollection> {
    return readCollection(url);
  },

  normalize(raw: unknown): NormalizedTrack {
    return trackToNormalized(raw as SpotifyPlaylistPreviewTrack);
  },
};

async function readCollection(url: string): Promise<NormalizedCollection> {
  const res = await fetchSpotifyPlaylistPreview(url);
  if (res.status !== "ok") {
    const reason =
      res.status === "playlist_blocked"
        ? res.message
        : res.status === "not_configured"
          ? "Spotify is not configured on the server."
          : res.status === "error"
            ? res.message
            : "Unable to read this Spotify link.";
    throw new Error(reason);
  }
  const tracks = res.tracks.map(trackToNormalized);
  return {
    title: res.name,
    kind: res.kind,
    sourceProvider: "spotify",
    sourceUrl: url,
    totalTracks: res.totalTracks,
    tracks,
  };
}
