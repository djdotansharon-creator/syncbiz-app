/**
 * Pilot Blocker — sibling-group exclusion for region/genre exclusivity.
 *
 * Local intent groups can declare `excludesGroupsWhenAbsent` (see
 * `lib/dj-intent-dictionary.ts`). When the user's prompt activates this group
 * but NOT a listed sibling, AI playlist build rejects rows whose taxonomy
 * (catalog) or fields (local) place them in the sibling group.
 *
 * Example — "ישראלי רגוע להיטים":
 *   active groups = { israeli, mood_calm, hits }
 *   israeli.excludesGroupsWhenAbsent = ["mediterranean", "jazz_family"]
 *   mediterranean ∉ active → reject rows whose taxonomy/text matches Mediterranean
 *   jazz_family   ∉ active → reject rows whose taxonomy/text matches Jazz
 *
 * The user can opt back in by including the sibling in the prompt
 * ("ישראלי מזרחי" lifts the Mediterranean exclusion).
 */

import {
  DJ_INTENT_LOCAL_GROUP_DEFINITIONS,
  getDjIntentLocalGroupDefinition,
  type DjIntentLocalGroupDefinition,
  type DjIntentLocalGroupId,
} from "@/lib/dj-intent-dictionary";
import type { LocalSearchIntentParse } from "@/lib/local-ai-playlist-search";

/**
 * Resolved exclusion bundle: the sibling groups that should be REJECTED for
 * this prompt, plus pre-computed normalized taxonomy slugs and local field
 * search terms used by the catalog/local filters.
 */
export type SiblingExclusionBundle = {
  /** Sibling group ids that the active intents instruct us to exclude. */
  excludedGroupIds: DjIntentLocalGroupId[];
  /** Lower-cased taxonomy + vendor taxonomy slugs that mark a row as belonging to an excluded sibling. */
  excludedTaxonomySlugSet: Set<string>;
  /** Lower-cased substring terms (genre/comment/path/title/artist/album) that mark a local row as belonging to an excluded sibling. */
  excludedLocalTerms: string[];
  /** Per-group definitions (for diagnostics / labels). */
  excludedGroupDefs: DjIntentLocalGroupDefinition[];
};

const EMPTY_BUNDLE: SiblingExclusionBundle = {
  excludedGroupIds: [],
  excludedTaxonomySlugSet: new Set(),
  excludedLocalTerms: [],
  excludedGroupDefs: [],
};

function lower(s: string | null | undefined): string {
  return (s ?? "").toLowerCase();
}

/**
 * Build the exclusion bundle from a parsed-intents result.
 *
 * Returns the empty bundle (no exclusions) when no active group declares
 * `excludesGroupsWhenAbsent` OR all declared siblings are themselves active.
 */
export function buildSiblingExclusionBundle(
  intents: LocalSearchIntentParse | null,
): SiblingExclusionBundle {
  if (!intents) return EMPTY_BUNDLE;
  const activeIds = new Set<string>(intents.groups.map((g) => g.id).filter((id) => id !== "general"));
  if (activeIds.size === 0) return EMPTY_BUNDLE;

  const excludedSet = new Set<DjIntentLocalGroupId>();
  for (const group of intents.groups) {
    if (group.id === "general") continue;
    const def = getDjIntentLocalGroupDefinition(group.id as DjIntentLocalGroupId);
    if (!def?.excludesGroupsWhenAbsent?.length) continue;
    for (const siblingId of def.excludesGroupsWhenAbsent) {
      if (activeIds.has(siblingId)) continue;
      excludedSet.add(siblingId);
    }
  }

  if (excludedSet.size === 0) return EMPTY_BUNDLE;

  const excludedGroupIds = [...excludedSet];
  const excludedGroupDefs: DjIntentLocalGroupDefinition[] = [];
  const taxonomySet = new Set<string>();
  const termSet = new Set<string>();
  for (const id of excludedGroupIds) {
    const def = DJ_INTENT_LOCAL_GROUP_DEFINITIONS.find((g) => g.id === id);
    if (!def) continue;
    excludedGroupDefs.push(def);
    for (const slug of def.taxonomySlugs) {
      const v = lower(slug).trim();
      if (v) taxonomySet.add(v);
    }
    for (const slug of def.vendorTaxonomySlugs ?? []) {
      const v = lower(slug).trim();
      if (v) taxonomySet.add(v);
    }
    for (const term of def.localSearchTerms) {
      const v = lower(term).trim();
      if (v) termSet.add(v);
    }
  }

  return {
    excludedGroupIds,
    excludedTaxonomySlugSet: taxonomySet,
    excludedLocalTerms: [...termSet],
    excludedGroupDefs,
  };
}

/**
 * Catalog filter: return TRUE when the row should be REJECTED because its
 * taxonomy intersects an excluded sibling group. Empty bundle never rejects.
 */
export function catalogRowMatchesExcludedSibling(
  row: { taxonomySlugs?: string[]; matchedTags?: string[] },
  bundle: SiblingExclusionBundle,
): boolean {
  if (bundle.excludedTaxonomySlugSet.size === 0) return false;
  const tags = [...(row.taxonomySlugs ?? []), ...(row.matchedTags ?? [])];
  for (const tag of tags) {
    const v = lower(tag).trim();
    if (v && bundle.excludedTaxonomySlugSet.has(v)) return true;
  }
  return false;
}

/**
 * Local filter: return TRUE when the candidate's text fields contain any term
 * from an excluded sibling group's `localSearchTerms`. Uses simple substring
 * matching with Latin word-boundary safety only for path segments (so that
 * "Jazzanova" does NOT match the term "jazz" — we already rely on the local
 * strict floor for path discipline, and the path is included for plain
 * `genre:"Israeli Mizrahi"`-style ID3 evidence).
 *
 * Hebrew terms are matched as plain substrings (Hebrew lacks Latin-style word
 * boundaries; the surrounding intent strictness gate keeps false positives low).
 */
export function localCandidateMatchesExcludedSibling(
  candidate: {
    absolutePath?: string;
    genre?: string | null;
    comment?: string | null;
    title?: string | null;
    artist?: string | null;
    album?: string | null;
  },
  bundle: SiblingExclusionBundle,
): boolean {
  if (bundle.excludedLocalTerms.length === 0) return false;
  // Every text field is checked with word-boundary semantics for Latin terms
  // (so artist="Jazzanova" or title="Jazztown" does NOT match the term "jazz"),
  // and substring semantics for non-Latin (Hebrew) terms.
  const fields = [
    candidate.genre,
    candidate.comment,
    candidate.artist,
    candidate.album,
    candidate.title,
    candidate.absolutePath,
  ]
    .map((s) => lower(s))
    .filter((s) => s.length > 0);
  if (fields.length === 0) return false;

  for (const term of bundle.excludedLocalTerms) {
    if (!term) continue;
    const isLatin = /^[a-z0-9 \-]+$/.test(term);
    if (isLatin) {
      const re = new RegExp(`(^|[^a-z0-9])${escapeForRegex(term)}([^a-z0-9]|$)`);
      for (const field of fields) {
        if (re.test(field)) return true;
      }
    } else {
      for (const field of fields) {
        if (field.includes(term)) return true;
      }
    }
  }
  return false;
}

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
