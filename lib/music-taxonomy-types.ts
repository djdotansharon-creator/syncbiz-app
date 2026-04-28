/**
 * Stage 3 — Music Taxonomy Dictionary (shared types).
 * Enum literals mirror `MusicTaxonomyCategory` / `MusicTaxonomyTagStatus` in schema.prisma.
 */

export type MusicTaxonomyCategoryLiteral =
  | "PLAYBACK_CONTEXT"
  | "VIBE_ENERGY"
  | "MAIN_SOUND_GENRE"
  | "STYLE_TAGS"
  | "ISRAELI_SPECIALS"
  | "TECHNICAL_TAGS"
  | "BUSINESS_FIT"
  | "DAYPART_FIT";

export type MusicTaxonomyTagStatusLiteral =
  | "ACTIVE"
  | "DEPRECATED"
  | "HIDDEN"
  | "MERGED";

export type MusicTaxonomySeedRow = {
  slug: string;
  category: MusicTaxonomyCategoryLiteral;
  labelEn: string;
  labelHe: string;
  descriptionHeUser?: string | null;
  descriptionAi?: string | null;
  aliases?: string[];
  status?: MusicTaxonomyTagStatusLiteral;
  parentSlug?: string | null;
  mergedIntoSlug?: string | null;
  sortOrder?: number;
};
