/**
 * Per-track metadata derivation for the AI playlist builder.
 *
 * Centralizes the rules for converting:
 *   - a local candidate's ID3/XLSX fields (genre / comment / album / artist)
 *   - or a catalog row's taxonomy slugs + intent-match group hits
 * into the small chip set the renderer shows on a track row:
 *   { genre, mood, subGenres, metadataSource }.
 *
 * Stays serializable + pure so it can flow through the AI build response and
 * land on `PlaylistTrack` without any catalog mutation.
 */

import {
  DJ_INTENT_LOCAL_GROUP_DEFINITIONS,
  type DjIntentLocalGroupDefinition,
  type DjIntentLocalGroupId,
} from "@/lib/dj-intent-dictionary";
import type { PlaylistTrackMetadataSource } from "@/lib/playlist-types";

export type DerivedTrackMetadata = {
  genre?: string;
  mood?: string;
  subGenres?: string[];
  metadataSource?: PlaylistTrackMetadataSource;
};

const TAXONOMY_SLUG_TO_GROUP: Map<string, DjIntentLocalGroupDefinition> = (() => {
  const map = new Map<string, DjIntentLocalGroupDefinition>();
  for (const def of DJ_INTENT_LOCAL_GROUP_DEFINITIONS) {
    for (const slug of def.taxonomySlugs) {
      const key = slug.trim().toLowerCase();
      if (key && !map.has(key)) map.set(key, def);
    }
    for (const slug of def.vendorTaxonomySlugs ?? []) {
      const key = slug.trim().toLowerCase();
      if (key && !map.has(key)) map.set(key, def);
    }
  }
  return map;
})();

/** Group categories we treat as "genre-like" for chip selection. */
const GENRE_LIKE: ReadonlySet<string> = new Set([
  "genre_style",
  "decade",
  "region_language",
]);

function lookupGroupBySlug(slug: string): DjIntentLocalGroupDefinition | null {
  const key = slug.trim().toLowerCase();
  if (!key) return null;
  return TAXONOMY_SLUG_TO_GROUP.get(key) ?? null;
}

function uniquePush(out: string[], value: string | undefined | null): void {
  if (!value) return;
  const trimmed = value.trim();
  if (!trimmed) return;
  if (out.some((v) => v.toLowerCase() === trimmed.toLowerCase())) return;
  out.push(trimmed);
}

/**
 * Derive chips from a local file's ID3/XLSX fields.
 *
 * The renderer treats ID3 `genre` as authoritative for the genre chip and the
 * `comment` field (where PlaylistPro tags live, e.g. "EASY", "HIT") as a
 * mood/quality hint. Album / folder names are not used directly here — they
 * already influenced search scoring upstream and would muddy the chip.
 */
export function deriveLocalTrackMetadata(input: {
  genre: string | null;
  comment: string | null;
  matchedLocalGroupIds?: readonly DjIntentLocalGroupId[] | null;
}): DerivedTrackMetadata {
  const out: DerivedTrackMetadata = {};
  let usedId3 = false;

  if (input.genre && input.genre.trim()) {
    out.genre = input.genre.trim();
    usedId3 = true;
  }

  const commentTokens = (input.comment ?? "")
    .split(/[,;|/\\]+/g)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const token of commentTokens) {
    const upper = token.toUpperCase();
    if (/^EASY$|^CALM$|^MELLOW$|^CHILL$/.test(upper) || upper === "רגוע" || upper === "שקט") {
      if (!out.mood) out.mood = "Calm";
      usedId3 = true;
    } else if (upper === "HIT" || upper === "HITS" || upper === "להיט" || upper === "להיטים") {
      if (!out.mood) out.mood = "Hits";
      usedId3 = true;
    } else if (upper === "SELECTED" || upper === "מובחרים" || upper === "נבחרים") {
      uniquePush((out.subGenres ??= []), "Selected");
      usedId3 = true;
    }
  }

  // Promote any genre-like local group the builder already matched (e.g.
  // "Israeli", "Mediterranean", "Jazz family") if ID3 didn't already give us
  // a free-form genre. Mood-like groups land in `mood`.
  for (const groupId of input.matchedLocalGroupIds ?? []) {
    const def = DJ_INTENT_LOCAL_GROUP_DEFINITIONS.find((d) => d.id === groupId);
    if (!def) continue;
    if (def.category === "mood_energy") {
      if (!out.mood) out.mood = def.label;
    } else if (GENRE_LIKE.has(def.category)) {
      if (!out.genre) {
        out.genre = def.label;
      } else {
        uniquePush((out.subGenres ??= []), def.label);
      }
    }
  }

  if (out.genre || out.mood || (out.subGenres && out.subGenres.length > 0)) {
    out.metadataSource = usedId3 ? "local_id3" : "fallback";
  }
  return out;
}

/**
 * Derive chips from a catalog row's taxonomy slugs + intent group matches.
 *
 * Strategy:
 *   - Walk taxonomy slugs in order; first slug whose intent group is
 *     genre-like becomes the genre chip; first mood-like one becomes mood.
 *   - Extra genre-like hits flow into subGenres (cap 2).
 *   - If nothing maps, fall back to the prettiest taxonomy slug we can find.
 */
export function deriveCatalogTrackMetadata(input: {
  taxonomySlugs?: readonly string[] | null;
  matchedSlugsFromIntent?: readonly string[] | null;
}): DerivedTrackMetadata {
  const slugs = [
    ...(input.matchedSlugsFromIntent ?? []),
    ...(input.taxonomySlugs ?? []),
  ];
  if (slugs.length === 0) return {};

  const out: DerivedTrackMetadata = {};
  let mapped = false;
  const seenSlug = new Set<string>();

  for (const raw of slugs) {
    const key = raw.trim().toLowerCase();
    if (!key || seenSlug.has(key)) continue;
    seenSlug.add(key);
    const def = lookupGroupBySlug(key);
    if (!def) continue;
    if (def.category === "mood_energy") {
      if (!out.mood) {
        out.mood = def.label;
        mapped = true;
      }
    } else if (GENRE_LIKE.has(def.category)) {
      if (!out.genre) {
        out.genre = def.label;
        mapped = true;
      } else {
        uniquePush((out.subGenres ??= []), def.label);
        mapped = true;
      }
    }
  }

  if (mapped) {
    if (out.subGenres && out.subGenres.length > 2) {
      out.subGenres = out.subGenres.slice(0, 2);
    }
    out.metadataSource = "catalog";
    return out;
  }

  // Nothing mapped via intent groups — prettify the first taxonomy slug so the
  // operator still sees what the catalog put on the track.
  const firstSlug = slugs.find((s) => typeof s === "string" && s.trim().length > 0);
  if (firstSlug) {
    out.genre = firstSlug.trim();
    out.metadataSource = "catalog";
  }
  return out;
}
