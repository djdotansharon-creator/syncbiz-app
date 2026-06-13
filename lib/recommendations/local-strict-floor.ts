/**
 * Pilot Blocker (Local Jazz strictness) — strict floor for local AI candidates.
 *
 * Why this exists:
 *   `scoreLocalTrackForAiSearch` accepts a row when the prompt term appears in any
 *   of its searchable fields — including `relativePathFromRoot`/`absolutePath`. For
 *   a direct genre prompt like "jazz", that lets folder-name-only matches pass the
 *   filter even when the file has no real Genre/Comment/XLSX metadata supporting
 *   the prompt (the file might be `Jazzanova - Boogie Woogie.mp3`, which is closer
 *   to Latin/Bossa than to Jazz, OR a freshly-scanned file with no ID3 tags whose
 *   parent folder coincidentally contains the substring "jazz").
 *
 * What the floor does:
 *   When `parseSmartCatalogQuery(prompt).styleTaxonomySlugs` is non-empty (e.g.
 *   `["jazz"]`), every local candidate must satisfy at least ONE of:
 *     1. Strong-field match: matchDebug indicates the term was found in `genre`,
 *        `comment`, `title`, `artist`, `album`, or `year` (real ID3 / XLSX metadata).
 *     2. Trusted folder match: any folder segment of `absolutePath` matches one
 *        of the known PlaylistPro folder labels for the parser slug set (e.g.
 *        "JAZZ - General", "JAZZ - Smooth", "JAZZ - Swing"), the slug name itself
 *        (e.g. "jazz", "smooth-jazz", "swing"), or a slug-with-spaces variant.
 *
 *   Candidates that only matched on `path` / `haystack` for a non-trusted folder
 *   (e.g. an artist folder named "Jazzanova" or a one-off filename containing
 *   "jazz" inside another word) are rejected. Empty `parserSlugs` disables the
 *   floor entirely — no regression for prompts that don't carry a style slug.
 *
 *   This complements the catalog-side parser-slug floor in
 *   `ai-playlist-intent-match.ts` and is the local-search equivalent.
 */

import {
  DJ_INTENT_LOCAL_GROUP_DEFINITIONS,
  type DjIntentLocalGroupDefinition,
} from "@/lib/dj-intent-dictionary";
import playlistProMergeConfig from "@/lib/music-taxonomy-playlist-pro-merge-config.json";

/**
 * Minimal shape used by the floor — kept inline here to avoid a TS module
 * cycle with `ai-playlist-generation.ts` (which imports this helper).
 */
export type LocalStrictFloorCandidate = {
  absolutePath: string;
  genre: string | null;
  comment: string | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  matchDebug?: {
    groups?: Array<{ matched: boolean; fields: string[] }>;
  };
};

const PLAYLISTPRO_ALIAS_MERGE: Record<string, string> =
  (playlistProMergeConfig as { aliasMergeByLabel?: Record<string, string> })
    .aliasMergeByLabel ?? {};

/**
 * Strong fields are real ID3 / XLSX evidence the AI can trust as a CATEGORY
 * label, not just a word in the song.
 *
 * Pilot Blocker fix: for a direct genre prompt like `JAZZ`, accepting a row
 * whose only "jazz" evidence is the ID3 `title` ("Smooth Jazz Lounge") or
 * `artist` ("The Jazz Trio") or `album` ("Jazz Standards") leaks
 * filename-style matches back through the floor. The catalog rule for the
 * same prompt requires a taxonomy slug — the local rule must mirror that.
 *
 * What stays strong:
 *   - `genre`  — ID3 GENRE frame / XLSX `genre` column.
 *   - `comment` — PlaylistPro tag bucket ("EASY", "HIT", "JAZZ", "ISRAELI").
 *   - `year`    — decade prompts ("1980") rely on the YEAR frame.
 *
 * What is now WEAK (folder/trusted-tag still wins):
 *   - `title`, `artist`, `album` — words inside the song, not a tag.
 *
 * Path / haystack / BPM remain weak as before.
 */
const STRONG_LOCAL_MATCH_FIELDS = new Set([
  "genre",
  "comment",
  "year",
]);

function lower(s: string | null | undefined): string {
  return (s ?? "").toLowerCase();
}

