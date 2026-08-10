/**
 * Phase B0.2 — CatalogResolver v2 (identity resolver).
 *
 * Given a track description (from a chart, radio log, import row, or search), find the
 * matching canonical UniversalTrack ALREADY in the database. It answers "which known
 * recording is this?" — NOT "where can I play it?". The playable-source decision is a
 * separate PlaybackProvider/adapter concern.
 *
 * HARD RULE: this resolver NEVER calls yt-dlp / YouTube / any network. YouTube is only
 * ever a ProviderMapping row. If nothing matches, it returns null and the caller decides
 * whether to create a new UniversalTrack (and, separately, resolve a playable provider).
 *
 * The scoring core (scoreCandidate / rankCandidates) is PURE and unit-tested without a DB.
 */

import type { TrackVersionName } from "@/lib/universal/universal-track";
import {
  normalizeArtistName,
  normalizeTitle,
  versionCompatible,
} from "@/lib/universal/normalize";

export interface ResolverQuery {
  isrc?: string;
  provider?: string;
  externalId?: string;
  title: string;
  /** Display names, primary first. */
  artists?: string[];
  durationMs?: number;
  album?: string;
}

/** Minimal projection of a UniversalTrack needed for scoring. */
export interface ResolverCandidate {
  id: string;
  displayTitle: string;
  normalizedTitle: string;
  durationMs?: number | null;
  canonicalIsrc?: string | null;
  versionType?: TrackVersionName | null;
  /** Normalized artist names on the candidate. */
  artistNames: string[];
  providerRefs: Array<{ provider: string; externalId: string }>;
}

export type MatchMethod =
  | "isrc"
  | "provider_external_id"
  | "title_artist"
  | "title_only"
  | "none";

export interface ScoredCandidate {
  candidate: ResolverCandidate;
  score: number;
  reasons: string[];
  warnings: string[];
  versionMismatch: string[];
  durationDeltaMs?: number;
}

export interface ResolveResult {
  /** Non-null ONLY when decision === "auto_match". Ambiguous/unresolved keep it null. */
  match: ResolverCandidate | null;
  confidence: number;
  method: MatchMethod;
  /** Policy outcome: auto_match (safe) | ambiguous (review) | unresolved. */
  decision: ResolutionDecision;
  thresholds: typeof RESOLVER_THRESHOLDS;
  reasons: string[];
  warnings: string[];
  candidates: ScoredCandidate[];
  versionMismatch?: string[];
  durationDeltaMs?: number;
}

function hasHardWarning(sc: ScoredCandidate): boolean {
  return sc.warnings.some((w) => w.startsWith("version block"));
}

/** Provisional decision policy — 0.6 alone never auto-matches. */
export function decideResolution(best: ScoredCandidate | undefined): ResolutionDecision {
  if (!best) return "unresolved";
  if (best.score >= RESOLVER_THRESHOLDS.autoMatch && best.versionMismatch.length === 0 && !hasHardWarning(best)) {
    return "auto_match";
  }
  if (best.score >= RESOLVER_THRESHOLDS.ambiguous) return "ambiguous";
  return "unresolved";
}

/** Cues that, if present on the candidate but not requested, DISQUALIFY the match. */
const HARD_BLOCK_CUES = new Set(["karaoke", "cover", "instrumental", "nightcore", "sped_up", "slowed"]);
/** Cues that heavily penalize but don't outright disqualify. */
const SOFT_PENALTY = 0.35;

/**
 * Provisional downstream policy thresholds (tunable — returned in every result so they
 * can be calibrated later). 0.6 is ONLY a candidate-inclusion floor: it NEVER by itself
 * creates a ProviderMapping or ChartEntry.
 */
export const RESOLVER_THRESHOLDS = {
  /** >= this AND no version issue → auto_match (safe to auto-create mapping/chart entry). */
  autoMatch: 0.9,
  /** [ambiguous, autoMatch) → AMBIGUOUS: keep candidates for review, never auto-create. */
  ambiguous: 0.7,
  /** [candidate, ambiguous) → include as a candidate only. Below → dropped. */
  candidate: 0.6,
} as const;

export type ResolutionDecision = "auto_match" | "ambiguous" | "unresolved";

/** Retained for callers that only need the candidate-inclusion floor. */
export const MATCH_THRESHOLD = RESOLVER_THRESHOLDS.candidate;
const DURATION_TIGHT_MS = 3000;
const DURATION_LOOSE_MS = 8000;
const DURATION_FAR_MS = 120000;

