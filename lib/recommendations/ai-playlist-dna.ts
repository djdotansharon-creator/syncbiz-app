/**
 * Playlist "DNA" for catalog-first AI playlist generation MVP.
 * Deterministic aggregates from persisted playlist + CatalogItem taxonomy (no embeddings).
 */

import type { Playlist } from "@/lib/playlist-types";
import { getPlaylistTracks } from "@/lib/playlist-types";

export type PlaylistDNA = {
  seedPlaylistId: string;
  /** Token line merged into smart-search query text. */
  keywordLine: string;
  /** Preferred taxonomy slugs from seed catalog items (top-N by frequency). */
  dominantTaxonomySlugs: string[];
  moodHints: string[];
  energyLevelLabel: string | null;
  genresFromPlaylistMeta: string[];
  catalogIdsToExclude: string[];
  urlsToExcludeNormalized: Set<string>;
  artistCounts: Map<string, number>;
  avgManualEnergy: number | null;
  avgDurationSec: number | null;
  providerMix: Map<string, number>;
};

function normUrl(u: string): string {
  return u.trim().toLowerCase().replace(/^https:\/\//, "http://");
}

function normArtist(a: string | null | undefined): string {
  return (a ?? "").trim().toLowerCase();
}

/**
 * Hydrate taxonomy + catalog fields for tracks that have catalogId.
 */
export function buildPlaylistDna(args: {
  seed: Playlist;
  catalogRows: Array<{
    id: string;
    url: string;
    artist: string | null;
    provider: string | null;
    durationSec: number | null;
    manualEnergyRating: number | null;
    taxonomySlugs: string[];
    publishedYear: number | null;
  }>;
}): PlaylistDNA {
  const seedPlaylistId = args.seed.id;
  const tracks = getPlaylistTracks(args.seed);
  const catalogById = new Map(args.catalogRows.map((r) => [r.id, r] as const));

  const slugFreq = new Map<string, number>();
  const urlsToExcludeNormalized = new Set<string>();
  const catalogIdsToExclude: string[] = [];
  const artistCounts = new Map<string, number>();
  const providers = new Map<string, number>();
  let energySum = 0;
  let energyN = 0;
  let durSum = 0;
  let durN = 0;
  const moodHints = new Set<string>();
  let decadeYear: number | null = null;

  for (const t of tracks) {
    const u = normUrl(t.url);
    if (u) urlsToExcludeNormalized.add(u);
    const cid = (t.catalogItemId ?? "").trim();
    if (cid) catalogIdsToExclude.push(cid);

    const row = cid ? catalogById.get(cid) : undefined;
    if (row) {
      const ru = normUrl(row.url);
      if (ru) urlsToExcludeNormalized.add(ru);
      for (const s of row.taxonomySlugs) {
        const k = s.trim();
        if (!k) continue;
        slugFreq.set(k, (slugFreq.get(k) ?? 0) + 1);
      }
      const ar = normArtist(row.artist);
      if (ar) artistCounts.set(ar, (artistCounts.get(ar) ?? 0) + 1);

      const p = (row.provider ?? "").trim().toLowerCase();
      if (p) providers.set(p, (providers.get(p) ?? 0) + 1);

      if (
        row.manualEnergyRating != null &&
        Number.isFinite(row.manualEnergyRating) &&
        row.manualEnergyRating >= 1 &&
        row.manualEnergyRating <= 10
      ) {
        energySum += row.manualEnergyRating;
        energyN++;
      }

      if (row.durationSec != null && row.durationSec > 0 && Number.isFinite(row.durationSec)) {
        durSum += row.durationSec;
        durN++;
      }

      if (
        decadeYear == null &&
        row.publishedYear != null &&
        row.publishedYear >= 1900 &&
        row.publishedYear <= 2100
      ) {
        decadeYear = row.publishedYear;
      }
    }
  }

  const dominantTaxonomySlugs = [...slugFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 18)
    .map(([s]) => s);

  const s = args.seed;
  const genresFromPlaylistMeta = [
    s.primaryGenre,
    ...(s.subGenres ?? []),
    ...(s.genre ? [s.genre] : []),
    ...(Array.isArray(s.useCases) ? s.useCases : []),
    s.useCase ?? "",
  ]
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .slice(0, 12);

  if (typeof s.mood === "string" && s.mood.trim()) moodHints.add(s.mood.trim());

  const energyLevelLabel =
    typeof s.energyLevel === "string" && s.energyLevel.trim() ? s.energyLevel.trim() : null;

  const pieces: string[] = [];
  if (decadeYear != null) {
    pieces.push(String(decadeYear));
    pieces.push(`${Math.floor(decadeYear / 10) * 10}s`);
  }
  if (dominantTaxonomySlugs.length)
    pieces.push(dominantTaxonomySlugs.slice(0, 10).join(" "));
  pieces.push(...genresFromPlaylistMeta.map((x) => x.replace(/_/g, " ")));
  if (energyLevelLabel) pieces.push(energyLevelLabel.replace(/_/g, " "));
  for (const m of moodHints) pieces.push(m);

  const keywordLine = pieces.join(" ").replace(/\s+/g, " ").trim();

  return {
    seedPlaylistId,
    keywordLine,
    dominantTaxonomySlugs,
    moodHints: [...moodHints],
    energyLevelLabel,
    genresFromPlaylistMeta,
    catalogIdsToExclude: [...new Set(catalogIdsToExclude)],
    urlsToExcludeNormalized,
    artistCounts,
    avgManualEnergy: energyN ? energySum / energyN : null,
    avgDurationSec: durN ? durSum / durN : null,
    providerMix: providers,
  };
}
