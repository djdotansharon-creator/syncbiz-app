/**
 * Stage 5.6 — deterministic tag hints for catalog tagging workbench (admin approval only).
 * Not AI; rules-only + dictionary substring checks.
 */

import type { TagPack, TagPackEnergyBand } from "@/lib/recommendations/tag-packs.types";

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
  /** Snapshot description, hashtags, channel title, etc. — suggestions only. */
  extraHaystackParts?: readonly string[];
};

export type CatalogTagSuggestion = {
  taxonomyTagId: string;
  slug: string;
  labelEn: string;
  reason: string;
  /** When true, workbench seeds this id into pending once per item load (never auto-saved). */
  preselectPending?: boolean;
};

/** Human-readable language / vocal cues for admin banner (no customer PII). */
export type CatalogLanguageSignal = {
  label: string;
  slugHints: readonly string[];
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
    triggers: ["chill", "relax", "relaxing", "calm", "quiet", "peaceful"],
    slugHints: ["chill-mellow", "lounge", "cafe", "quiet-morning"],
  },
  {
    triggers: ["romantic", "romance"],
    slugHints: ["chill-mellow", "lounge", "quiet-morning", "biz-spa-wellness", "playback-context-spa-quiet"],
  },
  { triggers: ["morning"], slugHints: ["morning", "quiet-morning", "cafe"] },
  { triggers: ["dinner"], slugHints: ["dinner", "restaurant", "lounge"] },
  { triggers: ["cafe", "coffee shop"], slugHints: ["cafe", "morning", "lounge"] },
  { triggers: ["hotel", "lobby"], slugHints: ["hotel", "lounge", "playback-context-lobby-welcome"] },
  { triggers: ["restaurant"], slugHints: ["restaurant", "dinner", "lounge", "cafe"] },
  { triggers: ["spa"], slugHints: ["biz-spa-wellness", "playback-context-spa-quiet"] },
];

function buildHaystack(
  title: string,
  url: string,
  provider: string | null,
  playlistHints: readonly string[],
  extraHaystackParts?: readonly string[],
): string {
  return [title, url, provider ?? "", ...playlistHints, ...(extraHaystackParts ?? [])].join(" ").toLowerCase();
}

const HEBREW_SCRIPT_RE = /[\u0590-\u05FF]/;

/**
 * Surfaces Hebrew / English / instrumental / mixed-language cues for the workbench banner and slug hints.
 * Slugs are resolved against the dictionary inside computeCatalogTagSuggestions.
 */
export function inferCatalogLanguageSignals(rawHaystack: string): CatalogLanguageSignal[] {
  const hay = rawHaystack.toLowerCase();
  const scriptHay = rawHaystack;
  const out: CatalogLanguageSignal[] = [];

  const hebrewScript = HEBREW_SCRIPT_RE.test(scriptHay);
  const hebrewCue =
    /\b(hebrew|israeli lyrics|עברית|בעברית|שירים בעברית|דיבור בעברית)\b/i.test(hay) || hebrewScript;
  if (hebrewCue) {
    out.push({
      label: hebrewScript ? "Hebrew script in metadata" : "Hebrew / Israeli lyrics (text cue)",
      slugHints: ["il-hebrew-lyrics-only", "il-traditional-hebrew-song", "il-israeli-pop", "il-mixed-languages-radio"],
    });
  }

  if (
    /\b(english lyrics|english songs|english only|anglais|באנגלית)\b/i.test(hay)
  ) {
    out.push({
      label: "English (text cue)",
      slugHints: ["il-mixed-languages-radio"],
    });
  }

  if (/\b(international|world music|multilingual|mixed language)\b/i.test(hay)) {
    out.push({
      label: "International / mixed-language (text cue)",
      slugHints: ["il-mixed-languages-radio"],
    });
  }

  if (
    /\b(instrumental|inst\.|no vocal|non-vocal|karaoke backing|backing track)\b/i.test(hay) ||
    /\b(no lyrics|sans paroles)\b/i.test(hay)
  ) {
    out.push({
      label: "Likely instrumental / low vocal prominence (text cue)",
      slugHints: ["instrumental", "tech-instrumental-only", "style-instrumental-forward"],
    });
  }

  return out;
}

