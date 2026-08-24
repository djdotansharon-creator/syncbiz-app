/**
 * COMMUNITY FEEDBACK SIGNAL (catalog Phase 2).
 *
 * A SOFT, low-weight ranking signal derived from users' "Suggest info" submissions
 * (`UserMetadataContribution`). It is deliberately kept SEPARATE from the authoritative catalog:
 * it NEVER writes CatalogItem fields — it only nudges the DJ-AI ranking a little toward tracks the
 * community endorsed. Editorial signals (curationRating, SELECTED) always outweigh it.
 *
 * Anti-gaming: everything is counted by DISTINCT userId, and endorsements are capped — a single
 * user submitting many times cannot inflate a track. A genre only counts once ≥ MIN_AGREEMENT
 * DISTINCT users independently suggested it.
 */

import type { PrismaClient } from "@prisma/client";

/** Per-endorsement additive weight (below CURATION/SELECTED so editorial always wins). */
export const COMMUNITY_GREAT_WEIGHT = 0.02;
/** Cap on distinct "great track" endorsements counted (prevents runaway boosts). */
export const COMMUNITY_GREAT_MAX = 3;
/** Additive weight when an agreed community genre matches a query cue. */
export const COMMUNITY_GENRE_WEIGHT = 0.03;
/** Distinct users who must independently agree on a genre before it counts. */
export const COMMUNITY_GENRE_MIN_AGREEMENT = 2;

export type CommunityFeedbackAgg = {
  /** Distinct users who marked this track "great". */
  greatCount: number;
  /** Lowercased genres suggested by ≥ COMMUNITY_GENRE_MIN_AGREEMENT distinct users. */
  agreedGenres: string[];
  /** Distinct users who contributed any suggestion for this track. */
  contributorCount: number;
};

/**
 * Aggregate community feedback per catalogItemId. Reads ALL contributions (there is no admin
 * approval flow yet); trust comes from distinct-user counting + the agreement threshold, not status.
 */
export async function loadCommunityFeedbackByCatalogId(
  prisma: PrismaClient,
  catalogItemIds: string[],
): Promise<Map<string, CommunityFeedbackAgg>> {
  const out = new Map<string, CommunityFeedbackAgg>();
  const ids = [...new Set(catalogItemIds.filter((x): x is string => !!x))];
  if (ids.length === 0) return out;

  const rows = await prisma.userMetadataContribution.findMany({
    where: { catalogItemId: { in: ids } },
    select: { catalogItemId: true, userId: true, greatTrack: true, genre: true },
  });

  const greatUsers = new Map<string, Set<string>>();
  const allUsers = new Map<string, Set<string>>();
  const genreUsers = new Map<string, Map<string, Set<string>>>();

  const ensure = <T>(m: Map<string, T>, k: string, mk: () => T): T => {
    let v = m.get(k);
    if (!v) { v = mk(); m.set(k, v); }
    return v;
  };

  for (const r of rows) {
    const id = r.catalogItemId;
    if (!id) continue;
    ensure(allUsers, id, () => new Set<string>()).add(r.userId);
    if (r.greatTrack) ensure(greatUsers, id, () => new Set<string>()).add(r.userId);
    const g = (r.genre ?? "").trim().toLowerCase();
    if (g) {
      const perGenre = ensure(genreUsers, id, () => new Map<string, Set<string>>());
      ensure(perGenre, g, () => new Set<string>()).add(r.userId);
    }
  }

  for (const id of ids) {
    const contributorCount = allUsers.get(id)?.size ?? 0;
    if (contributorCount === 0) continue;
    const perGenre = genreUsers.get(id);
    const agreedGenres = perGenre
      ? [...perGenre.entries()].filter(([, users]) => users.size >= COMMUNITY_GENRE_MIN_AGREEMENT).map(([g]) => g)
      : [];
    out.set(id, {
      greatCount: greatUsers.get(id)?.size ?? 0,
      agreedGenres,
      contributorCount,
    });
  }

  return out;
}

export type CommunityBoost = { boost: number; reasons: string[] };

/**
 * Pure scoring: turn an aggregate + the query's lowercased cue set into a small additive boost.
 * Returns 0 when there is nothing to add — never negative, never dominant.
 */
export function computeCommunityBoost(
  agg: CommunityFeedbackAgg | undefined,
  queryCuesLc: ReadonlySet<string>,
): CommunityBoost {
  if (!agg) return { boost: 0, reasons: [] };
  const reasons: string[] = [];
  let boost = 0;

  if (agg.greatCount > 0) {
    const counted = Math.min(agg.greatCount, COMMUNITY_GREAT_MAX);
    const b = counted * COMMUNITY_GREAT_WEIGHT;
    boost += b;
    reasons.push(`community “great track” ×${agg.greatCount} (+${b.toFixed(4)})`);
  }

  if (agg.agreedGenres.length > 0 && queryCuesLc.size > 0) {
    const hit = agg.agreedGenres.find((g) => queryCuesLc.has(g));
    if (hit) {
      boost += COMMUNITY_GENRE_WEIGHT;
      reasons.push(`community genre “${hit}” matches your cue (+${COMMUNITY_GENRE_WEIGHT.toFixed(4)})`);
    }
  }

  return { boost, reasons };
}
