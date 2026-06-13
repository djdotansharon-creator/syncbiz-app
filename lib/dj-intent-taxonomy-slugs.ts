/**
 * Known MusicTaxonomyTag slugs from seed JSON (core + PlaylistPro enrichment).
 * Used to validate DJ Intent Dictionary references — not a parallel tag language.
 */

import coreSeed from "@/prisma/seed-data/music-taxonomy.generated.json";
import enrichmentSeed from "@/prisma/seed-data/music-taxonomy-playlist-pro-enrichment.generated.json";
import type { MusicTaxonomySeedRow } from "@/lib/music-taxonomy-types";

type SeedRow = Pick<MusicTaxonomySeedRow, "slug">;

let cachedSlugSet: Set<string> | null = null;

/** All slugs from generated taxonomy seed files (core dictionary + PlaylistPro enrichment). */
export function getKnownMusicTaxonomySlugSet(): Set<string> {
  if (cachedSlugSet) return cachedSlugSet;
  const rows = [...(coreSeed as SeedRow[]), ...(enrichmentSeed as SeedRow[])];
  cachedSlugSet = new Set(rows.map((r) => r.slug.trim()).filter(Boolean));
  return cachedSlugSet;
}

export function isKnownMusicTaxonomySlug(slug: string): boolean {
  return getKnownMusicTaxonomySlugSet().has(slug.trim());
}

export function isPlaylistProEnrichmentSlug(slug: string): boolean {
  return slug.startsWith("playlist-pro-");
}
