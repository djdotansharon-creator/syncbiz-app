/**
 * Deterministic music-first relevance for search results (no network, no AI).
 * Designed so a future query-intent layer (e.g. lyrics_snippet) can wrap or extend scoring.
 */

import type { UnifiedSource } from "./source-types";
import { getPlaylistTracks } from "./playlist-types";

/** Strong non-music cues in titles (precision over recall). */
const NON_MUSIC_PHRASES = [
  /\bpodcast\b/i,
  /\binterview\b/i,
  /\btutorial\b/i,
  /\breview\b/i,
  /\bvlog\b/i,
  /\blecture\b/i,
  /\bdocumentary\b/i,
  /\bexplained\b/i,
  /\breaction\b/i,
  /\bdebate\b/i,
  /\bcnn\b/i,
  /\bhow\s+to\b/i,
] as const;

const NON_MUSIC_WORDS = [
  "podcast",
  "interview",
  "tutorial",
  "review",
  "vlog",
  "lecture",
  "documentary",
  "explained",
  "reaction",
  "debate",
] as const;

/** Music-friendly cues in titles. */
const MUSIC_PHRASES = [
  /\bofficial\s+audio\b/i,
  /\bradio\s+edit\b/i,
  /\blive\s+set\b/i,
  /\blive\s+mix\b/i,
  /\blive\s+performance\b/i,
  /\blive\s+concert\b/i,
  /\blive\s+session\b/i,
  /\bfull\s+set\b/i,
  /\bdj\s+set\b/i,
  /\b1\s*hour\b/i,
  /\b2\s*hour\b/i,
  /\b3\s*hour\b/i,
] as const;

const MUSIC_WORDS = [
  "mix",
  "remix",
  "dj",
  "set",
  "playlist",
  "lyrics",
  "extended",
  "mixtape",
  "feat",
  "ft.",
  "ft ",
  "remaster",
  "visualizer",
] as const;

/** `live` alone is not boosted; only phrases above or `liveWithMusicCueBoost`. */
const LIVE_WITH_MUSIC_CUE = /\b(mix|remix|dj|set|playlist|lyrics|feat|remaster|visualizer|mixtape|extended|album|track|song|concert|hour|session|official|studio|radio)\b/i;

const PENALTY_PER_HIT = 14;
const MAX_NON_MUSIC_PENALTY = 52;
const BOOST_PER_MUSIC = 9;
const MAX_MUSIC_BOOST = 36;
const MAX_QUERY_OVERLAP = 22;
const MAX_CONTEXT_BOOST = 14;

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

/** Tokenize query into meaningful words (length >= 2). */
export function tokenizeQuery(query: string): string[] {
  return normalize(query)
    .split(/\s+/)
    .map((w) => w.replace(/^[^\w\u0590-\u05FF]+|[^\w\u0590-\u05FF]+$/gi, ""))
    .filter((w) => w.length >= 2);
}

/** Word-boundary `news`; exempt common music/song titling "good news". */
function countNewsPenalty(text: string): number {
  if (/\bgood\s+news\b/i.test(text)) return 0;
  if (/\bnews\b/i.test(text)) return PENALTY_PER_HIT;
  return 0;
}

/** Non-music "update" patterns only — not bare track names like "Update". */
function countUpdatePenalty(text: string): number {
  if (/\bupdate\s*:/i.test(text)) return PENALTY_PER_HIT;
  if (/\b(?:daily|weekly|breaking)\s+update\b/i.test(text)) return PENALTY_PER_HIT;
  if (/\bnews\s+update\b/i.test(text)) return PENALTY_PER_HIT;
  if (/\bupdate\s+(?:video|vlog|episode|channel)\b/i.test(text)) return PENALTY_PER_HIT;
  return 0;
}

function countNonMusicPenalty(text: string): number {
  let p = 0;
  for (const re of NON_MUSIC_PHRASES) {
    if (re.test(text)) p += PENALTY_PER_HIT;
  }
  const lower = text.toLowerCase();
  for (const w of NON_MUSIC_WORDS) {
    if (lower.includes(w)) p += PENALTY_PER_HIT;
  }
  p += countNewsPenalty(text);
  p += countUpdatePenalty(text);
  return Math.min(p, MAX_NON_MUSIC_PENALTY);
}

/** Extra `live` boost only with a music cue (phrases like live set are in MUSIC_PHRASES). */
function liveWithMusicCueBoost(text: string): number {
  if (!/\blive\b/i.test(text)) return 0;
  if (/\blive\s+(?:set|mix|performance|concert|session)\b/i.test(text)) return 0;
  if (LIVE_WITH_MUSIC_CUE.test(text)) return BOOST_PER_MUSIC;
  return 0;
}

function countMusicBoost(text: string): number {
  let b = 0;
  for (const re of MUSIC_PHRASES) {
    if (re.test(text)) b += BOOST_PER_MUSIC;
  }
  const lower = text.toLowerCase();
  for (const w of MUSIC_WORDS) {
    if (lower.includes(w)) b += BOOST_PER_MUSIC;
  }
  b += liveWithMusicCueBoost(text);
  return Math.min(b, MAX_MUSIC_BOOST);
}