function slugParts(slug: string): string[] {
  return slug.split("-").filter((p) => p.length >= 2);
}

/**
 * Word-boundary containment — the term must appear as a whole word, not as a
 * substring inside another word. Fixes false positives like the alias "oud"
 * (from "Arabic Lounge") matching inside loud / cloud / would / could / proud,
 * which was wrongly pre-selecting Arabic tags on unrelated tracks. Unicode-aware
 * so Hebrew/Latin both work.
 */
function haystackHasWord(hay: string, term: string): boolean {
  const t = term.trim().toLowerCase();
  if (t.length < 2) return false;
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  try {
    return new RegExp(`(^|[^\\p{L}\\p{N}])${esc}([^\\p{L}\\p{N}]|$)`, "u").test(hay);
  } catch {
    return hay.includes(t);
  }
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
  if (slugSpaced.length >= 3 && haystackHasWord(hay, slugSpaced)) {
    return { match: true, reason: `matched title/URL text for slug “${tag.slug}”` };
  }

  const parts = slugParts(tag.slug).filter((p) => p.length >= 4);
  if (parts.length >= 1 && parts.every((p) => haystackHasWord(hay, p))) {
    return { match: true, reason: `matched slug fragments: ${tag.slug}` };
  }

  const enWords = tag.labelEn
    .split(/[^\p{L}\p{N}]+/u)
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w.length >= 3);
  for (const w of enWords) {
    if (haystackHasWord(hay, w)) {
      return { match: true, reason: `matched label word “${w}” (${tag.slug})` };
    }
  }

  for (const a of tag.aliases ?? []) {
    const al = a.trim().toLowerCase();
    if (al.length >= 3 && haystackHasWord(hay, al)) {
      return { match: true, reason: `matched alias “${a}” (${tag.slug})` };
    }
  }

  const he = tag.labelHe.trim();
  if (he.length >= 2 && haystackHasWord(hay, he)) {
    return { match: true, reason: `matched Hebrew label (${tag.slug})` };
  }

  return { match: false };
}

/**
 * Ordered suggestions: keyword cues first, then dictionary-derived matches (stable order).
 */
export function computeCatalogTagSuggestions(input: CatalogTagSuggestionInput): CatalogTagSuggestion[] {
  const hay = buildHaystack(input.title, input.url, input.provider, input.playlistHints, input.extraHaystackParts);
  const slugIndex = new Map<string, CatalogTagSuggestionDictionaryRow>();
  for (const t of input.dictionary) {
    slugIndex.set(t.slug, t);
  }

  const seen = new Set<string>();
  const out: CatalogTagSuggestion[] = [];

  function pushTag(tag: CatalogTagSuggestionDictionaryRow, reason: string, preselectPending?: boolean) {
    if (input.assignedIds.has(tag.id) || seen.has(tag.id)) return;
    seen.add(tag.id);
    out.push({
      taxonomyTagId: tag.id,
      slug: tag.slug,
      labelEn: tag.labelEn,
      reason,
      preselectPending,
    });
  }

  for (const sig of inferCatalogLanguageSignals(
    [input.title, input.url, input.provider ?? "", ...input.playlistHints, ...(input.extraHaystackParts ?? [])].join(
      " ",
    ),
  )) {
    for (const slug of sig.slugHints) {
      const tag = slugIndex.get(slug);
      if (!tag) continue;
      pushTag(tag, `language / vocal cue — ${sig.label}`, true);
    }
  }

  for (const rule of KEYWORD_RULES) {
    const triggerHit = rule.triggers.find((tr) => hay.includes(tr.toLowerCase()));
    if (!triggerHit) continue;
    for (const slug of rule.slugHints) {
      const tag = slugIndex.get(slug);
      if (!tag) continue;
      pushTag(tag, `matched cue “${triggerHit}”`, true);
    }
  }

  for (const tag of input.dictionary) {
    if (input.assignedIds.has(tag.id) || seen.has(tag.id)) continue;

    const direct = tagMatchesHaystack(tag, hay);
    if (direct.match && direct.reason) {
      const strong =
        direct.reason.includes("matched alias") ||
        direct.reason.includes("matched Hebrew label") ||
        direct.reason.includes("matched title/URL text for slug");
      pushTag(tag, direct.reason, strong);
    }
  }

  return out;
}

