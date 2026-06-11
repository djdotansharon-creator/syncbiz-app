/**
 * Per-track display metadata resolver.
 *
 * Centralized priority chain for the chips shown next to AI-built playlist
 * tracks (track list rows, mobile rows, Now Playing hero). The user-facing
 * goal: "what genre/mood did the AI pick for this track?". The resolver does
 * NOT mutate the global catalog; it only reads what's already attached to the
 * track / parent playlist (plus an optional session cache populated when the
 * AI build returns).
 *
 * Priority chain (first hit wins for genre / mood):
 *   1. Track-level fields populated by the AI builder
 *      (`PlaylistTrack.genre` / `mood` / `subGenres`).
 *      These already encode the data-priority rules:
 *        local ID3/XLSX > catalog taxonomy > playlist track metadata.
 *   2. Session cache: `tracksMeta[track.id]` from the most recent AI build
 *      response (used after page navigation when the persisted PlaylistItem
 *      columns don't carry taxonomy).
 *   3. Parent playlist taxonomy
 *      (`primaryGenre`, `mood`, `subGenres`, legacy free-form `genre` string).
 *   4. Fallback localized "Unclassified" label.
 *
 * `sourceLabel` is independent of the genre chain — it reflects provenance
 * (Local / Catalog / YouTube / SoundCloud / ...). For `local` tracks we never
 * surface the absolute path; we only ever expose the "Local" badge.
 */

import type { Locale } from "./locale-context";
import {
  playlistMetadataRegistry,
  type MetadataMoodValue,
  type MetadataPrimaryGenreValue,
  type MetadataSubGenreValue,
} from "./playlist-metadata-registry";
import type {
  Playlist,
  PlaylistTrack,
  PlaylistTrackMetadataSource,
  PlaylistType,
} from "./playlist-types";

export type TrackChipSource =
  | "local"
  | "catalog"
  | "youtube"
  | "soundcloud"
  | "spotify"
  | "stream"
  | "other";

export type TrackDisplayMetadata = {
  /** Top-line provenance badge. Always present. */
  sourceKind: TrackChipSource;
  /** Localized label for `sourceKind` (e.g. "Local", "YouTube", "Catalog"). */
  sourceLabel: string;
  /** Primary genre / style chip. Null if no taxonomy is known anywhere. */
  genreChip: string | null;
  /** Mood / energy chip if available. */
  moodChip: string | null;
  /** Up to 2 additional sub-genre / style chips. */
  subGenreChips: string[];
  /** Localized fallback used when `genreChip` is null and we still want a chip. */
  unclassifiedLabel: string;
  /** Operator-only: which source the genre/mood came from. */
  metadataSource: PlaylistTrackMetadataSource | null;
};

/** Lookup cache populated from `AiPlaylistBuildOk.tracksMeta` after a fresh build. */
export type SessionTrackMetaCache = Readonly<
  Record<
    string,
    {
      genre?: string | null;
      mood?: string | null;
      subGenres?: readonly string[] | null;
      metadataSource?: PlaylistTrackMetadataSource | null;
    }
  >
>;

export type ResolveTrackDisplayMetaOptions = {
  parentPlaylist?: Partial<
    Pick<Playlist, "primaryGenre" | "subGenres" | "mood" | "genre">
  > | null;
  /** Optional session cache keyed by `track.id`. */
  trackMetaCache?: SessionTrackMetaCache | null;
  /** UI locale; defaults to English. */
  locale?: Locale;
};

const SOURCE_LABELS: Record<TrackChipSource, { en: string; he: string }> = {
  local: { en: "Local", he: "מקומי" },
  catalog: { en: "Catalog", he: "קטלוג" },
  youtube: { en: "YouTube", he: "YouTube" },
  soundcloud: { en: "SoundCloud", he: "SoundCloud" },
  spotify: { en: "Spotify", he: "Spotify" },
  stream: { en: "Stream", he: "סטרים" },
  other: { en: "Other", he: "אחר" },
};

const UNCLASSIFIED_LABEL: Record<Locale, string> = {
  en: "Unclassified",
  he: "לא סווג",
};

function pickSourceKind(track: Pick<PlaylistTrack, "type" | "catalogItemId">): TrackChipSource {
  if (track.type === "local") return "local";
  if (track.catalogItemId) return "catalog";
  switch (track.type) {
    case "youtube":
      return "youtube";
    case "soundcloud":
      return "soundcloud";
    case "spotify":
      return "spotify";
    case "stream-url":
      return "stream";
    default:
      return "other";
  }
}

function localeOrDefault(locale?: Locale): Locale {
  return locale === "he" ? "he" : "en";
}

function trimOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function lookupRegistryLabel<
  T extends { value: string; label: string },
>(registry: readonly T[], value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  const hit = registry.find((row) => row.value === normalized);
  return hit?.label ?? null;
}

