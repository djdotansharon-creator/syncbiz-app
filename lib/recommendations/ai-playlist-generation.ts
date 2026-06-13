/**
 * MVP — catalog-first AI playlist builder (deterministic scoring via {@link runSmartCatalogSearch}).
 * Always persists a NEW playlist row; never mutates the seed.
 */

import { cookies } from "next/headers";
import { ACTIVE_WORKSPACE_COOKIE_NAME } from "@/lib/active-workspace-constants";
import { ensurePlaylistTracksLinkedToCatalog } from "@/lib/catalog-store";
import { prisma } from "@/lib/prisma";
import { createPlaylist } from "@/lib/playlist-store";
import { inferPlaylistType } from "@/lib/playlist-utils";
import type { Playlist, PlaylistTrack } from "@/lib/playlist-types";
import { buildPlaylistDna, type PlaylistDNA } from "@/lib/recommendations/ai-playlist-dna";
import {
  resolveDjSmartSearchDjContext,
  type DjCreatorMatrixKey,
} from "@/lib/recommendations/dj-creator-search-context";
import type { SmartCatalogSearchResultRow } from "@/lib/recommendations/smart-catalog-search";
import { runSmartCatalogSearch } from "@/lib/recommendations/smart-catalog-search";
import {
  parseLocalSearchIntents,
  scoreLocalTrackForAiSearch,
  toLocalAiSearchMatchDebug,
  rankLocalAiSearchResults,
} from "@/lib/local-ai-playlist-search";
import { parseDjPlaylistRecipe, type DjPlaylistRecipe } from "@/lib/dj-intent-parse";
import {
  allocateLaneQuotas,
  interleaveLanePicks,
  lanePickScore,
} from "@/lib/ai-playlist-recipe-build-utils";
import { pickAiPlaylistThumbnail } from "@/lib/recommendations/ai-playlist-cover";
import {
  catalogRowMatchesParserSlugs,
  hasAnySubstantiveIntent,
  isSubstantiveMultiIntentQuery,
  rankCatalogRowsForAiIntents,
  splitCatalogPoolByIntentMatch,
  splitCatalogPoolByParserSlugOverlap,
  type CatalogRowWithIntentMatch,
} from "@/lib/recommendations/ai-playlist-intent-match";
import type { LocalSearchIntentParse } from "@/lib/local-ai-playlist-search";
import { parseSmartCatalogQuery } from "@/lib/recommendations/parse-smart-catalog-query";
import { applyLocalStrictFloor } from "@/lib/recommendations/local-strict-floor";
import {
  buildSiblingExclusionBundle,
  catalogRowMatchesExcludedSibling,
  localCandidateMatchesExcludedSibling,
  type SiblingExclusionBundle,
} from "@/lib/recommendations/sibling-exclusion";
import {
  deriveCatalogTrackMetadata,
  deriveLocalTrackMetadata,
  type DerivedTrackMetadata,
} from "@/lib/recommendations/derive-track-metadata";
import {
  DJ_INTENT_LOCAL_GROUP_DEFINITIONS,
  type DjIntentLocalGroupId,
} from "@/lib/dj-intent-dictionary";

/**
 * Map a local match-debug group label back to its `DjIntentLocalGroupId`.
 *
 * `AiPlaylistLocalCandidateMatchDebug` only carries the human label (not the
 * id), so we resolve via the dictionary at runtime. Returns null when the
 * label doesn't correspond to a known group (e.g. ad-hoc local query group).
 */
function groupLabelToId(label: string): DjIntentLocalGroupId | null {
  if (!label) return null;
  const needle = label.trim().toLowerCase();
  if (!needle) return null;
  for (const def of DJ_INTENT_LOCAL_GROUP_DEFINITIONS) {
    if (def.label.trim().toLowerCase() === needle) return def.id;
  }
  return null;
}

/**
 * Pilot Blocker — graceful "no strong matches" failure.
 *
 * Thrown by `executeAiPlaylistBuild` when strict relevance + sibling exclusion
 * leave us with zero playable rows. The route handler turns this into a 422
 * with a structured payload so the renderer can show a localized
 * "no strong matches" message instead of an opaque 500.
 *
 * We never create a playlist in this state — users must adjust the prompt
 * or extend their local scan.
 */
export class AiPlaylistNoStrongMatchesError extends Error {
  readonly kind = "no_strong_matches" as const;
  readonly intentLabel: string;
  readonly matchedCount: number;
  constructor(message: string, args: { intentLabel: string; matchedCount: number }) {
    super(message);
    this.name = "AiPlaylistNoStrongMatchesError";
    this.intentLabel = args.intentLabel;
    this.matchedCount = args.matchedCount;
  }
}

/** Phase 1b multi-lane build — paused while single-lane intent strictness is fixed. */
const MULTI_LANE_AI_BUILD_ENABLED = false;

export type AiPlaylistBuildMode = "prompt" | "similar" | "refine" | "expand";

import { AI_PLAYLIST_GENRE } from "@/lib/dj-creator-playlist-scope";
const DEFAULT_TARGET = 50;
/** Max tracks per AI build request (plan tiers may clamp lower later). */
export const AI_PLAYLIST_BUILD_MAX_COUNT = 100;
const ARTIST_CAP = 3;
/**
 * Phase 1 hybrid AI playlist: hard cap on local candidates accepted in one POST. Keeps
 * a malicious or buggy renderer from flooding the merge step. Local candidates are
 * scored and trimmed further during selection, so the practical contribution is smaller.
 */
const LOCAL_CANDIDATE_INPUT_CAP = 80;

export type AiPlaylistLocalCandidateMatchDebug = {
  groupsMatched: number;
  groupsTotal: number;
  fullMatch: boolean;
  score: number;
  reason: string;
  groups: Array<{ label: string; matched: boolean; terms: string[]; fields: string[] }>;
};

/** Trusted shape forwarded by the renderer (already filtered to snapshot rows on the desktop). */
export type AiPlaylistLocalCandidate = {
  localId: string;
  absolutePath: string;
  artist: string | null;
  title: string | null;
  album: string | null;
  genre: string | null;
  year: string | null;
  comment: string | null;
  durationSec: number | null;
  bpm: number | null;
  rating: number | null;
  /** Renderer-provided heuristic score; clamped here. */
  score: number;
  matchDebug?: AiPlaylistLocalCandidateMatchDebug;
};

function parseMatchDebug(raw: unknown): AiPlaylistLocalCandidateMatchDebug | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.groupsMatched !== "number" || typeof r.groupsTotal !== "number") return undefined;
  const groupsRaw = r.groups;
  const groups = Array.isArray(groupsRaw)
    ? groupsRaw
        .filter((g): g is Record<string, unknown> => !!g && typeof g === "object")
        .map((g) => ({
          label: typeof g.label === "string" ? g.label : "",
          matched: g.matched === true,
          terms: Array.isArray(g.terms) ? g.terms.filter((t): t is string => typeof t === "string") : [],
          fields: Array.isArray(g.fields) ? g.fields.filter((f): f is string => typeof f === "string") : [],
        }))
    : [];
  return {
    groupsMatched: r.groupsMatched,
    groupsTotal: r.groupsTotal,
    fullMatch: r.fullMatch === true,
    score: typeof r.score === "number" ? r.score : 0,
    reason: typeof r.reason === "string" ? r.reason : "",
    groups,
  };
}

function coerceStringOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function coerceFiniteNumberOrNull(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return v;
}

/**
 * Validate `additionalCandidates` from the API body. Unknown shapes return `[]` so the
 * build keeps running as catalog-only. The renderer (Desktop) sends:
 *   { localTracks: LocalAiPlaylistCandidate[] }
 */
export function parseAdditionalLocalCandidates(raw: unknown): AiPlaylistLocalCandidate[] {
  if (!raw || typeof raw !== "object") return [];
  const localTracksRaw = (raw as { localTracks?: unknown }).localTracks;
  if (!Array.isArray(localTracksRaw)) return [];
  const out: AiPlaylistLocalCandidate[] = [];
  for (const row of localTracksRaw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const absolutePath = coerceStringOrNull(r.absolutePath);
    if (!absolutePath) continue;
    const localId = coerceStringOrNull(r.localId) ?? `local:${absolutePath}`;
    if (out.length >= LOCAL_CANDIDATE_INPUT_CAP) break;
    out.push({
      localId,
      absolutePath,
      artist: coerceStringOrNull(r.artist),
      title: coerceStringOrNull(r.title),
      album: coerceStringOrNull(r.album),
      genre: coerceStringOrNull(r.genre),
      year: coerceStringOrNull(r.year),
      comment: coerceStringOrNull(r.comment),
      durationSec: coerceFiniteNumberOrNull(r.durationSec),
      bpm: coerceFiniteNumberOrNull(r.bpm),
      rating: coerceFiniteNumberOrNull(r.rating),
      score: coerceFiniteNumberOrNull(r.score) ?? 0,
      matchDebug: parseMatchDebug(r.matchDebug),
    });
  }
  return out;
}