// ─── Related-tag suggestions from CURATED TAG PACKS (pick-driven) ──────────────
// When the admin picks a genre/style tag, surface the cross-dimension tags that
// usually go with it (business fit / daypart / energy), honoring the pack's
// avoidTagSlugs. Pure + client-safe; nothing is auto-saved — these become one-click
// chips that call the existing togglePending path.

export type RelatedTagSuggestionInput = {
  /** Slugs currently linked or pending (the admin's picks). */
  pickedSlugs: readonly string[];
  dictionary: readonly CatalogTagSuggestionDictionaryRow[];
  packs: readonly TagPack[];
  /** Tag ids already linked or pending — excluded from suggestions. */
  excludeIds: ReadonlySet<string>;
};

/**
 * For every pack whose seed intersects the picks, emit its related slugs (that exist
 * in the ACTIVE dictionary, aren't already picked/excluded, and aren't in any matched
 * pack's avoidTagSlugs) as CatalogTagSuggestion chips.
 */
export function computeRelatedTagSuggestions(input: RelatedTagSuggestionInput): CatalogTagSuggestion[] {
  const picked = new Set(input.pickedSlugs);
  if (picked.size === 0) return [];

  const bySlug = new Map<string, CatalogTagSuggestionDictionaryRow>();
  for (const t of input.dictionary) bySlug.set(t.slug, t);

  const avoid = new Set<string>();
  const relatedReason = new Map<string, string>(); // slug -> reason
  for (const pack of input.packs) {
    if (pack.isActive === false) continue;
    const matchedSeed = pack.seedTagSlugs.find((s) => picked.has(s));
    if (!matchedSeed) continue;
    for (const a of pack.avoidTagSlugs) avoid.add(a);
    for (const rel of pack.relatedTagSlugs) {
      if (picked.has(rel)) continue;
      if (!relatedReason.has(rel)) relatedReason.set(rel, `goes with ${matchedSeed}`);
    }
  }

  const out: CatalogTagSuggestion[] = [];
  const seen = new Set<string>();
  for (const [slug, reason] of relatedReason) {
    if (avoid.has(slug)) continue; // never push a tag a matched pack says to avoid
    const tag = bySlug.get(slug);
    if (!tag) continue; // slug not in ACTIVE dictionary → skip (no dead chips)
    if (input.excludeIds.has(tag.id) || seen.has(tag.id)) continue;
    seen.add(tag.id);
    out.push({ taxonomyTagId: tag.id, slug: tag.slug, labelEn: tag.labelEn, reason });
  }
  return out;
}

/** Strongest suggested energy band across the packs matching the current picks (for the
 *  manualEnergyRating nudge). HIGH wins over MEDIUM over LOW when packs disagree. */
export function suggestedEnergyBandForPicks(
  pickedSlugs: readonly string[],
  packs: readonly TagPack[],
): TagPackEnergyBand | null {
  const picked = new Set(pickedSlugs);
  const rank: Record<TagPackEnergyBand, number> = { LOW: 1, MEDIUM: 2, HIGH: 3 };
  let best: TagPackEnergyBand | null = null;
  for (const pack of packs) {
    if (pack.isActive === false || !pack.suggestEnergyBand) continue;
    if (!pack.seedTagSlugs.some((s) => picked.has(s))) continue;
    if (!best || rank[pack.suggestEnergyBand] > rank[best]) best = pack.suggestEnergyBand;
  }
  return best;
}
