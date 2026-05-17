import { getPlaylistTracks, type Playlist, type PlaylistTrack, type PlaylistType } from "./playlist-types";
import type { UnifiedSource } from "./source-types";
import type { MusicStreamingProvider, MusicUrlIngestClassification, MusicUrlIngestIntent } from "./source-types";

function ingestIntentForProvider(provider: MusicStreamingProvider, intent: MusicUrlIngestIntent): MusicUrlIngestClassification {
  return { provider, intent };
}

/**
 * UnifiedSource / queue ids for playlists: stored `Playlist.id` is already `pl-*`.
 * Do not prefix again — `pl-${playlist.id}` would yield `pl-pl-...` and breaks lookups.
 */
export function unifiedPlaylistSourceId(playlistId: string): string {
  const id = (playlistId ?? "").trim();
  return id.startsWith("pl-") ? id : `pl-${id}`;
}

/** Map playlist type to embedded player support (opens in /player page). */
export function isEmbeddedPlaylist(type: PlaylistType): boolean {
  return type === "youtube" || type === "soundcloud" || type === "stream-url";
}

/** Playlist types that can render embedded iframe in-card (YouTube, SoundCloud only). */
export function canEmbedInCard(type: PlaylistType): boolean {
  return type === "youtube" || type === "soundcloud";
}

/** Get Spotify track/playlist ID from URL (for display). */
export function getSpotifyId(url: string): string | null {
  const m = url.match(/spotify\.com\/(?:track|playlist|album)\/([a-zA-Z0-9]+)/i);
  return m ? m[1] : null;
}

/** Get YouTube video ID from URL. */
export function getYouTubeVideoId(url: string): string | null {
  const u = url.trim();
  let m = u.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\s?/]+)/i);
  if (m) return m[1];
  m = u.match(/youtube\.com\/shorts\/([^/?\s]+)/i);
  if (m) return m[1];
  m = u.match(/youtube\.com\/live\/([^/?\s]+)/i);
  return m ? m[1] : null;
}

/**
 * Single-video watch URL for SyncBiz playback/embed — strips provider-native continuation
 * (list=, start_radio=, radio mixes, etc.). Import/resolve may still use full URLs; the player must not.
 */
export function canonicalYouTubeWatchUrlForPlayback(url: string): string {
  const vid = getYouTubeVideoId(url);
  if (!vid) return url;
  const u = url.trim().toLowerCase();
  if (!u.includes("youtube.com") && !u.includes("youtu.be")) return url;
  return `https://www.youtube.com/watch?v=${vid}`;
}

/** Get YouTube playlist ID from URL (e.g. list=RDxxx, list=PLxxx). */
export function getYouTubePlaylistId(url: string): string | null {
  const u = url.trim();
  const m = u.match(/[?&]list=([^&\s]+)/i);
  return m ? m[1] : null;
}

/** True if URL is a YouTube Mix/Radio (list=RD...) – embed will auto-advance, do NOT call next() on ENDED. */
export function isYouTubeMixUrl(url: string): boolean {
  const listId = getYouTubePlaylistId(url);
  return !!listId && (listId.startsWith("RD") || url.includes("start_radio=1"));
}

/** YouTube source kind: single video/track vs multi-track (playlist/radio/mix). */
export type YouTubeSourceKind = "single" | "multi";

/**
 * Classify a YouTube URL as single-track or multi-track.
 * Multi-track: playlist (list=PLxxx), radio (list=RDxxx), mix (start_radio=1), or similar.
 * Single: normal video URL without list/radio params.
 */
export function getYouTubeSourceKind(url: string | null): YouTubeSourceKind {
  if (!url || typeof url !== "string") return "single";
  const u = url.trim().toLowerCase();
  if (!u.includes("youtube.com") && !u.includes("youtu.be")) return "single";
  if (u.includes("list=")) return "multi";
  if (u.includes("start_radio=1")) return "multi";
  return "single";
}

/** True if URL is a YouTube multi-track source (playlist, radio, mix). */
export function isYouTubeMultiTrackUrl(url: string | null): boolean {
  return getYouTubeSourceKind(url) === "multi";
}