/** Re-rank renderer candidates with the same Hebrew-aware haystack as Desktop snapshot search. */
function rescoreLocalCandidatesFromPrompt(
  prompt: string,
  candidates: AiPlaylistLocalCandidate[],
): AiPlaylistLocalCandidate[] {
  const intents = parseLocalSearchIntents(prompt);
  if (intents.groups.length === 0) return candidates;
  const rescored = candidates.map((c) => {
    const row = {
      artist: c.artist,
      title: c.title,
      album: c.album,
      genre: c.genre,
      year: c.year,
      comment: c.comment,
      bpm: c.bpm,
      rating: c.rating,
      relativePathFromRoot: c.absolutePath,
      absolutePath: c.absolutePath,
    };
    const scored = scoreLocalTrackForAiSearch(row, intents);
    return {
      ...c,
      score: Math.max(c.score, scored.score),
      matchDebug: toLocalAiSearchMatchDebug(scored),
    };
  });
  return rankLocalAiSearchResults(rescored, intents).results;
}

/**
 * Desktop hybrid: when the catalog pool is thin, local MP3 bank can dominate (up to 100%).
 * When the catalog is rich, local still gets a majority-capable slice (not hard-capped at 40%).
 */
function resolveLocalCatalogSlotSplit(
  targetMax: number,
  localPoolLength: number,
  catalogMergedLength: number,
): { localSlots: number; catalogSlots: number } {
  if (localPoolLength <= 0) {
    return { localSlots: 0, catalogSlots: targetMax };
  }
  if (catalogMergedLength < 3) {
    return { localSlots: Math.min(localPoolLength, targetMax), catalogSlots: 0 };
  }
  const catalogWeak = catalogMergedLength < Math.max(8, Math.floor(targetMax * 0.35));
  if (catalogWeak) {
    const localSlots = Math.min(localPoolLength, targetMax);
    return { localSlots, catalogSlots: Math.max(0, targetMax - localSlots) };
  }
  const localSlots = Math.min(localPoolLength, Math.ceil(targetMax * 0.65));
  return { localSlots, catalogSlots: Math.max(0, targetMax - localSlots) };
}

function localCandidateDisplayTitle(c: AiPlaylistLocalCandidate): string {
  const ar = (c.artist ?? "").trim();
  const tr = (c.title ?? "").trim();
  if (ar && tr) return `${ar} — ${tr}`;
  if (tr) return tr;
  if (ar) return ar;
  const tail = c.absolutePath.replace(/^.*[\\/]/, "").replace(/\.[a-z0-9]+$/i, "");
  return tail || "Local track";
}

function normUrl(u: string): string {
  return u.trim().toLowerCase().replace(/^https:\/\//, "http://");
}

async function hydrateCatalogSnapshotForPlaylistDna(ids: string[]) {
  if (ids.length === 0) return [];
  const rows = await prisma.catalogItem.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      url: true,
      artist: true,
      provider: true,
      durationSec: true,
      manualEnergyRating: true,
      taxonomyLinks: { select: { taxonomyTag: { select: { slug: true } } } },
      catalogSourceSnapshots: {
        orderBy: { fetchedAt: "desc" },
        take: 1,
        select: { publishedAt: true },
      },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    url: r.url,
    artist: r.artist,
    provider: r.provider,
    durationSec: r.durationSec,
    manualEnergyRating: r.manualEnergyRating,
    taxonomySlugs: r.taxonomyLinks.map((l) => l.taxonomyTag.slug),
    publishedYear: r.catalogSourceSnapshots[0]?.publishedAt?.getFullYear() ?? null,
  }));
}

function pickDjMatrixFromDna(dna: PlaylistDNA | null): DjCreatorMatrixKey | null {
  if (!dna) return null;
  if (dna.avgManualEnergy != null && dna.avgManualEnergy <= 4.5) return "hospitality_calm";
  if (dna.energyLevelLabel === "low") return "hospitality_calm";
  if (dna.energyLevelLabel === "high") return "gym_high_default";
  return null;
}

function buildSearchQueries(args: {
  mode: AiPlaylistBuildMode;
  prompt: string;
  refinementPrompt: string;
  dna: PlaylistDNA | null;
}): string[] {
  const qMain: string[] = [];
  const p = args.prompt.trim();
  const rp = args.refinementPrompt.trim();
  if (p) qMain.push(p);
  if (args.mode === "refine" && rp) qMain.push(rp);
  if (args.mode === "expand" && rp) qMain.push(rp);
  if (args.dna && (args.mode === "similar" || args.mode === "refine" || args.mode === "expand")) {
    if (args.dna.keywordLine) qMain.push(args.dna.keywordLine);
  }
  if (args.mode === "expand") qMain.push("popular hits upbeat variety curated");
  const primary = qMain.join(" ").replace(/\s+/g, " ").trim();

  const out: string[] = [];
  if (primary.length > 0) out.push(primary);
  if (
    args.dna?.keywordLine &&
    !primary.includes(args.dna.keywordLine) &&
    (args.mode === "similar" || args.mode === "refine" || args.mode === "expand")
  ) {
    out.push(args.dna.keywordLine);
  }
  if (!out.some((x) => x.length > 0)) {
    out.push("popular curated mix lounge");
  }
  return out;
}

function mergeRankedDedup(rowsLists: SmartCatalogSearchResultRow[][]): SmartCatalogSearchResultRow[] {
  const best = new Map<string, SmartCatalogSearchResultRow>();
  for (const list of rowsLists) {
    for (const r of list) {
      const prev = best.get(r.catalogItemId);
      if (!prev || r.displayScore > prev.displayScore) best.set(r.catalogItemId, { ...r });
    }
  }
  return [...best.values()].sort((a, b) => b.displayScore - a.displayScore);
}

function selectTracks(
  ranked: SmartCatalogSearchResultRow[],
  target: number,
  dna: PlaylistDNA | null,
  _mode: AiPlaylistBuildMode,
  seedArtistUse?: Map<string, number>,
): { tracks: SmartCatalogSearchResultRow[]; shortfall: string | null } {
  const excludeCatalogIds = new Set(dna?.catalogIdsToExclude ?? []);
  const excludeUrls = new Set(dna?.urlsToExcludeNormalized ?? []);
  const artistUse = seedArtistUse ?? new Map<string, number>();
  const picked: SmartCatalogSearchResultRow[] = [];

  for (const row of ranked) {
    if (picked.length >= target) break;
    if (excludeCatalogIds.has(row.catalogItemId)) continue;
    const nu = normUrl(row.url);
    if (excludeUrls.has(nu)) continue;

    const artistKey = (row.artist ?? "").trim().toLowerCase();
    if (artistKey) {
      const u = artistUse.get(artistKey) ?? 0;
      if (u >= ARTIST_CAP) continue;
      artistUse.set(artistKey, u + 1);
    }

    picked.push(row);
  }

  let shortfall: string | null = null;
  if (picked.length < target) {
    shortfall = `Only ${picked.length} distinct catalog matches passed confidence, dedupe, and artist-cap rules — created a shorter playlist.`;
  }
  return { tracks: picked, shortfall };
}

/**
 * Pick local candidates respecting a shared artist-use map (so local + catalog combined
 * still honor ARTIST_CAP). Dedupes by `localId`. Returns at most `target` rows.
 */
function selectLocalCandidates(
  candidates: AiPlaylistLocalCandidate[],
  target: number,
  artistUse: Map<string, number>,
): AiPlaylistLocalCandidate[] {
  if (target <= 0 || candidates.length === 0) return [];
  const seenLocalIds = new Set<string>();
  const seenAbsPaths = new Set<string>();
  const ranked = [...candidates].sort((a, b) => b.score - a.score);
  const picked: AiPlaylistLocalCandidate[] = [];
  for (const c of ranked) {
    if (picked.length >= target) break;
    if (seenLocalIds.has(c.localId)) continue;
    if (seenAbsPaths.has(c.absolutePath)) continue;
    const artistKey = (c.artist ?? "").trim().toLowerCase();
    if (artistKey) {
      const u = artistUse.get(artistKey) ?? 0;
      if (u >= ARTIST_CAP) continue;
      artistUse.set(artistKey, u + 1);
    }
    seenLocalIds.add(c.localId);
    seenAbsPaths.add(c.absolutePath);
    picked.push(c);
  }
  return picked;
}

