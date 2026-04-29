/**
 * Stage 5.6 — deterministic tag hints for catalog tagging workbench (admin approval only).
 * Not AI; rules-only + dictionary substring checks.
 */

export type CatalogTagSuggestionDictionaryRow = {
  id: string;
  slug: string;
  labelEn: string;
  labelHe: string;
  aliases: readonly string[];
};

export type CatalogTagSuggestionInput = {
  dictionary: readonly CatalogTagSuggestionDictionaryRow[];
  assignedIds: ReadonlySet<string>;
  title: string;
  url: string;
  provider: string | null;
  playlistHints: readonly string[];
};

export type CatalogTagSuggestion = {
  taxonomyTagId: string;
  slug: string;
  labelEn: string;
  reason: string;
};

/** Cue tokens in title/URL/context → candidate slugs (skip if slug not in dictionary). */
const KEYWORD_RULES: readonly {
  triggers: readonly string[];
  slugHints: readonly string[];
}[] = [
  { triggers: ["jazz"], slugHints: ["jazz", "smooth-jazz", "lounge"] },
  { triggers: ["bossa", "bossa nova"], slugHints: ["bossa-nova", "cafe", "restaurant"] },
  { triggers: ["italian"], slugHints: ["italian-classics", "restaurant", "dinner"] },
  { triggers: ["mediterranean"], slugHints: ["mediterranean-pop", "restaurant", "cafe"] },
  {
    triggers: ["gym", "workout"],
    slugHints: ["gym", "high-energy"],
  },
  { triggers: ["lounge"], slugHints: ["lounge", "hotel", "cafe", "restaurant"] },
  {
    triggers: ["chill", "relax", "relaxing"],
    slugHints: ["chill-mellow", "lounge", "cafe"],
  },
  { triggers: ["morning"], slugHints: ["morning", "quiet-morning", "cafe"] },
  { triggers: ["dinner"], slugHints: ["dinner", "restaurant", "lounge"] },
];

function buildHaystack(title: string, url: string, provider: string | null, playlistHints: readonly string[]): string {
  return [title, url, provider ?? "", ...playlistHints].join(" ").toLowerCase();
}

function slugParts(slug: string): string[] {
  return slug.split("-").filter((p) => p.length >= 2);
}

/** Exported for Stage 5.9 metadata-derived taxonomy hints (same matching rules). */
export function matchTaxonomyDictionaryTagAgainstHaystack(
  tag: CatalogTagSuggestionDictionaryRow,
  hayLowercase: string,
): { match: boolean; reason?: string } {
  return tagMatchesHaystack(tag, hayLowercase);
}

function tagMatchesHaystack(tag: CatalogTagSuggestionDictionaryRow, hay: string): { match: boolean; reason?: string } {
  const slugSpaced = tag.slug.replace(/-/g, " ");
  if (slugSpaced.length >= 3 && hay.includes(slugSpaced)) {
    return { match: true, reason: `matched title/URL text for slug “${tag.slug}”` };
  }

  const parts = slugParts(tag.slug).filter((p) => p.length >= 4);
  if (parts.length >= 1 && parts.every((p) => hay.includes(p))) {
    return { match: true, reason: `matched slug fragments: ${tag.slug}` };
  }

  const enWords = tag.labelEn
    .split(/[^\p{L}\p{N}]+/u)
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w.length >= 3);
  for (const w of enWords) {
    if (hay.includes(w)) {
      return { match: true, reason: `matched label word “${w}” (${tag.slug})` };
    }
  }

  for (const a of tag.aliases ?? []) {
    const al = a.trim().toLowerCase();
    if (al.length >= 3 && hay.includes(al)) {
      return { match: true, reason: `matched alias “${a}” (${tag.slug})` };
    }
  }

  const he = tag.labelHe.trim();
  if (he.length >= 2 && hay.includes(he)) {
    return { match: true, reason: `matched Hebrew label (${tag.slug})` };
  }

  return { match: false };
}

/**
 * Ordered suggestions: keyword cues first, then dictionary-derived matches (stable order).
 */
export function computeCatalogTagSuggestions(input: CatalogTagSuggestionInput): CatalogTagSuggestion[] {
  const hay = buildHaystack(input.title, input.url, input.provider, input.playlistHints);
  const slugIndex = new Map<string, CatalogTagSuggestionDictionaryRow>();
  for (const t of input.dictionary) {
    slugIndex.set(t.slug, t);
  }

  const seen = new Set<string>();
  const out: CatalogTagSuggestion[] = [];

  function pushTag(tag: CatalogTagSuggestionDictionaryRow, reason: string) {
    if (input.assignedIds.has(tag.id) || seen.has(tag.id)) return;
    seen.add(tag.id);
    out.push({
      taxonomyTagId: tag.id,
      slug: tag.slug,
      labelEn: tag.labelEn,
      reason,
    });
  }

  for (const rule of KEYWORD_RULES) {
    const triggerHit = rule.triggers.find((tr) => hay.includes(tr.toLowerCase()));
    if (!triggerHit) continue;
    for (const slug of rule.slugHints) {
      const tag = slugIndex.get(slug);
      if (!tag) continue;
      pushTag(tag, `matched cue “${triggerHit}”`);
    }
  }

  for (const tag of input.dictionary) {
    if (input.assignedIds.has(tag.id) || seen.has(tag.id)) continue;

    const direct = tagMatchesHaystack(tag, hay);
    if (direct.match && direct.reason) {
      pushTag(tag, direct.reason);
    }
  }

  return out;
}