/** All intent-group definitions whose taxonomySlugs intersect the parser-detected style slugs. */
function localGroupsForParserSlugs(
  parserSlugs: string[],
): DjIntentLocalGroupDefinition[] {
  if (parserSlugs.length === 0) return [];
  const slugSet = new Set(parserSlugs.map(lower).filter((s) => s.length > 0));
  if (slugSet.size === 0) return [];
  return DJ_INTENT_LOCAL_GROUP_DEFINITIONS.filter((def) =>
    def.taxonomySlugs.some((s) => slugSet.has(lower(s))),
  );
}

/**
 * Build the lowercase folder-segment labels that should count as trusted evidence
 * for the given parser slug set. Includes:
 *   - The parser slugs themselves (e.g. "jazz", "smooth-jazz").
 *   - Slug-with-spaces variants (e.g. "smooth jazz").
 *   - Aliases from `music-taxonomy-playlist-pro-merge-config.json`
 *     (e.g. "JAZZ - General" → trusted for parser slug "jazz").
 *   - Hebrew/Latin localSearchTerms from intent groups whose taxonomySlugs
 *     intersect the parser slugs (e.g. "ג׳אז", "ג'אז", "גאז" for "jazz").
 */
export function getTrustedFolderLabelsForParserSlugs(parserSlugs: string[]): string[] {
  if (parserSlugs.length === 0) return [];
  const slugSet = new Set(parserSlugs.map(lower).filter((s) => s.length > 0));
  if (slugSet.size === 0) return [];

  /**
   * Expand the parser slug set through the local intent dictionary so that a
   * parser slug like "jazz" automatically pulls in the rest of its family
   * ("smooth-jazz", "swing", "acid-jazz", "gipsy-jazz"). Without this expansion,
   * the alias scan below misses PlaylistPro labels like "JAZZ - Smooth" (whose
   * config value is "smooth-jazz", not "jazz") for a plain "jazz" prompt.
   */
  const sameFamilyGroups = localGroupsForParserSlugs(parserSlugs);
  const expandedSlugSet = new Set<string>(slugSet);
  for (const def of sameFamilyGroups) {
    for (const slug of def.taxonomySlugs) {
      const s = lower(slug);
      if (s.length > 0) expandedSlugSet.add(s);
    }
  }

  const out = new Set<string>();
  for (const slug of expandedSlugSet) {
    out.add(slug);
    if (slug.includes("-")) out.add(slug.replace(/-/g, " "));
  }
  for (const [label, mappedSlug] of Object.entries(PLAYLISTPRO_ALIAS_MERGE)) {
    if (expandedSlugSet.has(lower(mappedSlug))) {
      out.add(lower(label));
    }
  }
  for (const def of sameFamilyGroups) {
    for (const term of def.localSearchTerms) {
      const t = lower(term);
      if (t.length >= 2) out.add(t);
    }
  }
  return [...out];
}

const LATIN_WORD_RE = /[a-z0-9]/i;

/**
 * Word-boundary substring test for Latin terms (so `jazz` does NOT match `jazzanova`)
 * and substring test for terms containing non-Latin characters (Hebrew terms keep
 * substring semantics — no \b equivalent for Hebrew code points in JS regex).
 */
function folderSegmentMatchesLabel(segment: string, label: string): boolean {
  const s = lower(segment).trim();
  const l = lower(label).trim();
  if (!s || !l) return false;
  if (s === l) return true;
  if (!LATIN_WORD_RE.test(l)) {
    return s.includes(l);
  }
  const escaped = l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, "i").test(s);
}

function folderSegmentsForCandidate(c: { absolutePath: string }): string[] {
  return (c.absolutePath ?? "")
    .split(/[\\/]+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function fieldContainsAnyLabel(
  field: string | null | undefined,
  labels: string[],
): boolean {
  const v = lower(field ?? "");
  if (!v) return false;
  for (const l of labels) {
    if (!l) continue;
    if (!LATIN_WORD_RE.test(l)) {
      if (v.includes(l)) return true;
      continue;
    }
    const escaped = l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, "i").test(v)) {
      return true;
    }
  }
  return false;
}

export type LocalStrictFloorReason =
  | "strong_field"
  | "trusted_folder"
  | "weak_path_only"
  | "no_match";