/**
 * For library `origin: "source"` rows, attached `playlist` metadata must not drive in-app
 * multi-track sessions (next/prev over tracks) when the URL is a playlist/list context —
 * that would nest unbounded playlist expansion inside another playlist/schedule.
 * Real playlist entities use `origin: "playlist"`.
 */
export function effectivePlaybackPlaylistAttachment(source: UnifiedSource | null): Playlist | null {
  if (!source?.playlist) return null;
  if (source.origin === "playlist") return source.playlist;
  const url = source.url ?? "";
  if (String(source.type) === "playlist_url") return null;
  if (/youtube\.com\/playlist/i.test(url)) return null;
  if (isYouTubeMultiTrackUrl(url)) return null;
  return source.playlist;
}

/** Build YouTube thumbnail URL. */
export function getYouTubeThumbnail(url: string): string | null {
  const vid = getYouTubeVideoId(url);
  return vid ? `https://img.youtube.com/vi/${vid}/hqdefault.jpg` : null;
}

/** Best-effort thumbnail for one playlist leaf row (saved cover or YouTube still from URL). */
export function derivePlaylistTrackCoverArt(track: Pick<PlaylistTrack, "cover" | "url" | "type">): string | null {
  const c = `${track.cover ?? ""}`.trim();
  if (c) return c;
  const url = `${track.url ?? ""}`.trim();
  if (!url) return null;
  if (track.type === "youtube") return getYouTubeThumbnail(url);
  const low = url.toLowerCase();
  if (low.includes("youtube.com") || low.includes("youtu.be")) return getYouTubeThumbnail(url);
  return null;
}

/** Cover for unified/API playlist rows — playlist thumbnail, first usable track thumb, else root URL thumb. */
export function derivePlaylistUnifiedCoverArt(p: Playlist): string | null {
  const row = `${p.thumbnail ?? ""}`.trim() || `${p.cover ?? ""}`.trim();
  if (row) return row;
  for (const track of getPlaylistTracks(p)) {
    const thumb = derivePlaylistTrackCoverArt(track);
    if (thumb) return thumb;
  }
  const root = `${p.url ?? ""}`.trim();
  return root ? getYouTubeThumbnail(root) : null;
}

/** Player hero fallback: leaf track → playlist row art → playlist track scan → UnifiedSource envelope. */
export function resolvePlaybackHeroCoverArt(input: {
  trackCover?: string | null;
  trackUrl?: string | null | undefined;
  trackType?: string | null | undefined;
  sourceCover?: string | null;
  sourceUrl?: string | null | undefined;
  playlist: Playlist | null | undefined;
}): string | null {
  const leaf = derivePlaylistTrackCoverArt({
    cover: input.trackCover ?? undefined,
    url: `${input.trackUrl ?? ""}`,
    type: (input.trackType ?? "stream-url") as PlaylistType,
  });
  if (leaf) return leaf;

  const pl = input.playlist ?? null;
  if (pl) {
    const row = `${pl.thumbnail ?? ""}`.trim() || `${pl.cover ?? ""}`.trim();
    if (row) return row;
    for (const tr of getPlaylistTracks(pl)) {
      const tc = derivePlaylistTrackCoverArt(tr);
      if (tc) return tc;
    }
    const plUrl = `${pl.url ?? ""}`.trim();
    const fromRoot = plUrl ? getYouTubeThumbnail(plUrl) : null;
    if (fromRoot) return fromRoot;
  }

  return derivePlaylistTrackCoverArt({
    cover: input.sourceCover ?? undefined,
    url: `${input.sourceUrl ?? ""}`,
    type: (input.trackType ?? "stream-url") as PlaylistType,
  });
}

/** Check if URL is a Shazam song page. */
export function isShazamUrl(url: string): boolean {
  return /shazam\.com\/song\//i.test(url.trim());
}

/** Extract song name from Shazam URL path (e.g. /song/123/artist-song -> "artist song"). */
export function extractShazamSongFromPath(url: string): string | null {
  try {
    const u = new URL(url);
    const match = u.pathname.match(/\/song\/\d+\/([^/]+)/);
    if (!match) return null;
    const slug = decodeURIComponent(match[1]);
    return slug.replace(/-/g, " ").trim() || null;
  } catch {
    return null;
  }
}