function prettifySlug(value: string): string {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function asDisplayGenre(value: string | null): string | null {
  if (!value) return null;
  const fromRegistry = lookupRegistryLabel(
    playlistMetadataRegistry.primaryGenres,
    value,
  );
  if (fromRegistry) return fromRegistry;
  // Free-form (e.g. ID3 "Jazz" or "Israeli Pop"): keep as-is, just tidy casing.
  return prettifySlug(value);
}

function asDisplayMood(value: string | null): string | null {
  if (!value) return null;
  const fromRegistry = lookupRegistryLabel(
    playlistMetadataRegistry.moods,
    value,
  );
  if (fromRegistry) return fromRegistry;
  return prettifySlug(value);
}

function asDisplaySubGenre(value: string): string | null {
  if (!value) return null;
  const fromRegistry = lookupRegistryLabel(
    playlistMetadataRegistry.subGenres,
    value,
  );
  if (fromRegistry) return fromRegistry;
  return prettifySlug(value);
}

function dedupeChips(values: Array<string | null>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

/**
 * Resolve the per-track chip data. Pure function — safe to call from server or
 * client. Falls back gracefully when nothing is known about the track.
 */
export function resolveTrackDisplayMetadata(
  track: Pick<
    PlaylistTrack,
    "id" | "type" | "catalogItemId" | "genre" | "mood" | "subGenres" | "metadataSource"
  >,
  options: ResolveTrackDisplayMetaOptions = {},
): TrackDisplayMetadata {
  const locale = localeOrDefault(options.locale);
  const sourceKind = pickSourceKind(track);
  const sourceLabel = SOURCE_LABELS[sourceKind][locale];

  const cached = options.trackMetaCache?.[track.id] ?? null;

  // Priority 1: track-level fields (populated by the AI builder).
  // Priority 2: session cache (same shape, populated from API response).
  // We use a small helper to coalesce while tracking provenance.
  const trackGenre = trimOrNull(track.genre);
  const trackMood = trimOrNull(track.mood);
  const trackSubGenres = (track.subGenres ?? []).map(trimOrNull).filter(Boolean) as string[];
  const trackMetadataSource = track.metadataSource ?? null;

  const cachedGenre = trimOrNull(cached?.genre);
  const cachedMood = trimOrNull(cached?.mood);
  const cachedSubGenres = (cached?.subGenres ?? [])
    .map(trimOrNull)
    .filter(Boolean) as string[];
  const cachedMetadataSource = cached?.metadataSource ?? null;

  // Priority 3: parent playlist taxonomy.
  const playlist = options.parentPlaylist ?? null;
  const playlistPrimary = trimOrNull(playlist?.primaryGenre as string | undefined);
  const playlistLegacyGenre = trimOrNull(playlist?.genre);
  const playlistMood = trimOrNull(playlist?.mood as string | undefined);
  const playlistSubGenres = (playlist?.subGenres ?? [])
    .map((s) => trimOrNull(s as string))
    .filter(Boolean) as string[];

  let chosenGenre: string | null = trackGenre ?? cachedGenre ?? playlistPrimary ?? playlistLegacyGenre;
  let chosenMood: string | null = trackMood ?? cachedMood ?? playlistMood;
  let chosenSubGenres: string[] =
    trackSubGenres.length > 0
      ? trackSubGenres
      : cachedSubGenres.length > 0
        ? cachedSubGenres
        : playlistSubGenres;

  let metadataSource: PlaylistTrackMetadataSource | null = null;
  if (trackGenre || trackMood || trackSubGenres.length > 0) {
    metadataSource = trackMetadataSource ?? null;
  } else if (cachedGenre || cachedMood || cachedSubGenres.length > 0) {
    metadataSource = cachedMetadataSource ?? null;
  } else if (playlistPrimary || playlistMood || playlistSubGenres.length > 0 || playlistLegacyGenre) {
    metadataSource = "playlist";
  }

  // Display-prettify after picking the source so chips read nicely.
  // Dedupe BEFORE the cap so two identical raw inputs (e.g. duplicate ID3
  // tag) don't shadow a legitimate second chip.
  const genreChip = asDisplayGenre(chosenGenre);
  const moodChip = asDisplayMood(chosenMood);
  const subGenreChips = dedupeChips(chosenSubGenres.map(asDisplaySubGenre)).slice(0, 2);

  // If still nothing, fall back to source-only marker.
  let finalGenreChip = genreChip;
  if (!finalGenreChip && !moodChip && subGenreChips.length === 0) {
    metadataSource = metadataSource ?? "fallback";
  }

  return {
    sourceKind,
    sourceLabel,
    genreChip: finalGenreChip,
    moodChip,
    subGenreChips,
    unclassifiedLabel: UNCLASSIFIED_LABEL[locale],
    metadataSource,
  };
}

/** Same registry types re-exported for callers that want strict autocomplete. */
export type {
  MetadataPrimaryGenreValue,
  MetadataMoodValue,
  MetadataSubGenreValue,
  PlaylistType,
};
