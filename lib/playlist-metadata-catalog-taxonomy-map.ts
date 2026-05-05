/**
 * SUPER_ADMIN playlist → global catalog taxonomy bridge.
 *
 * Only explicit allowlisted (playlist registry value → MusicTaxonomyTag.slug) pairs are applied.
 * If a taxonomy slug does not exist or is inactive in DB, callers skip it separately.
 */

/** Playlist-derived fields surfaced in playlist edit (`lib/playlist-metadata-registry`). */
export type PlaylistTaxonomyBridgeSourceField =
  | "useCases"
  /** Legacy single key; surfaced via {@link effectivePlaylistUseCases}. */
  | "useCase"
  | "primaryGenre"
  | "subGenres"
  | "mood"
  | "energyLevel";

/** One directional mapping applied only when playlist metadata matches exactly. */
export type PlaylistTaxonomyBridgeRule = Readonly<{
  field: PlaylistTaxonomyBridgeSourceField;
  /** Exact string stored on `Playlist` / registry `value`. */
  playlistValue: string;
  /** Must match `MusicTaxonomyTag.slug` (ACTIVE rows only resolved at runtime). */
  taxonomySlug: string;
}>;

/**
 * Small allowlist only — extend here; never infer at runtime beyond this table.
 *
 * Verified against `prisma/seed-data/music-taxonomy.generated.json` for slugs present in seed data.
 * `{ playlistValue: "afro-house", taxonomySlug: "afro-house" }` relies on slug existing in deployed DB —
 * seed may omit; runtime `missingTaxonomyTags` catches absence.
 */
export const PLAYLIST_METADATA_TAXONOMY_BRIDGE_RULES: readonly PlaylistTaxonomyBridgeRule[] = [
  { field: "subGenres", playlistValue: "progressive-house", taxonomySlug: "progressive-house" },
  { field: "subGenres", playlistValue: "afro-house", taxonomySlug: "afro-house" },

  { field: "useCases", playlistValue: "gym", taxonomySlug: "gym" },
  { field: "useCases", playlistValue: "retail", taxonomySlug: "retail-store" },
  { field: "useCases", playlistValue: "peak", taxonomySlug: "peak-hours" },
  { field: "useCases", playlistValue: "warmup", taxonomySlug: "warm-up" },

  { field: "energyLevel", playlistValue: "high", taxonomySlug: "high-energy" },
  { field: "energyLevel", playlistValue: "low", taxonomySlug: "low-energy" },
] as const;

export type MappedPlaylistTaxonomySlug = Readonly<{
  field: PlaylistTaxonomyBridgeSourceField;
  playlistValue: string;
  taxonomySlug: string;
}>;

export type SkippedPlaylistTaxonomyBridge = Readonly<{
  field: PlaylistTaxonomyBridgeSourceField;
  playlistValue: string;
  reason: "no_allowlisted_mapping";
}>;

/**
 * Builds unique taxonomy slug targets from playlist metadata strings only via the allowlisted rules.
 * Does not query the database — missing slugs are handled by the caller.
 */
export function collectAllowlistedPlaylistTaxonomyMappings(input: Readonly<{
  /** Effective use-case strings (combined `useCases` + legacy `useCase`). */
  useCasesEffective: readonly string[];
  primaryGenre?: string | null;
  subGenres?: readonly string[] | null;
  mood?: string | null;
  energyLevel?: string | null;
}>): Readonly<{ mappedValues: MappedPlaylistTaxonomySlug[]; skipped: SkippedPlaylistTaxonomyBridge[] }> {
  const mappedValues: MappedPlaylistTaxonomySlug[] = [];
  const skipped: SkippedPlaylistTaxonomyBridge[] = [];
  const seenMapped = new Set<string>();

  const pushMapped = (
    field: PlaylistTaxonomyBridgeSourceField,
    playlistValue: string,
    taxonomySlug: string,
  ) => {
    const key = `${field}\t${playlistValue}\t${taxonomySlug}`;
    if (seenMapped.has(key)) return;
    seenMapped.add(key);
    mappedValues.push({ field, playlistValue, taxonomySlug });
  };

  const matchField = (
    field: PlaylistTaxonomyBridgeSourceField,
    playlistValueRaw: string,
  ): void => {
    const playlistValue = playlistValueRaw.trim();
    if (!playlistValue) return;
    const hit = PLAYLIST_METADATA_TAXONOMY_BRIDGE_RULES.find(
      (r) => r.field === field && r.playlistValue === playlistValue,
    );
    if (hit) pushMapped(field, playlistValue, hit.taxonomySlug);
    else skipped.push({ field, playlistValue, reason: "no_allowlisted_mapping" });
  };

  for (const v of input.useCasesEffective) {
    matchField("useCases", v);
  }
  if ((input.primaryGenre ?? "").trim()) {
    matchField("primaryGenre", String(input.primaryGenre));
  }
  for (const v of input.subGenres ?? []) {
    matchField("subGenres", String(v));
  }
  if ((input.mood ?? "").trim()) {
    matchField("mood", String(input.mood));
  }
  if ((input.energyLevel ?? "").trim()) {
    matchField("energyLevel", String(input.energyLevel));
  }

  return { mappedValues, skipped };
}