function resolveIntentAwareLocalCatalogSlotSplit(
  targetMax: number,
  localPool: AiPlaylistLocalCandidate[],
  catalogPoolSize: number,
  multiIntent: boolean,
): { localSlots: number; catalogSlots: number } {
  const base = resolveLocalCatalogSlotSplit(targetMax, localPool.length, catalogPoolSize);
  if (!multiIntent || localPool.length === 0) return base;
  const localAny = localPool.filter((c) => (c.matchDebug?.groupsMatched ?? 0) > 0).length;
  if (localAny <= 0) return base;
  const localFull = localPool.filter((c) => c.matchDebug?.fullMatch).length;
  const localSlots = Math.min(
    localPool.length,
    localFull > 0 ? Math.ceil(targetMax * 0.85) : Math.ceil(targetMax * 0.65),
  );
  return { localSlots, catalogSlots: Math.max(0, targetMax - localSlots) };
}

/**
 * Catalog selection with a relevance floor.
 *
 * Two cooperating floors prevent direct-genre prompts from leaking unrelated tracks:
 *
 *   1. `enforceIntentFloor` — true when the prompt produced at least one substantive
 *      DJ intent group (see {@link hasAnySubstantiveIntent}). Filters via
 *      `splitCatalogPoolByIntentMatch` (full → partial; never noMatch).
 *
 *   2. `parserSlugFloor` — non-empty when the smart-catalog parser produced style
 *      slugs (PHRASE_MAP genres like "jazz", "lounge", "afro"). Filters via
 *      `splitCatalogPoolByParserSlugOverlap` (parserMatch only). Always applied
 *      when present, even alongside the intent floor (intersection semantics).
 *
 * When neither floor is active (similar / refine / expand modes with no prompt),
 * we delegate to the original `selectTracks` displayScore path.
 *
 * `intentLabel` is the friendly label of the dominant intent (e.g. "Jazz") used
 * to render a localized short-accurate shortfall message in the renderer.
 */
export function selectIntentCatalogTracks(
  ranked: CatalogRowWithIntentMatch[],
  target: number,
  dna: PlaylistDNA | null,
  artistUse: Map<string, number>,
  enforceIntentFloor: boolean,
  parserSlugFloor: string[] = [],
  intentLabel: string | null = null,
  /**
   * Pilot Blocker (combined-intent strictness). When true, only catalog rows
   * with `intentMatch.fullMatch === true` are admitted — the partial-match
   * fallback is disabled, producing a SHORTER ACCURATE playlist rather than
   * padding with rows that satisfy only a subset of the parsed intent groups.
   *
   * Typically true when `parseLocalSearchIntents(prompt)` returned ≥2
   * substantive groups (e.g. "1980 רגוע מובחרים" → decade_1980 + mood_calm +
   * selected). Without this, a row tagged only `selected` would slot into a
   * "1980 רגוע מובחרים" build via the partial-match fallback even when its
   * actual style is, say, Jazz.
   */
  strictMultiIntent: boolean = false,
): {
  tracks: CatalogRowWithIntentMatch[];
  shortfall: string | null;
  partialFallback: boolean;
  /** Structured shortfall hint for the renderer to localize. Present when the floor was active and we returned fewer than `target` tracks. */
  shortfallHint: { kind: "short_accurate"; matchedCount: number; intentLabel: string } | null;
} {
  if (target <= 0) {
    return { tracks: [], shortfall: null, partialFallback: false, shortfallHint: null };
  }

  const hasParserFloor = parserSlugFloor.length > 0;

  if (!enforceIntentFloor && !hasParserFloor) {
    const { tracks, shortfall } = selectTracks(ranked, target, dna, "prompt", artistUse);
    return {
      tracks: tracks as CatalogRowWithIntentMatch[],
      shortfall,
      partialFallback: false,
      shortfallHint: null,
    };
  }

  // Apply the parser-slug floor first (cheap intersection); the intent floor then
  // splits the remaining pool into full/partial buckets. When only the parser
  // floor is active, we still keep the single-pool ranking from `selectTracks`.
  const parserGated = hasParserFloor
    ? ranked.filter((r) => catalogRowMatchesParserSlugs(r, parserSlugFloor))
    : ranked;

  const picked: CatalogRowWithIntentMatch[] = [];
  let partialFallback = false;

  const appendFromPool = (pool: CatalogRowWithIntentMatch[]) => {
    if (picked.length >= target || pool.length === 0) return;
    const { tracks } = selectTracks(pool, target - picked.length, dna, "prompt", artistUse);
    for (const row of tracks as CatalogRowWithIntentMatch[]) {
      if (picked.length >= target) break;
      if (picked.some((p) => p.catalogItemId === row.catalogItemId)) continue;
      picked.push(row);
    }
  };

  if (enforceIntentFloor) {
    const { fullMatch, partialMatch } = splitCatalogPoolByIntentMatch(parserGated);
    appendFromPool(fullMatch);
    if (!strictMultiIntent && picked.length < target && partialMatch.length > 0) {
      if (fullMatch.length === 0 || picked.length < target) partialFallback = true;
      appendFromPool(partialMatch);
    }
  } else {
    // Parser-slug floor only: single pool, ranked by displayScore.
    appendFromPool(parserGated);
  }

  let shortfall: string | null = null;
  if (picked.length < target) {
    shortfall = `Only ${picked.length} relevant catalog matches — created a shorter, accurate playlist instead of padding with unrelated tracks.`;
  }
  if (partialFallback && picked.length > 0) {
    const note = "Not enough full matches; filled with partial matches.";
    shortfall = shortfall ? `${shortfall} ${note}` : note;
  }

  const shortfallHint =
    picked.length < target
      ? {
          kind: "short_accurate" as const,
          matchedCount: picked.length,
          intentLabel: intentLabel ?? (parserSlugFloor[0] ?? "").trim() ?? "",
        }
      : null;

  return { tracks: picked, shortfall, partialFallback, shortfallHint };
}

function buildAiPlaylistBuildDiagnostics(args: {
  intents: LocalSearchIntentParse;
  taxonomySlugsFromParser: string[];
  localCandidatesRaw: AiPlaylistLocalCandidate[];
  localCandidates: AiPlaylistLocalCandidate[];
  catalogRanked: CatalogRowWithIntentMatch[];
  pickedLocal: AiPlaylistLocalCandidate[];
  pickedCatalog: CatalogRowWithIntentMatch[];
  partialFallbackUsed: boolean;
}): AiPlaylistBuildDiagnostics {
  const { fullMatch, partialMatch, noMatch } = splitCatalogPoolByIntentMatch(args.catalogRanked);
  const topLocal = args.localCandidates.slice(0, 6).map((c) => ({
    source: "local" as const,
    title: localCandidateDisplayTitle(c),
    score: c.score,
    fullMatch: c.matchDebug?.fullMatch ?? false,
    groupsMatched: c.matchDebug?.groupsMatched ?? 0,
    groupsTotal: c.matchDebug?.groupsTotal ?? 0,
    reason: c.matchDebug?.reason ?? "",
  }));
  const topCatalog = args.catalogRanked.slice(0, 6).map((r) => ({
    source: "catalog" as const,
    title: r.title,
    score: r.intentMatch.intentScore,
    fullMatch: r.intentMatch.fullMatch,
    groupsMatched: r.intentMatch.groupsMatched,
    groupsTotal: r.intentMatch.groupsTotal,
    reason: r.intentMatch.reason,
  }));
  const topCandidates = [...topLocal, ...topCatalog]
    .sort((a, b) => {
      if (Number(b.fullMatch) !== Number(a.fullMatch)) return Number(b.fullMatch) - Number(a.fullMatch);
      if (b.groupsMatched !== a.groupsMatched) return b.groupsMatched - a.groupsMatched;
      return b.score - a.score;
    })
    .slice(0, 10);

  return {
    parsedIntentGroups: args.intents.groups.map((g) => ({ id: g.id, label: g.label })),
    taxonomySlugsFromParser: args.taxonomySlugsFromParser,
    localCandidatesReceived: args.localCandidatesRaw.length,
    localCandidatesSent: args.localCandidatesRaw.length > 0,
    catalogCandidatesPooled: args.catalogRanked.length,
    catalogWithIntentMatch: fullMatch.length + partialMatch.length,
    catalogFullMatch: fullMatch.length,
    catalogPartialMatch: partialMatch.length,
    catalogNoIntentMatch: noMatch.length,
    selectedBySource: {
      local: args.pickedLocal.length,
      catalog: args.pickedCatalog.length,
    },
    partialFallbackUsed: args.partialFallbackUsed,
    localZeroCandidatesNote:
      args.localCandidatesRaw.length === 0
        ? "PlaylistPro Local Catalog returned 0 candidates for this prompt."
        : null,
    topCandidates,
  };
}

