/**
 * Stage 5C-D — conservative scoring for bulk YouTube resolution of unresolved M3U rows.
 * No network I/O; used by the modal only.
 */

import type { YouTubeSearchResult } from "@/lib/search-service";
import { getYouTubeVideoId } from "@/lib/playlist-utils";
import type { M3uUnresolvedImportRow } from "@/lib/m3u-youtube-resolve-shared";

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "ft",
  "feat",
  "featuring",
  "vs",
  "remastered",
  "remaster",
  "hq",
  "hd",
  "lyrics",
  "lyric",
]);

/** Whole-word / phrase signals that usually mean a *different* recording than the playlist line. */
const DISTRUST_PATTERNS: { re: RegExp; keyword: string }[] = [
  { re: /\blive\b/i, keyword: "live" },
  { re: /\blive\s+at\b/i, keyword: "live at" },
  { re: /\bremix\b/i, keyword: "remix" },
  { re: /\bcover\b/i, keyword: "cover" },
  { re: /\bkaraoke\b/i, keyword: "karaoke" },
  { re: /\breaction\b/i, keyword: "reaction" },
  { re: /\bfull\s+album\b/i, keyword: "full album" },
  { re: /\bconcert\b/i, keyword: "concert" },
  { re: /\bcompilation\b/i, keyword: "compilation" },
  { re: /\b8d\b|\bnightcore\b|\bslowed\s*&/i, keyword: "edit" },
];