export type LocalStrictFloorDecision = {
  pass: boolean;
  reason: LocalStrictFloorReason;
  trustedFolderHit: string | null;
  strongFields: string[];
};

/**
 * Apply the local strict floor to a single candidate.
 *
 * Returns `pass: true` when:
 *   - `parserSlugs` is empty (no floor enforced — preserves legacy behavior); OR
 *   - the candidate's matchDebug shows a hit on a strong field
 *     (`genre`, `comment`, or `year`); OR
 *   - the candidate's `genre` or `comment` contains a trusted label
 *     (covers cases where the renderer-side scorer matched a fuzzy path
 *     token but the real ID3/XLSX still supports the slug); OR
 *   - any folder segment of `absolutePath` matches a trusted folder label.
 *
 * Loose `title` / `artist` / `album` word hits are NOT enough — for a direct
 * genre prompt the rule must mirror the catalog parser-slug floor.
 */
export function evaluateLocalStrictFloor(args: {
  candidate: LocalStrictFloorCandidate;
  parserSlugs: string[];
}): LocalStrictFloorDecision {
  const { candidate, parserSlugs } = args;
  if (parserSlugs.length === 0) {
    return { pass: true, reason: "strong_field", trustedFolderHit: null, strongFields: [] };
  }

  const strongFields: string[] = [];
  const dbgGroups = candidate.matchDebug?.groups ?? [];
  for (const g of dbgGroups) {
    if (!g.matched) continue;
    for (const f of g.fields) {
      if (STRONG_LOCAL_MATCH_FIELDS.has(f) && !strongFields.includes(f)) {
        strongFields.push(f);
      }
    }
  }
  if (strongFields.length > 0) {
    return { pass: true, reason: "strong_field", trustedFolderHit: null, strongFields };
  }

  const trustedLabels = getTrustedFolderLabelsForParserSlugs(parserSlugs);
  if (
    fieldContainsAnyLabel(candidate.genre, trustedLabels) ||
    fieldContainsAnyLabel(candidate.comment, trustedLabels)
  ) {
    return {
      pass: true,
      reason: "strong_field",
      trustedFolderHit: null,
      strongFields: ["fallback-genre-or-comment"],
    };
  }

  /*
   * Pilot Blocker fix: title/artist/album fallback intentionally REMOVED.
   *
   * Previously, a row whose only "jazz" signal was in the title
   * ("Smooth Jazz Lounge") or artist ("The Jazz Trio") still passed via
   * a label scan over those fields. That re-introduced filename-style
   * matches we are trying to keep out for direct genre prompts. Now those
   * rows only pass when:
   *   - the ID3 GENRE / COMMENT supports the slug, OR
   *   - the file sits inside a trusted folder (e.g. "JAZZ - Smooth/").
   * Loose title/artist words alone are not enough.
   */

  const segments = folderSegmentsForCandidate(candidate);
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]!;
    for (const label of trustedLabels) {
      if (folderSegmentMatchesLabel(seg, label)) {
        return { pass: true, reason: "trusted_folder", trustedFolderHit: seg, strongFields: [] };
      }
    }
  }

  return {
    pass: false,
    reason: dbgGroups.some((g) => g.matched) ? "weak_path_only" : "no_match",
    trustedFolderHit: null,
    strongFields: [],
  };
}

/** Partition candidates into passing / rejected and surface per-row decisions. */
export function applyLocalStrictFloor<T extends LocalStrictFloorCandidate>(
  candidates: T[],
  parserSlugs: string[],
): {
  passing: T[];
  rejected: Array<{ candidate: T; decision: LocalStrictFloorDecision }>;
  trustedLabels: string[];
} {
  const trustedLabels = getTrustedFolderLabelsForParserSlugs(parserSlugs);
  if (parserSlugs.length === 0) {
    return { passing: candidates, rejected: [], trustedLabels };
  }
  const passing: T[] = [];
  const rejected: Array<{ candidate: T; decision: LocalStrictFloorDecision }> = [];
  for (const c of candidates) {
    const decision = evaluateLocalStrictFloor({ candidate: c, parserSlugs });
    if (decision.pass) passing.push(c);
    else rejected.push({ candidate: c, decision });
  }
  return { passing, rejected, trustedLabels };
}