function mergeSelectedTracksByIntentRelevance(
  pickedLocal: AiPlaylistLocalCandidate[],
  pickedCatalog: CatalogRowWithIntentMatch[],
  multiIntent: boolean,
): Array<
  | { kind: "local"; candidate: AiPlaylistLocalCandidate }
  | { kind: "catalog"; row: CatalogRowWithIntentMatch }
> {
  if (!multiIntent) {
    return [
      ...pickedCatalog.map((row) => ({ kind: "catalog" as const, row })),
      ...pickedLocal.map((candidate) => ({ kind: "local" as const, candidate })),
    ];
  }
  type Scored =
    | { kind: "local"; candidate: AiPlaylistLocalCandidate; full: number; gm: number; score: number }
    | { kind: "catalog"; row: CatalogRowWithIntentMatch; full: number; gm: number; score: number };
  const merged: Scored[] = [
    ...pickedLocal.map((candidate) => ({
      kind: "local" as const,
      candidate,
      full: candidate.matchDebug?.fullMatch ? 1 : 0,
      gm: candidate.matchDebug?.groupsMatched ?? 0,
      score: candidate.score,
    })),
    ...pickedCatalog.map((row) => ({
      kind: "catalog" as const,
      row,
      full: row.intentMatch.fullMatch ? 1 : 0,
      gm: row.intentMatch.groupsMatched,
      score: row.intentMatch.intentScore,
    })),
  ];
  merged.sort((a, b) => {
    if (b.full !== a.full) return b.full - a.full;
    if (b.gm !== a.gm) return b.gm - a.gm;
    return b.score - a.score;
  });
  return merged.map((m) =>
    m.kind === "local"
      ? { kind: "local" as const, candidate: m.candidate }
      : { kind: "catalog" as const, row: m.row },
  );
}

async function workspaceIdFromCookies(): Promise<string | null> {
  const cookieStore = await cookies();
  const ws = cookieStore.get(ACTIVE_WORKSPACE_COOKIE_NAME)?.value?.trim() ?? "";
  return ws.length ? ws : null;
}

/** Evenly distribute `total` tracks across `laneCount` lanes (remainder to first lanes). */
export { allocateLaneQuotas, interleaveLanePicks } from "@/lib/ai-playlist-recipe-build-utils";

type LanePick =
  | { kind: "catalog"; row: SmartCatalogSearchResultRow }
  | { kind: "local"; candidate: AiPlaylistLocalCandidate };

function lanePickArtistKey(p: LanePick): string {
  const raw = p.kind === "catalog" ? p.row.artist : p.candidate.artist;
  return (raw ?? "").trim().toLowerCase();
}

function lanePickCatalogId(p: LanePick): string | null {
  return p.kind === "catalog" ? p.row.catalogItemId : null;
}

function lanePickLocalId(p: LanePick): string | null {
  return p.kind === "local" ? p.candidate.localId : null;
}

function backfillLanePicksFromOverflow(
  current: LanePick[],
  overflow: LanePick[],
  targetMax: number,
  artistUse: Map<string, number>,
  seenCatalogIds: Set<string>,
  seenLocalIds: Set<string>,
): LanePick[] {
  if (current.length >= targetMax || overflow.length === 0) return current;
  const out = [...current];
  const ranked = [...overflow].sort((a, b) => lanePickScore(b) - lanePickScore(a));
  for (const pick of ranked) {
    if (out.length >= targetMax) break;
    const catalogId = lanePickCatalogId(pick);
    if (catalogId && seenCatalogIds.has(catalogId)) continue;
    const localId = lanePickLocalId(pick);
    if (localId && seenLocalIds.has(localId)) continue;
    const artistKey = lanePickArtistKey(pick);
    if (artistKey) {
      const u = artistUse.get(artistKey) ?? 0;
      if (u >= ARTIST_CAP) continue;
      artistUse.set(artistKey, u + 1);
    }
    if (catalogId) seenCatalogIds.add(catalogId);
    if (localId) seenLocalIds.add(localId);
    out.push(pick);
  }
  return out;
}

export type AiPlaylistLaneBuildDebug = {
  laneId: string;
  rawPhrase: string;
  label: string;
  quota: number;
  picked: number;
  catalogPicked: number;
  localPicked: number;
  catalogPooled: number;
  localPooled: number;
  shortfall: number;
};

export type AiPlaylistBuildDiagnostics = {
  parsedIntentGroups: Array<{ id: string; label: string }>;
  taxonomySlugsFromParser: string[];
  localCandidatesReceived: number;
  localCandidatesSent: boolean;
  catalogCandidatesPooled: number;
  catalogWithIntentMatch: number;
  catalogFullMatch: number;
  catalogPartialMatch: number;
  catalogNoIntentMatch: number;
  selectedBySource: { local: number; catalog: number };
  partialFallbackUsed: boolean;
  localZeroCandidatesNote: string | null;
  topCandidates: Array<{
    source: "local" | "catalog";
    title: string;
    score: number;
    fullMatch: boolean;
    groupsMatched: number;
    groupsTotal: number;
    reason: string;
  }>;
};

/**
 * Structured shortfall hint forwarded to the renderer so it can render a localized
 * "short accurate" message in Hebrew or English instead of the server's English
 * fallback. `kind = "short_accurate"` means the strict relevance floor returned
 * fewer than the requested track count rather than padding with unrelated rows.
 */
export type AiPlaylistShortfallHint = {
  kind: "short_accurate";
  matchedCount: number;
  intentLabel: string;
};

export type AiPlaylistBuildOk = {
  ok: true;
  playlistId: string;
  name: string;
  trackCount: number;
  requestedCount: number;
  mode: AiPlaylistBuildMode;
  shortfallExplanation: string | null;
  /** Structured hint for the renderer to localize. Null when not applicable. */
  shortfallHint: AiPlaylistShortfallHint | null;
  /** Dev/diagnostics: catalog pool size before selection. */
  catalogCandidatesPooled: number;
  /** How many local rows the renderer attached (post-parse cap). */
  localCandidatesReceived: number;
  localTracksInPlaylist: number;
  catalogTracksInPlaylist: number;
  /** Present when prompt parsed as multi-lane recipe. */
  recipeMode?: "single" | "multi";
  /** Per-lane allocation/selection diagnostics (dev-friendly). */
  laneBuildDebug?: AiPlaylistLaneBuildDebug[];
  /** Dev build diagnostics for prompt intent matching. */
  buildDiagnostics?: AiPlaylistBuildDiagnostics;
  /**
   * Per-track display metadata (genre/mood/subGenres) keyed by `PlaylistTrack.id`.
   *
   * The renderer caches this by `playlistId` and uses it to render genre/source
   * chips on track rows + Now Playing. Persisted `PlaylistItem` rows have no
   * JSON column for taxonomy yet, so this map is the session-scoped bridge.
   * Absent entries fall back to the parent playlist's taxonomy at display time.
   */
  tracksMeta?: AiPlaylistTrackMetaMap;
};

export type AiPlaylistTrackMetaEntry = {
  genre?: string | null;
  mood?: string | null;
  subGenres?: string[] | null;
  metadataSource?:
    | "local_id3"
    | "local_xlsx"
    | "catalog"
    | "playlist"
    | "fallback"
    | null;
};
export type AiPlaylistTrackMetaMap = Record<string, AiPlaylistTrackMetaEntry>;

