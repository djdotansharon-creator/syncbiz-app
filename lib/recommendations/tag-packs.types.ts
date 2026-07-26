/**
 * Tag packs — curated, owner-editable bundles that map a SEED taxonomy slug (a genre
 * or style) to the RELATED cross-dimension slugs (business fit / daypart / energy) an
 * admin usually adds with it, plus AVOID slugs. Powers the "Related to your picks"
 * one-click chips in the catalog tagging workbench. Deterministic + slug-native.
 *
 * Mirrors the fit-rules.json / music-affinity-branches.json precedent: a committed
 * JSON validated at load. Lightweight runtime validation (no zod dep) — invalid packs
 * are dropped rather than throwing, so a bad hand-edit can never break the workbench.
 */

export type TagPackEnergyBand = "LOW" | "MEDIUM" | "HIGH";

export type TagPack = {
  id: string;
  seedTagSlugs: string[];
  relatedTagSlugs: string[];
  avoidTagSlugs: string[];
  suggestEnergyBand: TagPackEnergyBand | null;
  isActive: boolean;
  explainHuman: string;
};

export type TagPacksBundle = {
  version: number;
  packs: TagPack[];
};

const ENERGY_BANDS: ReadonlySet<string> = new Set(["LOW", "MEDIUM", "HIGH"]);

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [];
}

/** Validate + normalize a raw bundle; drop malformed packs (never throw). */
export function parseTagPacksBundle(raw: unknown): TagPacksBundle {
  const obj = (raw ?? {}) as { version?: unknown; packs?: unknown };
  const version = typeof obj.version === "number" ? obj.version : 1;
  const rawPacks = Array.isArray(obj.packs) ? obj.packs : [];
  const packs: TagPack[] = [];
  for (const p of rawPacks) {
    const row = (p ?? {}) as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    const seedTagSlugs = asStringArray(row.seedTagSlugs);
    const relatedTagSlugs = asStringArray(row.relatedTagSlugs);
    if (!id || seedTagSlugs.length === 0 || relatedTagSlugs.length === 0) continue;
    const band = typeof row.suggestEnergyBand === "string" && ENERGY_BANDS.has(row.suggestEnergyBand)
      ? (row.suggestEnergyBand as TagPackEnergyBand)
      : null;
    packs.push({
      id,
      seedTagSlugs,
      relatedTagSlugs,
      avoidTagSlugs: asStringArray(row.avoidTagSlugs),
      suggestEnergyBand: band,
      isActive: row.isActive !== false,
      explainHuman: typeof row.explainHuman === "string" ? row.explainHuman : "",
    });
  }
  return { version, packs };
}
