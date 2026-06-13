/**
 * Validates DJ Intent Dictionary taxonomy slug references against seed JSON.
 */

import {
  DJ_INTENT_COMMENT_TAG_TAXONOMY,
  DJ_INTENT_LOCAL_GROUP_DEFINITIONS,
  DJ_INTENT_SIGNALS,
} from "@/lib/dj-intent-dictionary";
import { getKnownMusicTaxonomySlugSet } from "@/lib/dj-intent-taxonomy-slugs";

export type DjIntentTaxonomyValidationResult = {
  ok: boolean;
  missingSlugs: string[];
  referencedCount: number;
};

function collectReferencedSlugs(): string[] {
  const out: string[] = [];
  for (const s of DJ_INTENT_SIGNALS) {
    if (s.operatorOnly) continue;
    out.push(...s.taxonomySlugs, ...(s.vendorTaxonomySlugs ?? []));
  }
  for (const g of DJ_INTENT_LOCAL_GROUP_DEFINITIONS) {
    out.push(...g.taxonomySlugs, ...(g.vendorTaxonomySlugs ?? []));
  }
  for (const m of Object.values(DJ_INTENT_COMMENT_TAG_TAXONOMY)) {
    if (m.operatorOnly) continue;
    out.push(...m.taxonomySlugs);
  }
  return out;
}

export function validateDjIntentDictionaryTaxonomySlugs(): DjIntentTaxonomyValidationResult {
  const known = getKnownMusicTaxonomySlugSet();
  const referenced = collectReferencedSlugs();
  const missingSlugs = [...new Set(referenced.filter((slug) => slug.length > 0 && !known.has(slug)))].sort();
  return {
    ok: missingSlugs.length === 0,
    missingSlugs,
    referencedCount: referenced.length,
  };
}