/** Best-effort host without leading `www.`. */
function normalizedHostname(url: URL): string {
  return url.hostname.replace(/^www\./i, "").toLowerCase();
}

/**
 * Stage 6B: classify external music URLs for Library paste/drop (no resolution / no picker).
 * Callers gate Shazam (`isShazamUrl`) for the legacy YouTube-resolve flow before treating as generic resolve.
 */
export function classifyMusicUrlIngest(raw: string): MusicUrlIngestClassification {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return ingestIntentForProvider("generic_music_url", "unknown");
  }

  const host = normalizedHostname(u);
  const lowerPath = `${u.pathname}`.toLowerCase();
  const search = `${u.search}`;

  /** After known hosts fail: generic https “page” ingest (inherits legacy stream-url fallback). */
  const genericHttpsStream = (): MusicUrlIngestClassification => {
    if (u.protocol === "http:" || u.protocol === "https:") {
      const t = inferPlaylistType(raw.trim());
      if (t === "stream-url") return ingestIntentForProvider("generic_music_url", "unknown");
    }
    return ingestIntentForProvider("generic_music_url", "unknown");
  };

  // Shazam (UI keeps dedicated branch; classifier tags provider for callers / parse-url)
  if (host.includes("shazam.com") && /\/song\//i.test(lowerPath)) {
    return ingestIntentForProvider("shazam", "resolve_to_youtube");
  }

  // YouTube / YouTube Music
  if (host === "music.youtube.com") {
    return ingestIntentForProvider("youtube_music", "direct_playable");
  }
  if (host === "youtu.be" || host.endsWith(".youtube.com") || host.endsWith(".youtube.googleapis.com")) {
    return ingestIntentForProvider("youtube", "direct_playable");
  }
  if (host.includes("youtube.com")) {
    return ingestIntentForProvider("youtube", "direct_playable");
  }

  // SoundCloud
  if (host.includes("soundcloud.com")) {
    return ingestIntentForProvider("soundcloud", "direct_playable");
  }

  // Spotify
  if (
    host === "open.spotify.com" ||
    host === "spotify.com" ||
    host.endsWith(".spotify.com") ||
    host === "spotify.link" ||
    host.endsWith(".spotify.link") ||
    host === "toi.link"
  ) {
    if (/^\/intl-[^/]+/i.test(lowerPath)) {
      const rest = lowerPath.replace(/^\/intl-[^/]+/i, "");
      const pathForKind = rest || lowerPath;
      if (/\/album\//i.test(pathForKind) || /\/playlist\//i.test(pathForKind) || /\/show\//i.test(pathForKind) || /\/episode\//i.test(pathForKind) || /\/collection\//i.test(pathForKind)) {
        return ingestIntentForProvider("spotify", "unsupported_playlist_or_album");
      }
      if (/\/artist\//i.test(pathForKind)) return ingestIntentForProvider("spotify", "unsupported_playlist_or_album");
      return ingestIntentForProvider("spotify", "resolve_to_youtube");
    }
    if (/\/album\//i.test(lowerPath) || /\/playlist\//i.test(lowerPath) || /\/show\//i.test(lowerPath) || /\/episode\//i.test(lowerPath) || /\/collection\//i.test(lowerPath)) {
      return ingestIntentForProvider("spotify", "unsupported_playlist_or_album");
    }
    if (/\/artist\//i.test(lowerPath)) return ingestIntentForProvider("spotify", "unsupported_playlist_or_album");
    return ingestIntentForProvider("spotify", "resolve_to_youtube");
  }

  // Apple Music (primary host + regional `music.apple.*`)
  const isAppleMusicDomain = host.includes("music.apple.");
  const isLegacyItunesWeb = host.endsWith("itunes.apple.com") && /\/(album|song|playlist)\//i.test(lowerPath);

  if (isAppleMusicDomain || isLegacyItunesWeb) {
    if (/\/playlist\//i.test(lowerPath)) return ingestIntentForProvider("apple_music", "unsupported_playlist_or_album");
    const albumFocusedTrack = Boolean(search && /\/album\//i.test(lowerPath) && /\bi=/i.test(search));
    if (/\/album\//i.test(lowerPath)) {
      if (albumFocusedTrack) return ingestIntentForProvider("apple_music", "resolve_to_youtube");
      return ingestIntentForProvider("apple_music", "unsupported_playlist_or_album");
    }
    if (/\/(artist|browse)\//i.test(lowerPath)) return ingestIntentForProvider("apple_music", "unsupported_playlist_or_album");
    if (/\/song\//i.test(lowerPath)) return ingestIntentForProvider("apple_music", "resolve_to_youtube");
    return ingestIntentForProvider("apple_music", "resolve_to_youtube");
  }

  const beatHosts = ["beatport.com", "beatsource.com"];
  if (beatHosts.some((h) => host === h || host.endsWith("." + h))) {
    const prov: MusicStreamingProvider = host.includes("beatsource") ? "beatsource" : "beatport";
    if (/\/releases?\//i.test(lowerPath)) return ingestIntentForProvider(prov, "unsupported_playlist_or_album");
    if (/\/label\//i.test(lowerPath) || /\/chart\//i.test(lowerPath)) return ingestIntentForProvider(prov, "unsupported_playlist_or_album");
    return ingestIntentForProvider(prov, "resolve_to_youtube");
  }

  // Juno Download / Juno UK store
  const isJunoDownload = host === "junodownload.com" || host.endsWith(".junodownload.com");
  if (isJunoDownload || host.endsWith(".juno.co.uk")) {
    if (/\/albums?\//i.test(lowerPath)) {
      return ingestIntentForProvider(isJunoDownload ? "juno_download" : "generic_music_url", "unsupported_playlist_or_album");
    }
    if (isJunoDownload) return ingestIntentForProvider("juno_download", "resolve_to_youtube");
    return ingestIntentForProvider("generic_music_url", "resolve_to_youtube");
  }

  const isDeezer = host.endsWith(".deezer.com") || host === "deezer.page.link";
  if (host.includes("deezer.com") || isDeezer) {
    if (/\/playlist\//i.test(lowerPath) || /\/album\//i.test(lowerPath) || /\/episode\//i.test(lowerPath) || /\/podcast\//i.test(lowerPath)) {
      return ingestIntentForProvider("deezer", "unsupported_playlist_or_album");
    }
    if (/\/artist\//i.test(lowerPath)) return ingestIntentForProvider("deezer", "unsupported_playlist_or_album");
    return ingestIntentForProvider("deezer", "resolve_to_youtube");
  }

  const isTidal = host === "tidal.com" || host.endsWith(".tidal.com");
  if (isTidal || host === "listen.tidal.com") {
    if (
      /(\/browse)?\/playlist\//i.test(lowerPath) ||
      /\/album\//i.test(lowerPath) ||
      /\/artist\//i.test(lowerPath)
    ) {
      return ingestIntentForProvider("tidal", "unsupported_playlist_or_album");
    }
    if (/\b\/mix\/?/i.test(lowerPath)) return ingestIntentForProvider("tidal", "unsupported_playlist_or_album");
    return ingestIntentForProvider("tidal", "resolve_to_youtube");
  }

  const amazonMusicHints =
    host.startsWith("music.amazon.") ||
    host.endsWith(".music.amazon.") ||
    (host.endsWith(".amazon.com") &&
      (/^\/music(?:\/|$|\?)/i.test(lowerPath) || /\/stores\/music\/?/i.test(lowerPath)));

  if (amazonMusicHints || (host.endsWith(".amazon.") && /\.amazon\.[a-z.]+$/i.test(host) && (/^\/(?:[\w-]+\/)?(?:album|albums|playlist|playlists)/i.test(lowerPath)))) {
    const prov: MusicStreamingProvider = "amazon_music";
    const looksAlbumOrPlaylist =
      /\/playlist\/?/i.test(lowerPath) ||
      /albums\b/i.test(lowerPath) ||
      /\/browse\/featured-playlists\b/i.test(lowerPath);
    const looksStation = /stations?\b/i.test(lowerPath);
    const looksAlbumOnly = /\b(album\/|\/album\b)/i.test(lowerPath);
    const looksSingleTrack =
      /\b(track|tracks|song|dmusic|SINGLE)\b/i.test(lowerPath + search) ||
      /asin=/i.test(search) ||
      /trackasin=/i.test(search);
    if (looksAlbumOrPlaylist || looksStation || (looksAlbumOnly && !looksSingleTrack && !/[?&](i|song|songId|songID)=/i.test(search))) {
      return ingestIntentForProvider(prov, "unsupported_playlist_or_album");
    }
    return ingestIntentForProvider(prov, "resolve_to_youtube");
  }

  const isQobuz = host.endsWith(".qobuz.com");
  if (isQobuz) {
    if (/\/album\/?/i.test(lowerPath)) return ingestIntentForProvider("qobuz", "unsupported_playlist_or_album");
    if (/\/playlist\/?/i.test(lowerPath)) return ingestIntentForProvider("qobuz", "unsupported_playlist_or_album");
    if (/\/track\b/i.test(lowerPath)) return ingestIntentForProvider("qobuz", "resolve_to_youtube");
    return ingestIntentForProvider("qobuz", "resolve_to_youtube");
  }

  const isBandcampHost = host === "bandcamp.com" || host.endsWith(".bandcamp.com");
  if (isBandcampHost) {
    if (/\/album\//i.test(lowerPath)) return ingestIntentForProvider("bandcamp", "unsupported_playlist_or_album");
    return ingestIntentForProvider("bandcamp", "resolve_to_youtube");
  }

  return genericHttpsStream();
}

/** Infer playlist type from URL or path. */
export function inferPlaylistType(url: string): PlaylistType {
  const u = url.toLowerCase().trim();
  if (u.includes("youtube.com") || u.includes("youtu.be")) return "youtube";
  if (u.includes("soundcloud.com")) return "soundcloud";
  if (u.includes("spotify.com") || u.includes("open.spotify.com")) return "spotify";
  if (u.match(/\.(m3u8?|pls)(\?|$)/i)) return "winamp";
  if (u.startsWith("http://") || u.startsWith("https://")) return "stream-url";
  return "local";
}

/**
 * True when parse-url titles are useless for storefront → YouTube search
 * (“Spotify”, “Beatport”, bare host-shaped labels, placeholders).
 */
export function isWeakStorefrontParsedTitle(title: string | null | undefined): boolean {
  const t = (title ?? "").trim();
  if (!t) return true;
  const low = t.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  if (low.length < 3) return true;
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/.test(low) && !/\s/.test(low)) return true;

  const weakExact = new Set([
    "spotify",
    "open.spotify.com",
    "spotify.com",
    "beatport",
    "www.beatport.com",
    "beatport.com",
    "beatsource",
    "beatsource.com",
    "www.beatsource.com",
    "deezer",
    "tidal",
    "amazon music",
    "qobuz",
    "untitled",
    "soundcloud track",
    "youtube video",
    "open.spotify",
  ]);
  if (weakExact.has(low)) return true;
  if (/^youtube\s+[a-z0-9_-]{6,}$/i.test(t.trim())) return true;
  return false;
}

/** Beatport / Beatsource `/track/{slug}/{id}` slug → readable query words (keeps remix tokens). */
export function parseBeatportLikeTrackSlugFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const h = u.hostname.replace(/^www\./i, "").toLowerCase();
    if (!h.endsWith("beatport.com") && !h.endsWith("beatsource.com")) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    const ti = parts.findIndex((p) => p.toLowerCase() === "track");
    if (ti < 0) return null;
    const after = parts.slice(ti + 1);
    if (after.length === 0) return null;
    let slug = after[0]!;
    if (after.length >= 2 && /^\d+$/.test(after[after.length - 1]!)) {
      slug = after[after.length - 2]!;
    }
    if (!slug || slug.length < 2 || /^\d+$/.test(slug)) return null;
    return beatportPathSegmentToWords(slug);
  } catch {
    return null;
  }
}

/** URL path segment (hyphens) → space-separated phrase. */
export function beatportPathSegmentToWords(segment: string): string {
  try {
    return decodeURIComponent(segment.replace(/\+/g, "%20"))
      .replace(/-/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    return segment.replace(/-/g, " ").replace(/\s+/g, " ").trim();
  }
}