function normalizeForTokens(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function tokenizeForOverlap(s: string): string[] {
  const n = normalizeForTokens(s);
  const raw = n.split(/[^a-z0-9]+/).filter((t) => t.length >= 2);
  return raw.filter((t) => !STOPWORDS.has(t));
}

/** Query tokens from playlist hint + optional M3U title. */
export function buildQueryTokens(row: M3uUnresolvedImportRow): string[] {
  const parts = [row.suggestedSearchQuery, row.displayTitle ?? ""].filter(Boolean);
  const bag = new Set<string>();
  for (const p of parts) {
    for (const t of tokenizeForOverlap(p)) bag.add(t);
  }
  return [...bag];
}

function queryAllowsKeyword(queryNorm: string, keyword: string): boolean {
  return queryNorm.includes(keyword.replace(/\s+/g, " ").trim());
}

/**
 * Returns true if `title` contains a distrust signal not justified by the query.
 */
export function titleHasForbiddenSignal(videoTitle: string, queryBlob: string): boolean {
  const qn = normalizeForTokens(queryBlob);
  const tn = normalizeForTokens(videoTitle);
  for (const { re, keyword } of DISTRUST_PATTERNS) {
    if (!re.test(tn)) continue;
    if (!queryAllowsKeyword(qn, keyword)) return true;
  }
  return false;
}

/**
 * How strongly the title resembles an "official" YouTube lineage (playlist-first UX).
 * Higher = stronger official signal. Used only for narrowing display order.
 * Order per product: Official Video ≥ Official Audio ≥ Topic ≥ VEVO.
 */
export function youtubeOfficialDisplayRank(title: string): number {
  const t = normalizeForTokens(title);
  let r = 0;
  if (
    /\bofficial\s+(music\s+)?video\b/i.test(title) ||
    (/\bofficial\b/i.test(title) && /\bvideo\b/i.test(title))
  )
    r = Math.max(r, 4);
  if (/\bofficial\s+audio\b/i.test(title)) r = Math.max(r, 3);
  if (/\s-\s*topic\b/i.test(t) || /\byoutube\s+music\b/i.test(t)) r = Math.max(r, 2);
  if (/\bvevo\b/i.test(t)) r = Math.max(r, 1);
  return r;
}

function hasOfficialFlavor(titleNorm: string): boolean {
  return youtubeOfficialDisplayRank(titleNorm) >= 1;
}

function durationFitScore(expectedSec: number | null, actualSec: number | undefined): number {
  if (expectedSec == null || !Number.isFinite(expectedSec) || expectedSec <= 0) return 0;
  if (actualSec == null || !Number.isFinite(actualSec) || actualSec <= 0) return -0.02; // unknown duration: small penalty

  const diff = Math.abs(expectedSec - actualSec);
  const tol = Math.max(12, Math.min(45, expectedSec * 0.08));
  if (diff <= tol) return 0.14;
  if (diff <= Math.max(45, expectedSec * 0.15)) return 0.04;
  if (diff > 120 && expectedSec > 90) return -0.22;
  return -0.08;
}

export type BulkYoutubeMatchTier = "safe" | "review" | "none";

export type BulkYoutubeConfidenceResult = {
  score: number;
  tier: BulkYoutubeMatchTier;
  /** Best-effort for debugging UI (optional). */
  flags: string[];
};

const SAFE_SCORE_MIN = 0.78;
const REVIEW_SCORE_MIN = 0.44;

/**
 * Score a YouTube search hit against one unresolved row. Conservative: prefers overlap + official + duration.
 */
export function scoreYoutubeCandidateForRow(
  row: M3uUnresolvedImportRow,
  candidate: YouTubeSearchResult,
  /** Index in search results (0 = top). */
  rank: number,
): BulkYoutubeConfidenceResult {
  const flags: string[] = [];
  const id = getYouTubeVideoId(candidate.url);
  if (!id || id.length < 6) {
    return { score: 0, tier: "none", flags: ["invalid_video_id"] };
  }

  const queryBlob = [row.suggestedSearchQuery, row.displayTitle ?? ""].join(" ");
  const queryTokens = buildQueryTokens(row);
  const titleNorm = normalizeForTokens(candidate.title);

  if (titleHasForbiddenSignal(candidate.title, queryBlob)) {
    flags.push("forbidden_keyword");
    return { score: 0.15, tier: "none", flags };
  }

  let score = 0.38;
  const titleTokens = new Set(tokenizeForOverlap(candidate.title));
  if (queryTokens.length === 0) {
    flags.push("empty_query_tokens");
    score = 0.35;
  } else {
    let hits = 0;
    for (const qt of queryTokens) {
      if (titleTokens.has(qt)) hits++;
    }
    const ratio = hits / queryTokens.length;
    score += Math.min(0.36, ratio * 0.42);
    if (ratio >= 0.65) flags.push("strong_token_overlap");
    else if (ratio < 0.35) flags.push("weak_token_overlap");
  }

  if (hasOfficialFlavor(titleNorm)) {
    score += 0.1;
    flags.push("official_flavor");
  }

  score += durationFitScore(row.durationSec, candidate.durationSeconds);
  if (row.durationSec && candidate.durationSeconds) {
    const d = Math.abs(row.durationSec - candidate.durationSeconds);
    if (d <= 15) flags.push("duration_close");
  }

  // Prefer earlier search results slightly (API order is usually relevant).
  score -= Math.min(0.06, rank * 0.02);

  score = Math.max(0, Math.min(1, score));

  let tier: BulkYoutubeMatchTier = "none";
  if (score >= SAFE_SCORE_MIN) tier = "safe";
  else if (score >= REVIEW_SCORE_MIN) tier = "review";

  // Long queries need enough distinct token hits — avoids one-token flukes.
  if (tier === "safe" && queryTokens.length >= 4) {
    const hits = queryTokens.filter((t) => titleTokens.has(t)).length;
    const need = Math.max(2, Math.ceil(queryTokens.length * 0.45));
    if (hits < need) {
      tier = "review";
      flags.push("insufficient_token_hits");
      score = Math.min(score, SAFE_SCORE_MIN - 0.02);
    }
  }

  return { score, tier, flags };
}

/** Max raw YouTube hits considered before narrowing (no long UI lists). */
export const M3U_YOUTUBE_RAW_CANDIDATE_CAP = 32;

/** Max candidates shown per unresolved row in the M3U resolve modal. */
export const M3U_YOUTUBE_DISPLAY_CANDIDATE_MAX = 3;

export type NarrowYoutubeCandidatesForM3uResult = {
  display: YouTubeSearchResult[];
  /** True when slot 1 was chosen from the official-qualified pool / official ranking. */
  primaryWasOfficialRanking: boolean;
};

/**
 * Picks ≤3 hits: prefer one best "official lineage" clip, then up to two by confidence + views.
 * Drops live/remix/cover/etc. unless the playlist query justified them (reuse `titleHasForbiddenSignal`).
 */
export function narrowYoutubeCandidatesForM3uRow(
  row: M3uUnresolvedImportRow,
  raw: YouTubeSearchResult[],
): NarrowYoutubeCandidatesForM3uResult {
  const queryBlob = [row.suggestedSearchQuery, row.displayTitle ?? ""].join(" ");
  const seen = new Set<string>();
  const pool: YouTubeSearchResult[] = [];
  for (const c of raw.slice(0, M3U_YOUTUBE_RAW_CANDIDATE_CAP)) {
    if (c.type !== "youtube") continue;
    const id = getYouTubeVideoId(c.url);
    if (!id || id.length < 6 || seen.has(id)) continue;
    if (titleHasForbiddenSignal(c.title, queryBlob)) continue;
    seen.add(id);
    pool.push(c);
  }
  if (pool.length === 0) return { display: [], primaryWasOfficialRanking: false };

  const enriched = pool.map((c, rank) => ({
    c,
    rank,
    official: youtubeOfficialDisplayRank(c.title),
    result: scoreYoutubeCandidateForRow(row, c, rank),
  }));

  const byConfidenceThenViews = (a: (typeof enriched)[number], b: (typeof enriched)[number]): number => {
    const ds = b.result.score - a.result.score;
    if (Math.abs(ds) > 1e-6) return ds;
    return (b.c.viewCount ?? 0) - (a.c.viewCount ?? 0);
  };

  const hasOfficial = enriched.some((e) => e.official >= 1);
  let display: YouTubeSearchResult[];
  let primaryWasOfficialRanking = false;

  if (hasOfficial) {
    primaryWasOfficialRanking = true;
    const officialPool = enriched.filter((e) => e.official >= 1);
    officialPool.sort((a, b) => {
      const d = b.official - a.official;
      if (d !== 0) return d;
      return byConfidenceThenViews(a, b);
    });
    const primary = officialPool[0]!.c;
    const primaryId = getYouTubeVideoId(primary.url);
    const rest = enriched
      .filter((e) => getYouTubeVideoId(e.c.url) !== primaryId)
      .sort(byConfidenceThenViews)
      .slice(0, M3U_YOUTUBE_DISPLAY_CANDIDATE_MAX - 1)
      .map((e) => e.c);
    display = [primary, ...rest];
  } else {
    display = [...enriched].sort(byConfidenceThenViews).slice(0, M3U_YOUTUBE_DISPLAY_CANDIDATE_MAX).map((e) => e.c);
  }

  return { display, primaryWasOfficialRanking };
}

/** Minimum gap between #1 and #2 scores to auto-accept "safe" without ambiguity. */
const SAFE_MARGIN = 0.06;

export function classifyTopCandidates(
  row: M3uUnresolvedImportRow,
  candidates: YouTubeSearchResult[],
): {
  best: YouTubeSearchResult | null;
  bestResult: BulkYoutubeConfidenceResult | null;
  secondScore: number;
  bestRank: number;
} {
  if (candidates.length === 0) {
    return { best: null, bestResult: null, secondScore: 0, bestRank: -1 };
  }
  const scored = candidates.map((c, rank) => ({
    c,
    rank,
    result: scoreYoutubeCandidateForRow(row, c, rank),
  }));
  scored.sort((a, b) => b.result.score - a.result.score);
  const first = scored[0]!;
  const second = scored[1];
  const secondScore = second ? second.result.score : 0;
  return {
    best: first.c,
    bestResult: first.result,
    secondScore,
    bestRank: first.rank,
  };
}

/**
 * True if the top candidate is eligible for automatic selection (conservative).
 */
export function isSafeAutoPick(
  row: M3uUnresolvedImportRow,
  candidates: YouTubeSearchResult[],
): boolean {
  if (candidates.length === 0) return false;
  const { best, bestResult, secondScore } = classifyTopCandidates(row, candidates);
  if (!best || !bestResult) return false;
  if (bestResult.tier !== "safe") return false;
  if (bestResult.score - secondScore < SAFE_MARGIN && candidates.length > 1) return false;
  return true;
}
