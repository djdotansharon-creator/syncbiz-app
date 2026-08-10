/**
 * Phase A2 — YouTube PlatformReader adapter.
 *
 * Wraps the EXISTING, verified enumeration in lib/yt-dlp-search.ts. It adds no new
 * scraping and changes nothing about playback. The heavy yt-dlp module is pulled via
 * dynamic import() inside readPlaylist so merely importing this adapter never bundles
 * child_process / the yt-dlp binary manager.
 *
 * Server-only: readPlaylist runs the yt-dlp CLI and must be called from a server
 * context (route / server action). detect()/normalize() are pure and safe anywhere.
 */

import {
  getYouTubePlaylistId,
  getYouTubeVideoId,
  isYouTubeMixUrl,
} from "@/lib/playlist-utils";
import type { PlatformDetection, PlatformReader, ReaderCapabilities } from "@/lib/universal/platform-reader";
import type { NormalizedCollection, NormalizedTrack } from "@/lib/universal/universal-track";

const CAPABILITIES: ReaderCapabilities = {
  detect: true,
  readPlaylist: true,
  readAlbum: false, // YouTube has no first-class album; album-like lists read as playlists.
  readTrack: true,
  nativePlayback: true,
  note: "Real: enumerates playlist/mix leaves via yt-dlp; native embed playback.",
};

/** Shape of a yt-dlp mix candidate (mirrors YouTubeMixImportCandidate to avoid a server import at type time). */
interface YtCandidate {
  videoId: string;
  title: string;
  url: string;
  thumbnailUrl: string;
  durationSeconds?: number;
  viewCount?: number;
}

/**
 * Best-effort split of a YouTube video title into artist + title. Used ONLY to ENRICH
 * metadata — the item's resolution/playability comes from the videoId, never from this parse.
 */
function parseYouTubeTitle(raw: string): { title: string; artist?: string } {
  let t = (raw ?? "").trim();
  // Drop trailing marketing qualifiers: (Official Video) / [Lyric Video] / (Audio) / (HD) …
  t = t.replace(/\s*[([][^)\]]*\b(official|lyric|lyrics|audio|video|visuali[sz]er|hd|hq|mv|m\/v)\b[^)\]]*[)\]]/gi, "").trim();
  const m = t.match(/^(.*?)\s[-–—]\s(.*)$/);
  if (m && m[1].trim() && m[2].trim()) return { artist: m[1].trim(), title: m[2].trim() };
  return { title: t };
}

function candidateToTrack(c: YtCandidate): NormalizedTrack {
  const parsed = parseYouTubeTitle(c.title);
  return {
    displayTitle: parsed.title || c.title,
    artists: parsed.artist ? [{ displayName: parsed.artist, order: 0, role: "primary" }] : [],
    durationMs: typeof c.durationSeconds === "number" ? Math.round(c.durationSeconds * 1000) : undefined,
    providerRef: {
      provider: "youtube",
      externalId: c.videoId,
      externalUrl: c.url,
      playableStatus: "PLAYABLE",
    },
    release: c.thumbnailUrl ? { artworkUrl: c.thumbnailUrl, provider: "youtube" } : undefined,
    raw: c,
  };
}

export const youtubeReader: PlatformReader = {
  id: "youtube",
  capabilities: CAPABILITIES,

  detect(url: string): PlatformDetection | null {
    const isYtHost = /(?:^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)/i.test(url);
    if (!isYtHost) return null;
    const playlistId = getYouTubePlaylistId(url);
    const videoId = getYouTubeVideoId(url);
    if (playlistId || isYouTubeMixUrl(url)) {
      return { provider: "youtube", kind: "playlist", supported: true };
    }
    if (videoId) return { provider: "youtube", kind: "track", supported: true };
    return { provider: "youtube", kind: "unknown", supported: false };
  },

  async readPlaylist(url: string): Promise<NormalizedCollection> {
    const mod = await import("@/lib/yt-dlp-search");
    const result = await mod.enumerateYouTubeMixPlaylistCandidates(url);
    const tracks = result.candidates.map((c) => candidateToTrack(c as YtCandidate));
    return {
      title: "YouTube playlist",
      kind: "playlist",
      sourceProvider: "youtube",
      sourceUrl: url,
      totalTracks: tracks.length,
      tracks,
      unreadable: result.error && tracks.length === 0 ? [{ raw: url, reason: result.error }] : undefined,
    };
  },

  async readTrack(url: string): Promise<NormalizedTrack> {
    const videoId = getYouTubeVideoId(url);
    if (!videoId) throw new Error("Not a YouTube video URL");
    return {
      displayTitle: url,
      artists: [],
      providerRef: { provider: "youtube", externalId: videoId, externalUrl: url, playableStatus: "PLAYABLE" },
    };
  },

  normalize(raw: unknown): NormalizedTrack {
    return candidateToTrack(raw as YtCandidate);
  },
};
