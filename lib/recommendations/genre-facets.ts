/**
 * Phase 1 — genre facet index (decade × style × intensity), derived with ZERO
 * schema migration. Reads the checked-in generated map (scripts/build-genre-facets.mjs)
 * and exposes lookups used by the facet filter + the facet chip UI. Filtering never
 * renames or re-tags — it AND-composes these slug-sets over the existing tag join.
 */

import raw from "./genre-facets.generated.json";

export type GenreFacetAxis = "decade" | "style" | "intensity";

export type GenreFacets = {
  decade: string | null;
  style: string | null;
  intensity: string | null;
  region: string | null;
};

const FACETS: Record<string, GenreFacets> = (raw as { facets: Record<string, GenreFacets> }).facets ?? {};

/** Canonical display order for the decade axis. */
export const DECADE_ORDER = ["1970s", "1980s", "1990s", "2000s", "2010s", "oldies"] as const;
export const INTENSITY_ORDER = ["easy", "general"] as const;

// axis -> value -> Set<slug>
const AXIS_INDEX: Record<GenreFacetAxis, Map<string, Set<string>>> = {
  decade: new Map(),
  style: new Map(),
  intensity: new Map(),
};

for (const [slug, f] of Object.entries(FACETS)) {
  for (const axis of ["decade", "style", "intensity"] as const) {
    const v = f[axis];
    if (!v) continue;
    let set = AXIS_INDEX[axis].get(v);
    if (!set) {
      set = new Set();
      AXIS_INDEX[axis].set(v, set);
    }
    set.add(slug);
  }
}

export function facetsForSlug(slug: string): GenreFacets | null {
  return FACETS[slug] ?? null;
}

/** All ACTIVE genre slugs whose given axis equals `value`. */
export function slugsForFacet(axis: GenreFacetAxis, value: string): string[] {
  return [...(AXIS_INDEX[axis].get(value) ?? new Set<string>())];
}

export function isValidFacetValue(axis: GenreFacetAxis, value: string): boolean {
  return AXIS_INDEX[axis].has(value);
}

/** Distinct values for an axis + how many genre slugs carry each (for chip UI). */
export function facetValues(axis: GenreFacetAxis): Array<{ value: string; slugCount: number }> {
  const rows = [...AXIS_INDEX[axis].entries()].map(([value, set]) => ({ value, slugCount: set.size }));
  if (axis === "decade") {
    const order = new Map<string, number>(DECADE_ORDER.map((d, i) => [d, i]));
    rows.sort((a, b) => (order.get(a.value) ?? 99) - (order.get(b.value) ?? 99));
  } else if (axis === "intensity") {
    const order = new Map<string, number>(INTENSITY_ORDER.map((d, i) => [d, i]));
    rows.sort((a, b) => (order.get(a.value) ?? 99) - (order.get(b.value) ?? 99));
  } else {
    rows.sort((a, b) => a.value.localeCompare(b.value));
  }
  return rows;
}