/** PURE — score one candidate against the query. No DB, no network. */
export function scoreCandidate(query: ResolverQuery, candidate: ResolverCandidate): ScoredCandidate {
  const reasons: string[] = [];
  const warnings: string[] = [];

  // Exact ISRC dominates.
  if (query.isrc && candidate.canonicalIsrc && query.isrc.toUpperCase() === candidate.canonicalIsrc.toUpperCase()) {
    return { candidate, score: 1, reasons: ["exact ISRC match"], warnings, versionMismatch: [] };
  }
  // Exact provider + externalId.
  if (query.provider && query.externalId) {
    const hit = candidate.providerRefs.some(
      (r) => r.provider === query.provider && r.externalId === query.externalId,
    );
    if (hit) return { candidate, score: 0.98, reasons: ["exact provider+externalId match"], warnings, versionMismatch: [] };
  }

  // Title similarity.
  const qTitle = normalizeTitle(query.title);
  let score = 0;
  if (qTitle && qTitle === candidate.normalizedTitle) {
    score += 0.55;
    reasons.push("normalized title exact");
  } else if (qTitle && candidate.normalizedTitle && (candidate.normalizedTitle.includes(qTitle) || qTitle.includes(candidate.normalizedTitle))) {
    score += 0.32;
    reasons.push("normalized title contains");
  } else {
    reasons.push("title differs");
  }

  // Artist overlap (normalized). Primary-artist match is worth the most.
  const qArtists = (query.artists ?? []).map(normalizeArtistName).filter(Boolean);
  if (qArtists.length && candidate.artistNames.length) {
    const candSet = new Set(candidate.artistNames);
    const primaryHit = candSet.has(qArtists[0]);
    const anyHit = qArtists.some((a) => candSet.has(a));
    if (primaryHit) {
      score += 0.3;
      reasons.push("primary artist match");
    } else if (anyHit) {
      score += 0.15;
      reasons.push("secondary artist match");
    } else {
      score -= 0.15;
      warnings.push("no artist overlap");
    }
  }

  // Version compatibility (guards live/remix/cover/karaoke/instrumental/sped/slowed/…).
  const ver = versionCompatible(query.title, candidate.displayTitle);
  const versionMismatch = ver.mismatchedCues;
  if (!ver.compatible) {
    const candidateOnly = versionMismatch.filter((c) => !c.startsWith("missing:"));
    const hardHit = candidateOnly.some((c) => HARD_BLOCK_CUES.has(c));
    if (hardHit) {
      warnings.push(`version block: candidate is ${candidateOnly.join(", ")}`);
      score = Math.min(score, 0.2);
    } else {
      warnings.push(`version mismatch: ${versionMismatch.join(", ")}`);
      score -= SOFT_PENALTY;
    }
  }

  // Duration tolerance.
  let durationDeltaMs: number | undefined;
  if (typeof query.durationMs === "number" && typeof candidate.durationMs === "number" && candidate.durationMs > 0) {
    durationDeltaMs = Math.abs(query.durationMs - candidate.durationMs);
    if (durationDeltaMs <= DURATION_TIGHT_MS) {
      score += 0.12;
      reasons.push("duration tight");
    } else if (durationDeltaMs <= DURATION_LOOSE_MS) {
      score += 0.04;
      reasons.push("duration close");
    } else if (durationDeltaMs >= DURATION_FAR_MS) {
      score -= 0.22;
      warnings.push(`duration off by ${Math.round(durationDeltaMs / 1000)}s`);
    }
  }

  // Album/release nudge.
  if (query.album && candidate.displayTitle && normalizeTitle(query.album) && candidate.normalizedTitle.includes(normalizeTitle(query.album))) {
    score += 0.03;
    reasons.push("album hint");
  }

  return { candidate, score: Math.max(0, Math.min(1, score)), reasons, warnings, versionMismatch, durationDeltaMs };
}

