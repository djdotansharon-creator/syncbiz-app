/**
 * Stage 7 — Music Programming Coverage Packs (data contract).
 * Dimensions stay separate; a pack references slugs per family without merging axes.
 * Runtime wiring (DJ Creator, scoring) is intentionally out of scope here.
 */

import { z } from "zod";

/** Mirrors `MusicTaxonomyCategory` in `prisma/schema.prisma` (string form for JSON). */
export const musicProgrammingCoverageTagFamilySchema = z.enum([
  "PLAYBACK_CONTEXT",
  "VIBE_ENERGY",
  "MAIN_SOUND_GENRE",
  "STYLE_TAGS",
  "ISRAELI_SPECIALS",
  "TECHNICAL_TAGS",
  "BUSINESS_FIT",
  "DAYPART_FIT",
  "CATALOG_PROGRAMMING",
]);

export type MusicProgrammingCoverageTagFamily = z.infer<
  typeof musicProgrammingCoverageTagFamilySchema
>;

/** Aligns with `SourceProviderType` in `lib/source-types.ts` (catalog URL / provider class). */
export const catalogCoverageUrlTypeSchema = z.enum([
  "youtube",
  "soundcloud",
  "spotify",
  "local",
  "stream-url",
  "winamp",
]);

export type CatalogCoverageUrlType = z.infer<typeof catalogCoverageUrlTypeSchema>;

export const catalogCoverageTargetPackSchema = z.object({
  id: z.string().min(1),
  labelHe: z.string().min(1),
  labelEn: z.string().min(1),
  active: z.boolean(),
  priority: z.number().int(),
  businessFitTags: z.array(z.string()),
  daypartTags: z.array(z.string()),
  vibeTags: z.array(z.string()),
  genreTags: z.array(z.string()),
  styleTags: z.array(z.string()),
  catalogProgrammingTags: z.array(z.string()),
  requiredTagFamilies: z.array(musicProgrammingCoverageTagFamilySchema),
  optionalTagFamilies: z.array(musicProgrammingCoverageTagFamilySchema),
  avoidTagFamilies: z.array(musicProgrammingCoverageTagFamilySchema),
  targetMinimumItems: z.number().int().nonnegative(),
  targetSingleCount: z.number().int().nonnegative().nullable(),
  targetSetMixCount: z.number().int().nonnegative().nullable(),
  /** Inclusive 0–10 programming-energy band (workspace / wizard scale). */
  targetEnergyMin: z.number().int().min(0).max(10).nullable(),
  targetEnergyMax: z.number().int().min(0).max(10).nullable(),
  /** When null, any URL type qualifies for coverage checks. */
  urlTypeAllowlist: z.array(catalogCoverageUrlTypeSchema).nullable(),
  avoidTags: z.array(z.string()),
  notes: z.string(),
  /** Slugs that belong in a dimension but are not in `music-taxonomy.generated.json` yet. */
  missingSlugs: z.array(z.string()),
});

export type CatalogCoverageTargetPack = z.infer<typeof catalogCoverageTargetPackSchema>;

export const catalogCoverageTargetsBundleSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string().min(1),
  taxonomyReference: z.string().min(1),
  packs: z.array(catalogCoverageTargetPackSchema).min(1),
});

export type CatalogCoverageTargetsBundle = z.infer<typeof catalogCoverageTargetsBundleSchema>;

export function parseCatalogCoverageTargetsBundle(data: unknown) {
  return catalogCoverageTargetsBundleSchema.safeParse(data);
}
