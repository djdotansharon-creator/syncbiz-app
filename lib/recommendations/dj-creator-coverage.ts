/**
 * DJ Creator AI — catalog-only **Music Programming Coverage** tier (Stage 6.1).
 *
 * Product: coverage is **not** “genre coverage” alone. Genres, style tags, business-fit tags,
 * daypart tags, energy, URL type, and editorial signals stay **separate dimensions**; a
 * coverage **pack** may combine them for scoring/UX but must not merge them into one axis.
 *
 * Implementation here: heuristic tier from smart-catalog fit scores + tag overlap; no external providers.
 */

export type CatalogCoverageTier = "good" | "partial" | "none";

/** Row counts as "quality" if it has rule-overlapping tags and score above noise. */
export const DJ_CREATOR_QUALITY_FLOOR = 0.48;

/** Typical solid multi-rule fit — raised slightly so “good” means genuinely strong. */
export const DJ_CREATOR_STRONG_SCORE = 1.22;

/** One row can count as a "good" match if it clears this bar. */
export const DJ_CREATOR_EXCEPTIONAL_SCORE = 1.82;

export type DjCreatorCoverageInputRow = {
  displayScore: number;
  matchedTags: string[];
};

export type DjCreatorCoverage = {
  tier: CatalogCoverageTier;
  maxDisplayScore: number;
  qualityRowCount: number;
  queryParsedOk: boolean;
  hints: string[];
};

export function computeDjCreatorCoverage(
  rows: DjCreatorCoverageInputRow[],
  parsed: {
    businessType: string | null;
    matchedPhrases: string[];
    styleTaxonomySlugs: string[];
    moodHints: string[];
    conceptTags: string[];
  },
  parserTaxonomyInDictionary: string[],
): DjCreatorCoverage {
  const queryParsedOk =
    parsed.matchedPhrases.length > 0 ||
    parsed.businessType != null ||
    parsed.styleTaxonomySlugs.length > 0 ||
    parsed.moodHints.length > 0 ||
    parsed.conceptTags.length > 0;

  const qualityRows = rows.filter(
    (r) => r.matchedTags.length > 0 && r.displayScore >= DJ_CREATOR_QUALITY_FLOOR,
  );
  const qualityRowCount = qualityRows.length;
  const maxDisplayScore =
    qualityRows.length > 0
      ? Math.max(...qualityRows.map((r) => r.displayScore))
      : rows.length > 0
        ? Math.max(...rows.map((r) => r.displayScore))
        : 0;

  let tier: CatalogCoverageTier;
  if (qualityRowCount === 0) {
    tier = "none";
  } else if (
    (maxDisplayScore >= DJ_CREATOR_EXCEPTIONAL_SCORE && qualityRowCount >= 1) ||
    (maxDisplayScore >= DJ_CREATOR_STRONG_SCORE && qualityRowCount >= 3) ||
    (maxDisplayScore >= DJ_CREATOR_STRONG_SCORE + 0.28 && qualityRowCount >= 2)
  ) {
    tier = "good";
  } else {
    tier = "partial";
  }

  const hints: string[] = [];
  if (tier !== "good" && parserTaxonomyInDictionary.length > 0) {
    const tagsInResults = new Set(rows.flatMap((r) => r.matchedTags));
    const missingSlugs = parserTaxonomyInDictionary.filter((s) => !tagsInResults.has(s));
    if (missingSlugs.length > 0) {
      hints.push(
        `Low or missing overlap on requested programming tags (e.g. style slugs): ${missingSlugs.slice(0, 6).join(", ")}${missingSlugs.length > 6 ? "…" : ""}.`,
      );
    }
  }
  if (tier !== "good" && queryParsedOk && qualityRowCount <= 1) {
    hints.push(
      "Your request was parsed, but fewer tagged catalog rows strongly match — try broader wording or grow catalog coverage.",
    );
  }

  return {
    tier,
    maxDisplayScore: Math.round(maxDisplayScore * 10000) / 10000,
    qualityRowCount,
    queryParsedOk,
    hints,
  };
}