/** PURE — rank candidates and pick the best above threshold. */
export function rankCandidates(query: ResolverQuery, candidates: ResolverCandidate[]): ResolveResult {
  const scored = candidates
    .map((c) => scoreCandidate(query, c))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const decision = decideResolution(best);
  const method: MatchMethod = !best
    ? "none"
    : decision === "auto_match"
      ? best.reasons.includes("exact ISRC match")
        ? "isrc"
        : best.reasons.includes("exact provider+externalId match")
          ? "provider_external_id"
          : (query.artists?.length ?? 0) > 0
            ? "title_artist"
            : "title_only"
      : "none";

  return {
    match: decision === "auto_match" ? best.candidate : null,
    confidence: best?.score ?? 0,
    method,
    decision,
    thresholds: RESOLVER_THRESHOLDS,
    reasons: best?.reasons ?? ["no candidates"],
    warnings: best?.warnings ?? [],
    candidates: scored,
    versionMismatch: best?.versionMismatch,
    durationDeltaMs: best?.durationDeltaMs,
  };
}

/**
 * Minimal Prisma surface the DB resolver needs (kept structural so the pure core stays
 * DB-free and testable). Pass a PrismaClient (or a compatible stub) at the call site.
 */
export interface ResolverPrisma {
  universalTrack: {
    findUnique(args: unknown): Promise<unknown>;
    findMany(args: unknown): Promise<unknown[]>;
  };
  providerMapping: {
    findFirst(args: unknown): Promise<unknown>;
  };
}

interface RawUniversalTrack {
  id: string;
  displayTitle: string;
  normalizedTitle: string;
  durationMs: number | null;
  canonicalIsrc: string | null;
  versionType: TrackVersionName | null;
  artists?: Array<{ artist?: { normalizedName?: string | null } | null }>;
  providerMappings?: Array<{ provider: string; externalId: string }>;
}

function toCandidate(t: RawUniversalTrack): ResolverCandidate {
  return {
    id: t.id,
    displayTitle: t.displayTitle,
    normalizedTitle: t.normalizedTitle,
    durationMs: t.durationMs,
    canonicalIsrc: t.canonicalIsrc,
    versionType: t.versionType,
    artistNames: (t.artists ?? [])
      .map((a) => a.artist?.normalizedName ?? "")
      .filter((n): n is string => Boolean(n)),
    providerRefs: (t.providerMappings ?? []).map((m) => ({ provider: m.provider, externalId: m.externalId })),
  };
}

const CANDIDATE_INCLUDE = { artists: { include: { artist: true } }, providerMappings: true } as const;

/**
 * DB-backed resolve. Ladder: ISRC → provider+externalId → normalizedTitle+artist.
 * Returns null (never a YouTube fallback) when nothing clears the threshold.
 */
export async function resolveUniversalTrack(prisma: ResolverPrisma, query: ResolverQuery): Promise<ResolveResult> {
  // 1) Exact ISRC.
  if (query.isrc) {
    const row = (await prisma.universalTrack.findUnique({
      where: { canonicalIsrc: query.isrc.toUpperCase() },
      include: CANDIDATE_INCLUDE,
    })) as RawUniversalTrack | null;
    if (row) {
      const cand = toCandidate(row);
      return { match: cand, confidence: 1, method: "isrc", decision: "auto_match", thresholds: RESOLVER_THRESHOLDS, reasons: ["exact ISRC match"], warnings: [], candidates: [{ candidate: cand, score: 1, reasons: ["exact ISRC match"], warnings: [], versionMismatch: [] }] };
    }
  }

  // 2) Exact provider + externalId.
  if (query.provider && query.externalId) {
    const mapping = (await prisma.providerMapping.findFirst({
      where: { provider: query.provider, externalId: query.externalId },
      include: { track: { include: CANDIDATE_INCLUDE } },
    })) as { track?: RawUniversalTrack } | null;
    if (mapping?.track) {
      const cand = toCandidate(mapping.track);
      return { match: cand, confidence: 0.98, method: "provider_external_id", decision: "auto_match", thresholds: RESOLVER_THRESHOLDS, reasons: ["exact provider+externalId match"], warnings: [], candidates: [{ candidate: cand, score: 0.98, reasons: ["exact provider+externalId match"], warnings: [], versionMismatch: [] }] };
    }
  }

  // 3) Title (+artist) candidates by normalized title.
  const normTitle = normalizeTitle(query.title);
  if (!normTitle) {
    return { match: null, confidence: 0, method: "none", decision: "unresolved", thresholds: RESOLVER_THRESHOLDS, reasons: ["empty title"], warnings: [], candidates: [] };
  }
  const rows = (await prisma.universalTrack.findMany({
    where: { normalizedTitle: normTitle },
    include: CANDIDATE_INCLUDE,
    take: 25,
  })) as RawUniversalTrack[];

  return rankCandidates(query, rows.map(toCandidate));
}
