/**
 * Intent-aware catalog ranking for AI playlist prompt builds.
 * Mirrors local multi-group AND semantics: full match > partial > unrelated.
 */

import { getDjIntentLocalGroupDefinition, type DjIntentLocalGroupId } from "@/lib/dj-intent-dictionary";
import type { LocalSearchIntentParse } from "@/lib/local-ai-playlist-search";
import type { SmartCatalogSearchResultRow } from "@/lib/recommendations/smart-catalog-search";

export type CatalogIntentGroupMatch = {
  id: DjIntentLocalGroupId | "general";
  label: string;
  matched: boolean;
  matchedSlugs: string[];
};

export type CatalogIntentMatchDebug = {
  groupsMatched: number;
  groupsTotal: number;
  fullMatch: boolean;
  intentScore: number;
  reason: string;
  groups: CatalogIntentGroupMatch[];
};

export type CatalogRowWithIntentMatch = SmartCatalogSearchResultRow & {
  intentMatch: CatalogIntentMatchDebug;
};

function slugSetFromRow(row: SmartCatalogSearchResultRow): Set<string> {
  const fromRow = row.taxonomySlugs ?? [];
  const fromMatched = row.matchedTags ?? [];
  return new Set([...fromRow, ...fromMatched].map((s) => s.trim().toLowerCase()).filter(Boolean));
}