function lanePicksToPlaylistTracks(picks: LanePick[]): {
  catalogRawTracks: Array<{
    id: string;
    name: string;
    type: ReturnType<typeof inferPlaylistType>;
    url: string;
    cover?: string;
    catalogItemId: string;
  }>;
  localRawTracks: PlaylistTrack[];
} {
  const catalogRawTracks = picks
    .filter((p): p is Extract<LanePick, { kind: "catalog" }> => p.kind === "catalog")
    .map((p) => ({
      id: p.row.catalogItemId,
      name: p.row.title,
      type: inferPlaylistType(p.row.url),
      url: p.row.url,
      cover: p.row.thumbnail ?? undefined,
      catalogItemId: p.row.catalogItemId,
    }));
  const localRawTracks: PlaylistTrack[] = picks
    .filter((p): p is Extract<LanePick, { kind: "local" }> => p.kind === "local")
    .map((c) => ({
      id: c.candidate.localId,
      name: localCandidateDisplayTitle(c.candidate),
      type: "local" as const,
      url: c.candidate.absolutePath,
      ...(typeof c.candidate.durationSec === "number" && c.candidate.durationSec >= 0
        ? { durationSeconds: c.candidate.durationSec }
        : {}),
    }));
  return { catalogRawTracks, localRawTracks };
}

/** Preserve interleaved lane order when linking catalog rows. */
async function orderedLanePicksToPlaylistTracks(
  tenantId: string,
  picks: LanePick[],
): Promise<PlaylistTrack[]> {
  const { catalogRawTracks } = lanePicksToPlaylistTracks(picks);
  const linkedCatalog = await ensurePlaylistTracksLinkedToCatalog(tenantId, catalogRawTracks);
  const catalogById = new Map<string, PlaylistTrack>();
  for (const t of linkedCatalog as PlaylistTrack[]) {
    const key = (t.catalogItemId ?? t.id ?? "").trim();
    if (key) catalogById.set(key, t);
  }

  const out: PlaylistTrack[] = [];
  for (const pick of picks) {
    if (pick.kind === "catalog") {
      const linked = catalogById.get(pick.row.catalogItemId);
      if (linked) out.push(linked);
      continue;
    }
    out.push({
      id: pick.candidate.localId,
      name: localCandidateDisplayTitle(pick.candidate),
      type: "local" as const,
      url: pick.candidate.absolutePath,
      ...(typeof pick.candidate.durationSec === "number" && pick.candidate.durationSec >= 0
        ? { durationSeconds: pick.candidate.durationSec }
        : {}),
    });
  }
  return out;
}

async function executeMultiLanePromptBuild(args: {
  tenantId: string;
  mode: AiPlaylistBuildMode;
  promptText: string;
  recipe: DjPlaylistRecipe;
  targetMax: number;
  branchId: string;
  localCandidatesRaw: AiPlaylistLocalCandidate[];
  seedPlaylist: Playlist | null;
}): Promise<AiPlaylistBuildOk> {
  const { recipe, targetMax, promptText, localCandidatesRaw } = args;
  const laneCount = recipe.lanes.length;
  const quotas = allocateLaneQuotas(targetMax, laneCount);
  const workspaceId = await workspaceIdFromCookies();
  const djContext = resolveDjSmartSearchDjContext(null);
  const perLanePoolLimit = Math.min(
    140,
    Math.max(Math.ceil((targetMax * 3) / laneCount), Math.max(...quotas, 1) * 2),
  );

  const sharedArtistUse = new Map<string, number>();
  const seenCatalogIds = new Set<string>();
  const seenLocalIds = new Set<string>();
  const lanePicks: LanePick[][] = [];
  const laneBuildDebug: AiPlaylistLaneBuildDebug[] = [];
  const overflow: LanePick[] = [];
  let totalCatalogPooled = 0;

  for (let i = 0; i < laneCount; i++) {
    const lane = recipe.lanes[i]!;
    const quota = quotas[i] ?? 0;
    if (quota <= 0) {
      lanePicks.push([]);
      laneBuildDebug.push({
        laneId: lane.id,
        rawPhrase: lane.rawPhrase,
        label: lane.label,
        quota: 0,
        picked: 0,
        catalogPicked: 0,
        localPicked: 0,
        catalogPooled: 0,
        localPooled: 0,
        shortfall: 0,
      });
      continue;
    }

    const searchRes = await runSmartCatalogSearch({
      query: lane.rawPhrase,
      workspaceId,
      daypartOverride: null,
      limit: perLanePoolLimit,
      maxResultLimit: 170,
      djContext,
    });
    const catalogPoolAll = searchRes.rows;
    totalCatalogPooled += catalogPoolAll.length;

    const localRescored =
      localCandidatesRaw.length > 0
        ? rescoreLocalCandidatesFromPrompt(lane.rawPhrase, localCandidatesRaw)
        : [];
    /**
     * Pilot Blocker (Local Jazz strictness) — per-lane parser-slug floor on local.
     * Same gate as single-lane: a lane phrase like "jazz" rejects folder-name-only
     * matches; a vibe lane phrase with no style slug (e.g. "elegant dinner") leaves
     * the local pool untouched. Empty parser slugs → no filter.
     */
    const lanePreParsed = parseSmartCatalogQuery(lane.rawPhrase);
    const laneStrictSlugs = [...lanePreParsed.styleTaxonomySlugs];
    const laneFloor = applyLocalStrictFloor(localRescored, laneStrictSlugs);
    const localPoolAll = [...laneFloor.passing].sort((a, b) => b.score - a.score);

    const catalogPool = catalogPoolAll.filter((r) => !seenCatalogIds.has(r.catalogItemId));
    const localPool = localPoolAll.filter((c) => !seenLocalIds.has(c.localId));

    const { localSlots, catalogSlots } = resolveLocalCatalogSlotSplit(
      quota,
      localPool.length,
      catalogPool.length,
    );

    const pickedLocal = selectLocalCandidates(localPool, localSlots, sharedArtistUse);
    for (const c of pickedLocal) seenLocalIds.add(c.localId);

    const catalogPoolForSelect =
      pickedLocal.length > 0 && catalogSlots > 0
        ? catalogPool.filter((r) => inferPlaylistType(r.url) === "youtube")
        : catalogPool;

    const { tracks: pickedCatalog } = selectTracks(
      catalogPoolForSelect,
      catalogSlots,
      null,
      "prompt",
      sharedArtistUse,
    );
    for (const r of pickedCatalog) seenCatalogIds.add(r.catalogItemId);

    const lanePickList: LanePick[] = [
      ...pickedCatalog.map((row) => ({ kind: "catalog" as const, row })),
      ...pickedLocal.map((candidate) => ({ kind: "local" as const, candidate })),
    ];
    lanePicks.push(lanePickList);

    const pickedCatalogIds = new Set(pickedCatalog.map((r) => r.catalogItemId));
    const pickedLocalIds = new Set(pickedLocal.map((c) => c.localId));
    for (const r of catalogPool) {
      if (!pickedCatalogIds.has(r.catalogItemId)) {
        overflow.push({ kind: "catalog", row: r });
      }
    }
    for (const c of localPool) {
      if (!pickedLocalIds.has(c.localId)) {
        overflow.push({ kind: "local", candidate: c });
      }
    }

    const shortfall = Math.max(0, quota - lanePickList.length);
    laneBuildDebug.push({
      laneId: lane.id,
      rawPhrase: lane.rawPhrase,
      label: lane.label,
      quota,
      picked: lanePickList.length,
      catalogPicked: pickedCatalog.length,
      localPicked: pickedLocal.length,
      catalogPooled: catalogPool.length,
      localPooled: localPool.length,
      shortfall,
    });

    if (shortfall > 0 && process.env.NODE_ENV === "development") {
      console.info("[ai-playlist-build] lane shortfall", {
        laneId: lane.id,
        rawPhrase: lane.rawPhrase,
        quota,
        picked: lanePickList.length,
        shortfall,
      });
    }
  }

  let ordered = interleaveLanePicks(lanePicks, targetMax);
  if (ordered.length < targetMax) {
    ordered = backfillLanePicksFromOverflow(
      ordered,
      overflow,
      targetMax,
      sharedArtistUse,
      seenCatalogIds,
      seenLocalIds,
    );
  }

  const linked = await orderedLanePicksToPlaylistTracks(args.tenantId, ordered);

  const firstUrl = linked[0]?.url?.trim() ?? "";
  if (!firstUrl) {
    throw new AiPlaylistNoStrongMatchesError(
      `No strong matches for "${promptText || "your prompt"}".`,
      { intentLabel: promptText.slice(0, 80) || "your prompt", matchedCount: 0 },
    );
  }

  const localTracksInPlaylist = linked.filter((t) => t.type === "local").length;
  const catalogTracksInPlaylist = linked.length - localTracksInPlaylist;

  const laneShortfalls = laneBuildDebug.filter((l) => l.shortfall > 0);
  let shortfallExplanation: string | null = null;
  if (linked.length < targetMax || laneShortfalls.length > 0) {
    const parts: string[] = [];
    if (linked.length < targetMax) {
      parts.push(
        `Built ${linked.length} of ${targetMax} requested tracks across ${laneCount} recipe lane(s).`,
      );
    }
    for (const ls of laneShortfalls) {
      parts.push(`Lane "${ls.rawPhrase}" filled ${ls.picked}/${ls.quota}.`);
    }
    if (localTracksInPlaylist > 0) {
      parts.push(
        `Included ${localTracksInPlaylist} local + ${catalogTracksInPlaylist} catalog track(s).`,
      );
    }
    shortfallExplanation = parts.join(" ");
  }

  const name = promptText.length > 0 ? promptText.slice(0, 120) : "AI playlist";
  const playlistThumbnail = pickAiPlaylistThumbnail(linked, name);
  const created = await createPlaylist({
    name,
    genre: AI_PLAYLIST_GENRE,
    type: linked[0]!.type,
    url: firstUrl,
    thumbnail: playlistThumbnail,
    branchId: args.branchId,
    tenantId: args.tenantId,
    tracks: linked,
  });

  if (process.env.NODE_ENV === "development") {
    console.info("[ai-playlist-build] multi-lane recipe", {
      lanes: laneCount,
      quotas,
      interleaved: ordered.length,
      laneBuildDebug,
    });
  }

  return {
    ok: true,
    playlistId: created.id,
    name: created.name,
    trackCount: linked.length,
    requestedCount: targetMax,
    mode: args.mode,
    shortfallExplanation,
    shortfallHint: null,
    catalogCandidatesPooled: totalCatalogPooled,
    localCandidatesReceived: localCandidatesRaw.length,
    localTracksInPlaylist,
    catalogTracksInPlaylist,
    recipeMode: "multi",
    laneBuildDebug,
  };
}

