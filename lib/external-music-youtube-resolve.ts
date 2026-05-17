/**
 * Stage 6C — derive YouTube search query + narrowing context for pasted storefront track URLs.
 * Reuses `narrowYoutubeCandidatesForM3uRow` (official-first, ≤3 display).
 */

import { narrowYoutubeCandidatesForM3uRow } from "@/lib/m3u-youtube-bulk-confidence";
import type { M3uUnresolvedImportRow } from "@/lib/m3u-youtube-resolve-shared";
import {
  parseBeatportLikeTrackSlugFromUrl,
  isWeakStorefrontParsedTitle,
  beatportPathSegmentToWords,
} from "@/lib/playlist-utils";
import type { MusicStreamingProvider, ParseUrlJson } from "@/lib/source-types";
import type { YouTubeSearchResult } from "@/lib/search-service";

/** Single-track storefront links that surface the Stage 6C picker (excluding Shazam). */
export const MUSIC_URL_YOUTUBE_PICKER_PROVIDERS: readonly MusicStreamingProvider[] = [
  "spotify",
  "apple_music",
  "beatport",
  "beatsource",
  "deezer",
  "tidal",
  "amazon_music",
  "qobuz",
  "bandcamp",
];

const PICKER_SET = new Set<string>(MUSIC_URL_YOUTUBE_PICKER_PROVIDERS);

/** Domain-only queries that must never hit YouTube search. */
const BANNED_EXACT_SEARCH_QUERIES = new Set(
  [
    "open.spotify.com",
    "spotify.com",
    "spotify",
    "www.spotify.com",
    "beatport.com",
    "www.beatport.com",
    "beatport",
    "beatsource.com",
    "www.beatsource.com",
    "beatsource",
    "deezer.com",
    "music",
  ].map((s) => s.toLowerCase()),
);

const MUSIC_QUERY_STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "by",
  "ft",
  "feat",
  "featuring",
  "www",
  "com",
  "http",
  "https",
]);

export function isMusicUrlYoutubePickerProvider(provider: string): provider is MusicStreamingProvider {
  return PICKER_SET.has(provider);
}

function stripTrailingServiceTitles(title: string): string {
  let t = title.trim();
  t = t.replace(
    /\s*[\-|·|:]\s*(single\s+explicit|explicit|single|album)(\s+[·:|])?\s*.*$/i,
    "",
  );
  t = t.replace(/\s+on\s+apple\s+music.*$/i, "");
  t = t.replace(/\s+on\s+(spotify|deezer|tidal|youtube\s+music|beatport).*$/i, "");
  return t.trim();
}

/** Bandcamp and other hyphen slugs outside Beatport resolver. */
function fallbackSlugSegmentFromGenericUrl(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    if (u.hostname.endsWith("bandcamp.com") && parts.length >= 2) {
      return beatportPathSegmentToWords(parts[parts.length - 1]!);
    }
  } catch {
    /* ignore */
  }
  return "";
}

function splitArtistSongFrom(title: string): { artist?: string; song?: string } {
  const seps = [" — ", " – ", " - ", " | ", " • ", " · "];
  for (const sep of seps) {
    const i = title.indexOf(sep);
    if (i > 0 && i + sep.length < title.length) {
      const a = title.slice(0, i).trim();
      const b = title.slice(i + sep.length).trim();
      if (a && b) return { artist: a, song: b };
    }
  }
  return {};
}

/**
 * At least ~2 substantive tokens OR one clearly non-trivial word (avoid "spotify", "music").
 *
 * The tokenizer splits on any non-letter / non-digit Unicode character (`\p{L}` / `\p{N}`).
 * Earlier `[^a-z0-9]+` treated Hebrew, Cyrillic, CJK, Greek, etc. as separators — a Spotify
 * Hebrew track ("עומר אדם – פותחת לב") tokenised to `[]` and the whole query was dropped
 * with "Could not identify the track from this link" even though parse-url had returned
 * valid structured `artist` / `song`. Stopword and brand checks stay ASCII-only by design
 * (English noise words: "the", "ft", …; brand hosts: "spotify", "beatport", …) — those
 * keep matching after the existing NFKD/diacritic-strip ASCII fold.
 */
function hasMeaningfulMusicTokens(trimmedQuery: string): boolean {
  const n = trimmedQuery.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const tokens = n.split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 1);
  if (tokens.length === 0) return false;
  const meaningful = tokens.filter((t) => !MUSIC_QUERY_STOPWORDS.has(t));
  if (
    meaningful.length >= 2 &&
    !(meaningful.length === 2 && meaningful.every((x) => ["spotify", "music", "open", "listen"].includes(x)))
  ) {
    return true;
  }
  /** Single-token queries: reject known brands / hosts */
  if (meaningful.length === 1 && BANNED_EXACT_SEARCH_QUERIES.has(meaningful[0]!)) return false;
  if (meaningful.length === 1 && meaningful[0]!.length >= 5 && !["spotify", "beatport", "deezer"].includes(meaningful[0]!)) {
    return true;
  }
  return meaningful.length >= 2;
}