/** Extra boost when query theme matches title (gym, restaurant jazz, etc.). */
function contextBoost(searchText: string, query: string): number {
  const q = normalize(query);
  const t = normalize(searchText);
  let b = 0;
  if (/\b(gym|workout|morning|cardio|run|training|lift)\b/.test(q)) {
    if (/\b(workout|gym|motivation|energy|pump|hype|cardio|running|pb|beats|mix|set)\b/.test(t)) b += 7;
  }
  if (/\b(restaurant|dinner|lounge|cafe|café|ambient)\b/.test(q)) {
    if (/\b(jazz|ambient|lounge|chill|smooth|dinner|bgm|background)\b/.test(t)) b += 7;
  }
  if (/\b(house|techno|trance|dub|afro|jazz|hip|hop|rap)\b/.test(q)) {
    if (/\b(house|techno|trance|dub|afro|jazz|hip|hop|rap)\b/.test(t)) b += 6;
  }
  return Math.min(b, MAX_CONTEXT_BOOST);
}

function queryTokenOverlap(searchText: string, query: string): number {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return 0;
  const hay = normalize(searchText);
  let o = 0;
  for (const tok of tokens) {
    if (tok.length < 2) continue;
    if (hay.includes(tok.toLowerCase())) o += 4;
  }
  return Math.min(o, MAX_QUERY_OVERLAP);
}

function durationAdjust(query: string, durationSeconds?: number): number {
  if (durationSeconds === undefined || durationSeconds <= 0) return 0;
  const q = normalize(query);
  const mixish = /\b(mix|set|dj|playlist|hours?|hour|full\s+set|mixtape)\b/.test(q);
  if (mixish) {
    if (durationSeconds >= 900) return 12;
    if (durationSeconds < 150) return -10;
  }
  if (/\b(song|track|single|lyrics)\b/.test(q) && durationSeconds > 600 && durationSeconds < 7200) {
    return 4;
  }
  return 0;
}

export type MusicRelevanceInput = {
  /** Primary label (e.g. video title). */
  title: string;
  query: string;
  durationSeconds?: number;
  /** Extra text to score overlap and penalties (genre, tags, track names). */
  auxiliaryText?: string;
};

/**
 * Higher = more likely music-relevant. Unbounded roughly in [-60, 80].
 */
export function scoreMusicRelevance(input: MusicRelevanceInput): number {
  const { title, query, durationSeconds, auxiliaryText } = input;
  const full = auxiliaryText ? `${title} ${auxiliaryText}` : title;
  const searchBlob = full;

  let score = 0;
  score -= countNonMusicPenalty(searchBlob);
  score += countMusicBoost(searchBlob);
  score += queryTokenOverlap(searchBlob, query);
  score += contextBoost(searchBlob, query);
  score += durationAdjust(query, durationSeconds);

  return score;
}

export type MusicFirstRankOptions = {
  maxResults: number;
  /** Drop results more than this below the best score (relative cut). */
  relativeDrop: number;
  /** Absolute floor; results below are removed unless fallback kicks in. */
  hardFloor: number;
};

const DEFAULT_RANK: MusicFirstRankOptions = {
  maxResults: 15,
  relativeDrop: 30,
  hardFloor: -36,
};

/**
 * Sort by music score descending, drop clear noise, cap length.
 * If strict filtering removes everything, returns up to 3 best-effort items (still sorted).
 */
export function rankMusicFirst<T extends { title: string; durationSeconds?: number }>(
  items: T[],
  query: string,
  options: Partial<MusicFirstRankOptions> = {}
): T[] {
  if (items.length === 0) return [];
  const opts = { ...DEFAULT_RANK, ...options };

  const scored = items.map((item) => ({
    item,
    score: scoreMusicRelevance({
      title: item.title,
      query,
      durationSeconds: item.durationSeconds,
    }),
  }));

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0].score;
  const relativeCut = best - opts.relativeDrop;

  let kept = scored.filter((s) => s.score >= relativeCut && s.score >= opts.hardFloor).map((s) => s.item);

  if (kept.length === 0) {
    kept = scored.slice(0, Math.min(3, scored.length)).map((s) => s.item);
  }

  return kept.slice(0, opts.maxResults);
}

/**
 * Radio rows: score title + genre/tags string; no duration.
 */
export function rankRadioMusicFirst<
  T extends { title: string; genre: string },
>(items: T[], query: string, maxResults: number): T[] {
  if (items.length === 0) return [];
  const scored = items.map((item) => ({
    item,
    score: scoreMusicRelevance({
      title: item.title,
      query,
      auxiliaryText: item.genre,
    }),
  }));
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0].score;
  const kept = scored
    .filter((s) => s.score >= best - 28 && s.score >= -40)
    .map((s) => s.item);
  const out = kept.length > 0 ? kept : scored.slice(0, Math.min(3, scored.length)).map((s) => s.item);
  return out.slice(0, maxResults);
}

function libraryAuxiliaryText(s: UnifiedSource): string {
  const parts: string[] = [];
  if (s.genre) parts.push(s.genre);
  if (s.origin === "radio" && s.radio?.name) parts.push(s.radio.name);
  if (s.source?.name) parts.push(s.source.name);
  if (s.playlist) {
    for (const tr of getPlaylistTracks(s.playlist)) {
      const n = tr.name || (tr as { title?: string }).title;
      if (n) parts.push(n);
    }
  }
  return parts.join(" ");
}

/**
 * Order library matches by music relevance; may drop weak matches (precision over recall).
 */
export function rankLibrarySourcesMusicFirst(sources: UnifiedSource[], query: string): UnifiedSource[] {
  if (sources.length === 0) return [];
  const scored = sources.map((s) => ({
    s,
    score: scoreMusicRelevance({
      title: s.title,
      query,
      auxiliaryText: libraryAuxiliaryText(s),
    }),
  }));
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0].score;
  const kept = scored.filter((x) => x.score >= best - 28 && x.score >= -42).map((x) => x.s);
  return kept.length > 0 ? kept : scored.slice(0, Math.min(8, scored.length)).map((x) => x.s);
}