function matchGroupToCatalogSlugs(
  groupId: DjIntentLocalGroupId | "general",
  slugSet: Set<string>,
): CatalogIntentGroupMatch {
  if (groupId === "general") {
    return { id: groupId, label: "Query tokens", matched: false, matchedSlugs: [] };
  }
  const def = getDjIntentLocalGroupDefinition(groupId);
  if (!def) {
    return { id: groupId, label: groupId, matched: false, matchedSlugs: [] };
  }
  const want = new Set(
    [...def.taxonomySlugs, ...(def.vendorTaxonomySlugs ?? [])]
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  const matchedSlugs = [...slugSet].filter((s) => want.has(s));
  return {
    id: groupId,
    label: def.label,
    matched: matchedSlugs.length > 0,
    matchedSlugs,
  };
}

function buildCatalogIntentReason(
  groups: CatalogIntentGroupMatch[],
  groupsTotal: number,
  fullMatch: boolean,
  intentScore: number,
): string {
  const matched = groups.filter((g) => g.matched);
  if (matched.length === 0) return "no intent groups matched in catalog taxonomy";
  const parts = matched.map((g) => {
    const slugs = g.matchedSlugs.slice(0, 4).join(", ");
    return `${g.label} (${slugs || "tags"})`;
  });
  const prefix = groupsTotal >= 2 ? (fullMatch ? "full match" : "partial match") : "match";
  return `${prefix} · intent ${intentScore} · ${parts.join(" · ")}`;
}

export function scoreCatalogRowForAiIntents(
  row: SmartCatalogSearchResultRow,
  intents: LocalSearchIntentParse,
): CatalogIntentMatchDebug {
  const slugSet = slugSetFromRow(row);
  const groups = intents.groups.map((g) => matchGroupToCatalogSlugs(g.id, slugSet));
  const groupsTotal = groups.length;
  const groupsMatched = groups.filter((g) => g.matched).length;

  if (groupsTotal === 0 || groupsMatched === 0) {
    return {
      groupsMatched: 0,
      groupsTotal,
      fullMatch: false,
      intentScore: 0,
      reason: "no intent groups matched in catalog taxonomy",
      groups,
    };
  }

  let intentScore = 0;
  for (const g of groups) {
    if (!g.matched) continue;
    intentScore += 20;
    intentScore += g.matchedSlugs.length * 8;
  }

  const fullMatch = groupsMatched === groupsTotal;
  if (groupsTotal >= 2) {
    if (fullMatch) {
      intentScore += groupsMatched * 24;
    } else {
      intentScore = Math.floor(intentScore * 0.28);
    }
  }

  intentScore += Math.round(row.displayScore * 10) / 100;

  return {
    groupsMatched,
    groupsTotal,
    fullMatch,
    intentScore,
    reason: buildCatalogIntentReason(groups, groupsTotal, fullMatch, intentScore),
    groups,
  };
}

export function rankCatalogRowsForAiIntents(
  rows: SmartCatalogSearchResultRow[],
  intents: LocalSearchIntentParse,
): CatalogRowWithIntentMatch[] {
  const ranked = rows.map((row) => ({
    ...row,
    intentMatch: scoreCatalogRowForAiIntents(row, intents),
  }));

  ranked.sort((a, b) => {
    const fullA = a.intentMatch.fullMatch ? 1 : 0;
    const fullB = b.intentMatch.fullMatch ? 1 : 0;
    if (fullB !== fullA) return fullB - fullA;
    if (b.intentMatch.groupsMatched !== a.intentMatch.groupsMatched) {
      return b.intentMatch.groupsMatched - a.intentMatch.groupsMatched;
    }
    if (b.intentMatch.intentScore !== a.intentMatch.intentScore) {
      return b.intentMatch.intentScore - a.intentMatch.intentScore;
    }
    return b.displayScore - a.displayScore;
  });

  return ranked;
}

export function isSubstantiveMultiIntentQuery(intents: LocalSearchIntentParse): boolean {
  const substantive = intents.groups.filter((g) => g.id !== "general");
  return substantive.length >= 2;
}

/**
 * Pilot relevance floor: returns true when the prompt parsed into AT LEAST ONE
 * substantive (non-`general`) DJ intent group. Used to gate strict catalog
 * overlap and intent-aware ranking so single-intent prompts ("jazz", "workout")
 * cannot fall back to high-`displayScore` YouTube tracks with zero taxonomy
 * overlap. See lib/recommendations/ai-playlist-generation.ts (Blocker 2).
 */
export function hasAnySubstantiveIntent(intents: LocalSearchIntentParse): boolean {
  return intents.groups.some((g) => g.id !== "general");
}

export function splitCatalogPoolByIntentMatch(rows: CatalogRowWithIntentMatch[]): {
  fullMatch: CatalogRowWithIntentMatch[];
  partialMatch: CatalogRowWithIntentMatch[];
  noMatch: CatalogRowWithIntentMatch[];
} {
  return {
    fullMatch: rows.filter((r) => r.intentMatch.fullMatch),
    partialMatch: rows.filter(
      (r) => r.intentMatch.groupsMatched > 0 && !r.intentMatch.fullMatch,
    ),
    noMatch: rows.filter((r) => r.intentMatch.groupsMatched === 0),
  };
}

/**
 * Pilot Blocker (Part 1) — parser-slug floor.
 *
 * Returns true when the catalog row's taxonomy slugs intersect the parser-detected
 * style slug set. Used to gate displayScore selection for prompts whose ONLY
 * relevance signal is a PHRASE_MAP / DJ-intent style slug (e.g. "lounge", "italian",
 * "afro", "bossa"). Prevents a "jazz" prompt from falling through to high-displayScore
 * bossa-nova rows (which would otherwise pass the weak `requireTagOverlap` floor).
 *
 * Case-insensitive on both sides. Empty `parserSlugs` returns true (no floor enforced).
 */
export function catalogRowMatchesParserSlugs(
  row: { taxonomySlugs?: string[]; matchedTags?: string[] },
  parserSlugs: string[],
): boolean {
  if (parserSlugs.length === 0) return true;
  const want = new Set(parserSlugs.map((s) => s.trim().toLowerCase()).filter(Boolean));
  if (want.size === 0) return true;
  const have = [...(row.taxonomySlugs ?? []), ...(row.matchedTags ?? [])]
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  for (const slug of have) {
    if (want.has(slug)) return true;
  }
  return false;
}

/**
 * Split rows into `parserMatch` (taxonomy overlap with parser style slugs) vs
 * `noParserMatch`. Mirrors `splitCatalogPoolByIntentMatch` for the no-DJ-intent path.
 */
export function splitCatalogPoolByParserSlugOverlap<T extends { taxonomySlugs?: string[]; matchedTags?: string[] }>(
  rows: T[],
  parserSlugs: string[],
): { parserMatch: T[]; noParserMatch: T[] } {
  if (parserSlugs.length === 0) {
    return { parserMatch: [...rows], noParserMatch: [] };
  }
  const parserMatch: T[] = [];
  const noParserMatch: T[] = [];
  for (const row of rows) {
    if (catalogRowMatchesParserSlugs(row, parserSlugs)) parserMatch.push(row);
    else noParserMatch.push(row);
  }
  return { parserMatch, noParserMatch };
}
