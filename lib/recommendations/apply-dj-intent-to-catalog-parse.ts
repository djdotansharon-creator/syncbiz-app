/**
 * Applies taxonomy-aligned DJ Intent Dictionary signals to smart catalog parse draft.
 * Adds MusicTaxonomyTag slugs (core only) — URL catalog source of truth.
 * PHRASE_MAP runs first; this pass merges dictionary slugs without removing specifics.
 */

import {
  getProductDjIntentSignals,
  type DjIntentSignal,
  type DjIntentSignalCategory,
} from "@/lib/dj-intent-dictionary";
import type { BusinessType, WorkspaceEnergyLevel } from "@prisma/client";
import type { DaypartSegment } from "@/lib/recommendations/business-daypart-vibe.types";
import type { DaypartSlug } from "@/lib/recommendations/fit-rules.types";
import { normalizeSmartQueryText } from "@/lib/recommendations/smart-query-text";

type CatalogParseDraft = {
  businessType: BusinessType | null;
  coarseDaypart: DaypartSlug | null;
  vibeSegment: DaypartSegment | null;
  moodHints: Set<string>;
  energyHint: WorkspaceEnergyLevel | null;
  styleTaxonomySlugs: Set<string>;
  audienceHints: Set<string>;
  conceptTags: Set<string>;
  matchedPhrases: Set<string>;
};

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Hebrew / multi-word → substring; Latin tokens → word boundary when unambiguous. */
export function djIntentAliasMatchesQuery(normalized: string, alias: string): boolean {
  const p = normalizeSmartQueryText(alias);
  if (p.length < 2) return false;
  if (/[\u0590-\u05ff]/.test(p) || p.includes(" ")) {
    return normalized.includes(p);
  }
  if (/^\d/.test(p) || p.endsWith("s")) {
    return normalized.includes(p);
  }
  return new RegExp(`(?:^|\\s)${escapeRegex(p)}(?:\\s|$)`).test(normalized);
}

type SignalApplyHelpers = {
  setBusiness: (b: BusinessType, phrase: string) => void;
  setCoarseDaypart: (p: DaypartSlug, phrase: string) => void;
  setVibeSegment: (s: DaypartSegment, phrase: string) => void;
  addMoods: (moods: string[], phrase: string) => void;
  addSlugs: (slugs: string[], phrase: string) => void;
  setEnergy: (e: WorkspaceEnergyLevel, phrase: string) => void;
  addAudience: (a: string[], phrase: string) => void;
};

function applySignalExtras(signal: DjIntentSignal, phrase: string, h: SignalApplyHelpers): void {
  h.addSlugs(signal.taxonomySlugs, phrase);

  switch (signal.id) {
    case "mood.easy":
      h.setEnergy("LOW", phrase);
      h.addMoods(["calm", "chill", "mellow", "relaxing"], phrase);
      break;
    case "mood.high_energy":
      h.setEnergy("HIGH", phrase);
      h.addMoods(["energy", "upbeat"], phrase);
      break;
    case "mood.premium":
      h.addMoods(["elegant", "premium", "luxury", "sophisticated"], phrase);
      break;
    case "business.restaurant":
      h.setBusiness("RESTAURANT", phrase);
      break;
    case "business.cafe":
      h.setBusiness("CAFE", phrase);
      break;
    case "business.hotel":
      h.setBusiness("HOTEL", phrase);
      break;
    case "daypart.lunch":
      h.setCoarseDaypart("lunch", phrase);
      h.setVibeSegment("lunch", phrase);
      break;
    case "daypart.dinner":
      h.setCoarseDaypart("dinner", phrase);
      h.setVibeSegment("evening", phrase);
      break;
    case "quality.background":
      h.addMoods(["background", "lounge"], phrase);
      break;
    default:
      break;
  }
}

function sortedProductSignals(): DjIntentSignal[] {
  return [...getProductDjIntentSignals()].sort((a, b) => {
    const la = Math.max(...a.aliases.map((x) => normalizeSmartQueryText(x).length));
    const lb = Math.max(...b.aliases.map((x) => normalizeSmartQueryText(x).length));
    return lb - la;
  });
}

/**
 * Merge DJ Intent Dictionary taxonomy slugs (+ safe mood/energy/business hints) into catalog parse draft.
 * Core taxonomySlugs only — no PlaylistPro vendor enrichment slugs in URL catalog parse.
 */
export function applyDjIntentDictionaryToCatalogDraft(
  normalized: string,
  d: CatalogParseDraft,
  helpers: SignalApplyHelpers,
): void {
  if (normalized.length < 1) return;

  const matchedSignalIds = new Set<string>();

  for (const signal of sortedProductSignals()) {
    if (matchedSignalIds.has(signal.id)) continue;

    for (const alias of [...signal.aliases].sort(
      (a, b) => normalizeSmartQueryText(b).length - normalizeSmartQueryText(a).length,
    )) {
      if (!djIntentAliasMatchesQuery(normalized, alias)) continue;
      matchedSignalIds.add(signal.id);
      applySignalExtras(signal, alias, helpers);
      break;
    }
  }
}

export function listDjIntentCatalogSignalCategories(): DjIntentSignalCategory[] {
  return [...new Set(getProductDjIntentSignals().map((s) => s.category))];
}
