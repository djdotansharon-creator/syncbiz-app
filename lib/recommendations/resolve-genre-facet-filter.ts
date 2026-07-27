/**
 * Phase 1 — turn a facet selection (decade × style × intensity) + the legacy single
 * `genre` slug into Prisma CatalogItem where-clauses, ANDed together, over the EXISTING
 * CatalogItemTaxonomyTag many-to-many (no schema change). Each active axis becomes one
 * `taxonomyLinks.some({ taxonomyTag: { slug: { in: <slugsForThatAxis> } } })` clause;
 * an unselected axis drops its clause.
 */

import type { Prisma } from "@prisma/client";
import { slugsForFacet, isValidFacetValue, type GenreFacetAxis } from "./genre-facets";

export type GenreFacetSelection = {
  decade?: string | null;
  style?: string | null;
  intensity?: string | null;
  /** Legacy single MAIN_SOUND_GENRE slug (catalog-by-genre card links) — preserved. */
  genre?: string | null;
};

/** A clause that can never match — used when a selected facet value has no slugs, so
 *  the filter honestly returns nothing rather than silently ignoring the selection. */
const IMPOSSIBLE: Prisma.CatalogItemWhereInput = {
  taxonomyLinks: { some: { taxonomyTag: { slug: { in: ["__sb_no_match__"] } } } },
};

function axisClause(axis: GenreFacetAxis, value: string): Prisma.CatalogItemWhereInput {
  if (!isValidFacetValue(axis, value)) return IMPOSSIBLE;
  const slugs = slugsForFacet(axis, value);
  if (slugs.length === 0) return IMPOSSIBLE;
  return { taxonomyLinks: { some: { taxonomyTag: { slug: { in: slugs } } } } };
}

/** Build the AND-clauses for the active facet + legacy genre selection. */
export function resolveGenreFacetClauses(sel: GenreFacetSelection): Prisma.CatalogItemWhereInput[] {
  const clauses: Prisma.CatalogItemWhereInput[] = [];

  const genre = sel.genre?.trim();
  if (genre) {
    clauses.push({ taxonomyLinks: { some: { taxonomyTag: { slug: genre, category: "MAIN_SOUND_GENRE" } } } });
  }

  const decade = sel.decade?.trim();
  if (decade) clauses.push(axisClause("decade", decade));

  const style = sel.style?.trim();
  if (style) clauses.push(axisClause("style", style));

  const intensity = sel.intensity?.trim();
  if (intensity) clauses.push(axisClause("intensity", intensity));

  return clauses;
}

export function hasAnyFacetSelection(sel: GenreFacetSelection): boolean {
  return Boolean(sel.decade?.trim() || sel.style?.trim() || sel.intensity?.trim() || sel.genre?.trim());
}