export async function executeAiPlaylistBuild(args: {
  tenantId: string;
  mode: AiPlaylistBuildMode;
  prompt?: string;
  refinementPrompt?: string;
  seedPlaylist: Playlist | null;
  branchId?: string;
  /** Target size (clamped server-side). */
  count?: number;
  /**
   * Phase 1 hybrid: device-local snapshot candidates pre-filtered by the desktop renderer.
   * Merged into the final track list as type "local"; never written to CatalogItem.
   */
  additionalLocalCandidates?: AiPlaylistLocalCandidate[];
}): Promise<AiPlaylistBuildOk> {
  const targetMax = Math.min(
    AI_PLAYLIST_BUILD_MAX_COUNT,
    Math.max(1, args.count ?? DEFAULT_TARGET),
  );
  const promptText = (args.prompt ?? "").trim();
  const localCandidatesRaw = (args.additionalLocalCandidates ?? []).slice(0, LOCAL_CANDIDATE_INPUT_CAP);
  const branchId = (args.branchId ?? "default").trim() || "default";

  if (MULTI_LANE_AI_BUILD_ENABLED && args.mode === "prompt" && promptText.length > 0) {
    const recipe = parseDjPlaylistRecipe(promptText);
    if (recipe.mode === "multi" && recipe.lanes.length >= 2) {
      return executeMultiLanePromptBuild({
        tenantId: args.tenantId,
        mode: args.mode,
        promptText,
        recipe,
        targetMax,
        branchId,
        localCandidatesRaw,
        seedPlaylist: args.seedPlaylist,
      });
    }
  }

  const localCandidatesRescored =
    promptText.length > 0 && localCandidatesRaw.length > 0
      ? rescoreLocalCandidatesFromPrompt(promptText, localCandidatesRaw)
      : localCandidatesRaw;

  /**
   * Pilot Blocker (Local Jazz strictness) — strict floor for local candidates.
   *
   * For direct genre prompts the smart-catalog parser surfaces style taxonomy slugs
   * (e.g. "jazz" / "rock"). Without this gate, the renderer-side scorer would let
   * folder-name-only matches through (a freshly-scanned file with empty ID3 tags
   * whose parent path happens to contain the substring "jazz"). The floor keeps
   * candidates only when a strong field matched (genre / comment / title / artist
   * / album / year) OR the folder segment matches a trusted PlaylistPro folder
   * label for that slug family (e.g. "JAZZ - Smooth"). Empty parser slugs disable
   * the floor — preserves Mediterranean / Workout / vibe-driven prompts as-is.
   */
  const preParsedPromptForLocalFloor =
    promptText.length > 0 ? parseSmartCatalogQuery(promptText) : null;
  const parserSlugFloorForLocal: string[] = preParsedPromptForLocalFloor
    ? [...preParsedPromptForLocalFloor.styleTaxonomySlugs]
    : [];
  const localFloorOutcome = applyLocalStrictFloor(
    localCandidatesRescored,
    parserSlugFloorForLocal,
  );
  const localCandidates = localFloorOutcome.passing;
  if (
    process.env.NODE_ENV === "development" &&
    parserSlugFloorForLocal.length > 0 &&
    localCandidatesRescored.length > 0
  ) {
    console.info("[ai-playlist-build] local strict floor", {
      promptText,
      parserSlugFloorForLocal,
      trustedLabels: localFloorOutcome.trustedLabels.slice(0, 12),
      before: localCandidatesRescored.length,
      after: localCandidates.length,
      rejectedSample: localFloorOutcome.rejected.slice(0, 5).map((r) => ({
        path: r.candidate.absolutePath?.slice(-80) ?? "",
        reason: r.decision.reason,
      })),
    });
  }

  let dna: PlaylistDNA | null = null;
  if (args.seedPlaylist) {
    const catalogIdsInSeed = [...new Set(
      (args.seedPlaylist.tracks ?? [])
        .map((t) => (t.catalogItemId ?? "").trim())
        .filter(Boolean),
    )];
    const bundle = await hydrateCatalogSnapshotForPlaylistDna(catalogIdsInSeed);
    dna = buildPlaylistDna({ seed: args.seedPlaylist, catalogRows: bundle });
  }

  const promptIntents =
    args.mode === "prompt" && promptText.length > 0 ? parseLocalSearchIntents(promptText) : null;
  const multiIntent = promptIntents ? isSubstantiveMultiIntentQuery(promptIntents) : false;
  const hasSubstantiveIntent = promptIntents ? hasAnySubstantiveIntent(promptIntents) : false;

  /**
   * Pilot Blocker (combined-intent strictness).
   *
   * When the prompt parses into ≥2 substantive groups (e.g.
   * "1980 רגוע מובחרים" → decade_1980 + mood_calm + selected), require an AND
   * across ALL groups. Both catalog and local pools drop rows that satisfy
   * only a subset. Without this, a row tagged only `selected` (a common DJ
   * curation tag found on Jazz/Latin tracks) used to slip through the
   * partial-match fallback into a "1980 calm" build, producing the
   * "22 local + 3 Jazz URL" leakage reported during pilot QA.
   *
   * Single-intent prompts still use full→partial fallback so that vibe-only
   * builds like "workout" don't collapse to zero rows when no track has every
   * tag set.
   */
  const strictMultiIntent = !!promptIntents && multiIntent;

  // Pilot Blocker 2: detect taxonomy hints from the smart-catalog parser BEFORE the
  // search runs, so prompts like "jazz" or "lounge" (which have zero substantive DJ
  // intent groups but DO produce style slugs via PHRASE_MAP / DJ intent dictionary)
  // also get strict tag-overlap enforcement instead of falling back to displayScore.
  const preParsedQuery = promptText.length > 0 ? parseSmartCatalogQuery(promptText) : null;
  const hasParserStyleTaxonomy =
    !!preParsedQuery && preParsedQuery.styleTaxonomySlugs.length > 0;

  /**
   * Strict relevance floor (Pilot Blocker 2).
   *
   *  - true when the prompt expresses any substantive intent (single OR multi)
   *    OR the parser found at least one style taxonomy slug.
   *  - Triggers `requireTagOverlap` on smart catalog search (drops untagged rows).
   *  - Triggers `enforceIntentFloor` in `selectIntentCatalogTracks` (drops noMatch
   *    rows) when the prompt also produced ranked intent groups.
   *
   * This replaces the previous `multiIntent`-only gate, which let single-intent
   * prompts like "jazz" pull in random YouTube high-displayScore tracks.
   */
  const strictRelevance = multiIntent || hasSubstantiveIntent || hasParserStyleTaxonomy;
  const enforceIntentFloor = !!promptIntents && hasSubstantiveIntent;

  const queries = buildSearchQueries({
    mode: args.mode,
    prompt: args.prompt ?? "",
    refinementPrompt: args.refinementPrompt ?? "",
    dna,
  });

  const matrixKey = pickDjMatrixFromDna(dna);
  const djContext = resolveDjSmartSearchDjContext(matrixKey);
  const workspaceId = await workspaceIdFromCookies();
  const poolLimit = Math.min(140, Math.max(targetMax * 3, targetMax));

  const searchRuns: SmartCatalogSearchResultRow[][] = [];
  let taxonomySlugsFromParser: string[] = [];
  for (const q of queries) {
    const res = await runSmartCatalogSearch({
      query: q,
      workspaceId,
      daypartOverride: null,
      limit: poolLimit,
      maxResultLimit: 170,
      djContext,
      requireTagOverlap: strictRelevance,
    });
    if (taxonomySlugsFromParser.length === 0) {
      taxonomySlugsFromParser = [...res.parsed.styleTaxonomySlugs];
    }
    searchRuns.push(res.rows);
  }

  // Resolve sibling exclusions ONCE (used by both catalog and local filters below).
  // Empty bundle when no group declares `excludesGroupsWhenAbsent` for an absent
  // sibling — preserves current behavior for prompts that don't trigger the rule.
  const siblingExclusion: SiblingExclusionBundle = buildSiblingExclusionBundle(promptIntents);

  const mergedRaw = mergeRankedDedup(searchRuns);
  const mergedAfterExclusion =
    siblingExclusion.excludedTaxonomySlugSet.size > 0
      ? mergedRaw.filter((row) => !catalogRowMatchesExcludedSibling(row, siblingExclusion))
      : mergedRaw;

  if (
    process.env.NODE_ENV === "development" &&
    siblingExclusion.excludedGroupIds.length > 0 &&
    mergedRaw.length > 0
  ) {
    console.info("[ai-playlist-build] sibling exclusion (catalog)", {
      promptText,
      excluded: siblingExclusion.excludedGroupIds,
      before: mergedRaw.length,
      after: mergedAfterExclusion.length,
    });
  }

  const catalogRanked =
    enforceIntentFloor && promptIntents
      ? rankCatalogRowsForAiIntents(mergedAfterExclusion, promptIntents)
      : mergedAfterExclusion.map((row) => ({
          ...row,
          intentMatch: {
            groupsMatched: 0,
            groupsTotal: 0,
            fullMatch: false,
            intentScore: row.displayScore,
            reason: strictRelevance
              ? "tag-overlap enforced upstream; no intent-group ranking"
              : "no parsed intent",
            groups: [],
          },
        }));

  // Pilot Blocker (region/genre exclusivity). Reject local rows that belong
  // to a sibling group the user did NOT request (e.g. Mediterranean local
  // rows when the prompt is "ישראלי רגוע להיטים" but contains no Mediterranean
  // intent). Same `siblingExclusion` is also applied to the catalog above.
  const localCandidatesAfterExclusion =
    siblingExclusion.excludedTaxonomySlugSet.size > 0 || siblingExclusion.excludedLocalTerms.length > 0
      ? localCandidates.filter((c) => !localCandidateMatchesExcludedSibling(c, siblingExclusion))
      : localCandidates;

  if (
    process.env.NODE_ENV === "development" &&
    siblingExclusion.excludedGroupIds.length > 0 &&
    localCandidates.length > 0
  ) {
    console.info("[ai-playlist-build] sibling exclusion (local)", {
      promptText,
      excluded: siblingExclusion.excludedGroupIds,
      before: localCandidates.length,
      after: localCandidatesAfterExclusion.length,
    });
  }

  // Pilot Blocker (combined-intent strictness) — local side. When the prompt
  // has ≥2 substantive groups, drop any local candidate whose `matchDebug.fullMatch`
  // is false. Mirrors the catalog side via `strictMultiIntent` below.
  const localPoolFullyGated = strictMultiIntent
    ? localCandidatesAfterExclusion.filter((c) => c.matchDebug?.fullMatch === true)
    : localCandidatesAfterExclusion;
  const localPool = [...localPoolFullyGated].sort((a, b) => b.score - a.score);

  if (
    process.env.NODE_ENV === "development" &&
    strictMultiIntent &&
    localCandidatesAfterExclusion.length > 0
  ) {
    console.info("[ai-playlist-build] strict multi-intent local gate", {
      promptText,
      before: localCandidatesAfterExclusion.length,
      after: localPool.length,
      groupsTotal: promptIntents?.groups.length ?? 0,
    });
  }

  const { localSlots, catalogSlots } = resolveIntentAwareLocalCatalogSlotSplit(
    targetMax,
    localPool,
    catalogRanked.length,
    strictRelevance,
  );
  const sharedArtistUse = new Map<string, number>();
  const pickedLocal = selectLocalCandidates(localPool, localSlots, sharedArtistUse);

  const mergedForCatalog =
    pickedLocal.length > 0 && catalogSlots > 0
      ? catalogRanked.filter((r) => inferPlaylistType(r.url) === "youtube")
      : catalogRanked;

  // Dominant intent label for the user-facing short-accurate shortfall.
  // For multi-intent we join the first 3 substantive group labels with " + "
  // so the renderer can show e.g. "1980s + Calm/Easy + Selected" rather than
  // just the first group, which would understate why padding was refused.
  const dominantIntentLabel = (() => {
    if (promptIntents) {
      const substantive = promptIntents.groups.filter((g) => g.id !== "general");
      if (substantive.length >= 2) {
        return substantive
          .slice(0, 3)
          .map((g) => g.label)
          .filter(Boolean)
          .join(" + ");
      }
      const first = substantive[0];
      if (first?.label) return first.label;
    }
    const firstParserSlug = (preParsedQuery?.styleTaxonomySlugs ?? [])[0] ?? "";
    if (!firstParserSlug) return (promptText || "").trim() || "your prompt";
    return firstParserSlug
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  })();

  const parserSlugFloor = hasParserStyleTaxonomy
    ? [...(preParsedQuery?.styleTaxonomySlugs ?? [])]
    : [];

  const {
    tracks: selected,
    shortfall: catalogShortfall,
    partialFallback: catalogPartialFallback,
    shortfallHint: catalogShortfallHint,
  } = selectIntentCatalogTracks(
    mergedForCatalog as CatalogRowWithIntentMatch[],
    catalogSlots,
    dna,
    sharedArtistUse,
    enforceIntentFloor,
    parserSlugFloor,
    dominantIntentLabel,
    strictMultiIntent,
  );

  const orderedPicks = mergeSelectedTracksByIntentRelevance(
    pickedLocal,
    selected,
    enforceIntentFloor,
  );

  // Per-track display metadata index — populated as we shape picks so the
  // chips (genre / mood / source) the renderer shows match the data the AI
  // actually scored on. We DELIBERATELY keep this in-memory and emit it on
  // the build response (alongside `playlistId`): the persisted PlaylistItem
  // row has no JSON column for taxonomy, so the renderer caches it by
  // `playlistId` for the session. See `lib/playlist-track-display-meta.ts`.
  const derivedMetaByTrackId = new Map<string, DerivedTrackMetadata>();

  const catalogRawTracks = orderedPicks
    .filter((p): p is { kind: "catalog"; row: CatalogRowWithIntentMatch } => p.kind === "catalog")
    .map((p) => {
      const matchedSlugsFromIntent = (p.row.intentMatch?.groups ?? [])
        .filter((g) => g.matched)
        .flatMap((g) => g.matchedSlugs);
      const meta = deriveCatalogTrackMetadata({
        taxonomySlugs: p.row.taxonomySlugs,
        matchedSlugsFromIntent,
      });
      if (Object.keys(meta).length > 0) {
        derivedMetaByTrackId.set(p.row.catalogItemId, meta);
      }
      return {
        id: p.row.catalogItemId,
        name: p.row.title,
        type: inferPlaylistType(p.row.url),
        url: p.row.url,
        cover: p.row.thumbnail ?? undefined,
        catalogItemId: p.row.catalogItemId,
        ...(meta.genre ? { genre: meta.genre } : {}),
        ...(meta.mood ? { mood: meta.mood } : {}),
        ...(meta.subGenres && meta.subGenres.length > 0 ? { subGenres: meta.subGenres } : {}),
        ...(meta.metadataSource ? { metadataSource: meta.metadataSource } : {}),
      } satisfies PlaylistTrack;
    });

  const localRawTracks: PlaylistTrack[] = orderedPicks
    .filter((p): p is { kind: "local"; candidate: AiPlaylistLocalCandidate } => p.kind === "local")
    .map((p) => ({
      id: p.candidate.localId,
      name: localCandidateDisplayTitle(p.candidate),
      type: "local" as const,
      url: p.candidate.absolutePath,
      ...(typeof p.candidate.durationSec === "number" && p.candidate.durationSec >= 0
        ? { durationSeconds: p.candidate.durationSec }
        : {}),
    }));

  const linkedCatalog = await ensurePlaylistTracksLinkedToCatalog(args.tenantId, catalogRawTracks);
  const catalogById = new Map<string, PlaylistTrack>();
  for (const t of linkedCatalog as PlaylistTrack[]) {
    const key = (t.catalogItemId ?? t.id ?? "").trim();
    if (key) catalogById.set(key, t);
  }

  const linked: PlaylistTrack[] = [];
  for (const pick of orderedPicks) {
    if (pick.kind === "catalog") {
      const row = catalogById.get(pick.row.catalogItemId);
      // Defensive: drop any catalog pick whose linked row has no playable URL
      // (would otherwise create a broken playlist item).
      if (row && (row.url ?? "").trim().length > 0) {
        const meta = derivedMetaByTrackId.get(pick.row.catalogItemId);
        linked.push(
          meta
            ? {
                ...row,
                ...(meta.genre ? { genre: meta.genre } : {}),
                ...(meta.mood ? { mood: meta.mood } : {}),
                ...(meta.subGenres && meta.subGenres.length > 0 ? { subGenres: meta.subGenres } : {}),
                ...(meta.metadataSource ? { metadataSource: meta.metadataSource } : {}),
              }
            : row,
        );
      }
      continue;
    }
    // Defensive: drop any local pick whose absolutePath is empty.
    const absPath = (pick.candidate.absolutePath ?? "").trim();
    if (absPath.length === 0) continue;
    // Map ID3 + comment fields into chip metadata. We never expose the local
    // absolutePath in the chip; only the ID3 genre + PlaylistPro comment tag.
    const matchedLocalGroupIds = (pick.candidate.matchDebug?.groups ?? [])
      .filter((g) => g.matched)
      .map((g) => groupLabelToId(g.label))
      .filter((v): v is DjIntentLocalGroupId => v != null);
    const localMeta = deriveLocalTrackMetadata({
      genre: pick.candidate.genre,
      comment: pick.candidate.comment,
      matchedLocalGroupIds,
    });
    if (Object.keys(localMeta).length > 0) {
      derivedMetaByTrackId.set(pick.candidate.localId, localMeta);
    }
    linked.push({
      id: pick.candidate.localId,
      name: localCandidateDisplayTitle(pick.candidate),
      type: "local" as const,
      url: absPath,
      ...(typeof pick.candidate.durationSec === "number" && pick.candidate.durationSec >= 0
        ? { durationSeconds: pick.candidate.durationSec }
        : {}),
      ...(localMeta.genre ? { genre: localMeta.genre } : {}),
      ...(localMeta.mood ? { mood: localMeta.mood } : {}),
      ...(localMeta.subGenres && localMeta.subGenres.length > 0
        ? { subGenres: localMeta.subGenres }
        : {}),
      ...(localMeta.metadataSource ? { metadataSource: localMeta.metadataSource } : {}),
    });
  }

  const buildDiagnostics =
    args.mode === "prompt" && promptIntents
      ? buildAiPlaylistBuildDiagnostics({
          intents: promptIntents,
          taxonomySlugsFromParser,
          localCandidatesRaw,
          localCandidates,
          catalogRanked: catalogRanked as CatalogRowWithIntentMatch[],
          pickedLocal,
          pickedCatalog: selected,
          partialFallbackUsed:
            catalogPartialFallback ||
            (multiIntent &&
              localPool.some((c) => (c.matchDebug?.groupsMatched ?? 0) > 0) &&
              !localPool.some((c) => c.matchDebug?.fullMatch)),
        })
      : undefined;

  if (process.env.NODE_ENV === "development" && buildDiagnostics) {
    console.info("[ai-playlist-build] diagnostics", buildDiagnostics);
  }

  const seedName = args.seedPlaylist?.name?.trim() ?? "";
  let name: string;
  if (args.mode === "prompt") {
    const base = (args.prompt ?? "").trim();
    name = base.length > 0 ? base.slice(0, 120) : "AI playlist";
  } else if (args.mode === "similar") {
    name = seedName ? `${seedName} · AI similar` : "AI similar playlist";
  } else if (args.mode === "refine") {
    name = seedName ? `${seedName} · AI refined` : "AI refined playlist";
  } else {
    name = seedName ? `${seedName} · AI expanded` : "AI expanded playlist";
  }

  const firstUrl = linked[0]?.url?.trim() ?? "";
  if (!firstUrl) {
    // Pilot Blocker — graceful "no strong matches" path. Hitting this means
    // strict relevance + sibling exclusion + URL guards left us with zero
    // playable rows. We DELIBERATELY do not relax the gate to pad the
    // playlist (would re-introduce Mediterranean / foreign leakage). The
    // route turns this into a 422 with a structured payload so the renderer
    // can render a localized "no strong matches" message in Hebrew/English.
    throw new AiPlaylistNoStrongMatchesError(
      `No strong matches for "${(args.prompt ?? "").trim() || "your prompt"}".`,
      { intentLabel: dominantIntentLabel, matchedCount: 0 },
    );
  }

  const typed = linked as PlaylistTrack[];
  const localTracksInPlaylist = typed.filter((t) => t.type === "local").length;
  const catalogTracksInPlaylist = typed.length - localTracksInPlaylist;

  let shortfall = catalogShortfall;
  if (buildDiagnostics?.localZeroCandidatesNote && localCandidatesRaw.length === 0) {
    shortfall = [shortfall, buildDiagnostics.localZeroCandidatesNote].filter(Boolean).join(" ");
  }
  if (typed.length < targetMax) {
    const parts: string[] = [];
    if (catalogShortfall) parts.push(catalogShortfall);
    if (localTracksInPlaylist > 0 && catalogTracksInPlaylist === 0) {
      parts.push(
        `Built a ${localTracksInPlaylist}-track local playlist from your Desktop music library (catalog had few matches).`,
      );
    } else if (localTracksInPlaylist > 0) {
      parts.push(
        `Included ${localTracksInPlaylist} local + ${catalogTracksInPlaylist} catalog track(s).`,
      );
    }
    shortfall = parts.length > 0 ? parts.join(" ") : shortfall;
  }

  const playlistThumbnail = pickAiPlaylistThumbnail(typed, name);

  const created = await createPlaylist({
    name,
    genre: AI_PLAYLIST_GENRE,
    type: typed[0]!.type,
    url: firstUrl,
    thumbnail: playlistThumbnail,
    branchId,
    tenantId: args.tenantId,
    tracks: typed,
  });

  const tracksMeta: AiPlaylistTrackMetaMap = {};
  for (const t of typed) {
    const meta = derivedMetaByTrackId.get(t.id);
    if (!meta) continue;
    tracksMeta[t.id] = {
      ...(meta.genre ? { genre: meta.genre } : {}),
      ...(meta.mood ? { mood: meta.mood } : {}),
      ...(meta.subGenres && meta.subGenres.length > 0 ? { subGenres: meta.subGenres } : {}),
      ...(meta.metadataSource ? { metadataSource: meta.metadataSource } : {}),
    };
  }

  return {
    ok: true,
    playlistId: created.id,
    name: created.name,
    trackCount: typed.length,
    requestedCount: targetMax,
    mode: args.mode,
    shortfallExplanation: shortfall,
    shortfallHint: catalogShortfallHint,
    catalogCandidatesPooled: catalogRanked.length,
    localCandidatesReceived: localCandidatesRaw.length,
    localTracksInPlaylist,
    catalogTracksInPlaylist,
    ...(buildDiagnostics ? { buildDiagnostics } : {}),
    ...(Object.keys(tracksMeta).length > 0 ? { tracksMeta } : {}),
  };
}