function sanitizeQueryCandidate(q: string): string {
  return q.replace(/\s+/g, " ").trim();
}

export type ExternalMusicYoutubeQueryResult =
  | { ok: true; query: string }
  | { ok: false };

/** Use after `/api/sources/parse-url` (+ Beatport slug path). Errors → `ok: false` (caller shows message). */
export function tryBuildExternalMusicYoutubeSearchQuery(
  parsed: ParseUrlJson,
  originalUrl: string,
): ExternalMusicYoutubeQueryResult {
  const artist = (parsed.artist ?? "").trim();
  const song = (parsed.song ?? "").trim();

  /** Prefer structured artist+song whenever both look real */
  const combinedArtistSong =
    artist && song && !isWeakStorefrontParsedTitle(artist) && !isWeakStorefrontParsedTitle(song)
      ? sanitizeQueryCandidate(`${artist} ${song}`)
      : "";

  let candidate = combinedArtistSong;

  if (!candidate) {
    const stripped = stripTrailingServiceTitles((parsed.title ?? "").trim());
    let fromTitle = stripped;

    /** Title split only if title isn't a storefront placeholder */
    if (fromTitle && !isWeakStorefrontParsedTitle(fromTitle)) {
      const sp = splitArtistSongFrom(fromTitle);
      if (
        sp.artist &&
        sp.song &&
        !isWeakStorefrontParsedTitle(sp.artist) &&
        !isWeakStorefrontParsedTitle(sp.song)
      ) {
        candidate = sanitizeQueryCandidate(`${sp.artist} ${sp.song}`);
      } else candidate = sanitizeQueryCandidate(fromTitle);
    }
  }

  if ((!candidate || isWeakStorefrontParsedTitle(candidate)) && !combinedArtistSong) {
    const beatSlug = parseBeatportLikeTrackSlugFromUrl(originalUrl.trim());
    if (beatSlug) candidate = sanitizeQueryCandidate(beatSlug);
  }

  if (!candidate || isWeakStorefrontParsedTitle(candidate)) {
    const bandcampOrOther = fallbackSlugSegmentFromGenericUrl(originalUrl.trim());
    if (bandcampOrOther.length >= 2) candidate = sanitizeQueryCandidate(bandcampOrOther);
  }

  const qFinal = sanitizeQueryCandidate(candidate);
  const lowBanned = qFinal.toLowerCase();
  if (
    qFinal.length < 2 ||
    BANNED_EXACT_SEARCH_QUERIES.has(lowBanned) ||
    isWeakStorefrontParsedTitle(qFinal) ||
    !hasMeaningfulMusicTokens(qFinal)
  ) {
    return { ok: false };
  }

  /** Host-shaped query with no spaces (e.g. residual hostname) */
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/.test(lowBanned)) {
    return { ok: false };
  }

  return { ok: true, query: qFinal };
}

/** Legacy: returns empty string when the query cannot be trusted. Prefer `tryBuildExternalMusicYoutubeSearchQuery`. */
export function buildExternalMusicYoutubeSearchQuery(parsed: ParseUrlJson, originalUrl: string): string {
  const r = tryBuildExternalMusicYoutubeSearchQuery(parsed, originalUrl);
  return r.ok ? r.query : "";
}

export function pseudoM3uRowForExternalMusicPaste(opts: {
  parsed: ParseUrlJson;
  searchQuery: string;
  originalUrl: string;
}): M3uUnresolvedImportRow {
  const displayTitle = (() => {
    const t = (opts.parsed.title ?? "").trim();
    if (!t || isWeakStorefrontParsedTitle(t)) return stripTrailingServiceTitles(t);
    return t;
  })();
  return {
    ref: opts.originalUrl.slice(0, 512),
    reason: "external_music_url",
    playlistOrder: 0,
    displayTitle: displayTitle || null,
    durationSec: opts.parsed.durationSeconds ?? null,
    suggestedSearchQuery: opts.searchQuery.trim(),
  };
}

export function narrowExternalMusicYoutubeDisplay(
  rawYoutube: readonly YouTubeSearchResult[],
  row: M3uUnresolvedImportRow,
) {
  return narrowYoutubeCandidatesForM3uRow(row, [...rawYoutube]);
}
