/**
 * DJ Creator V1 — builds catalog search `q` without claiming extra “understanding”.
 * Free text is appended only when the deterministic parser extracts more signals than the wizard-only query.
 */

import type { ParsedSmartCatalogQuery } from "@/lib/recommendations/parse-smart-catalog-query";
import { parseSmartCatalogQuery } from "@/lib/recommendations/parse-smart-catalog-query";

function parseSignalWeight(p: ParsedSmartCatalogQuery): number {
  return (
    p.matchedPhrases.length * 2 +
    p.styleTaxonomySlugs.length * 3 +
    p.moodHints.length +
    p.conceptTags.length +
    p.audienceHints.length +
    (p.businessType ? 4 : 0) +
    (p.energyHint ? 2 : 0) +
    (p.vibeSegment ? 1 : 0)
  );
}

/**
 * When true, include `freeText` in the catalog `q` string. Otherwise keep it for naming + editor requests only.
 */
export function shouldAppendFreeTextToDjCreatorCatalogQuery(
  freeText: string,
  wizardQueryWithoutFreeText: string,
): boolean {
  const ft = freeText.trim();
  if (ft.length < 2) return false;
  const base = wizardQueryWithoutFreeText.trim();
  if (base.length < 1) return true;
  const pBase = parseSmartCatalogQuery(base);
  const pFull = parseSmartCatalogQuery(`${base} ${ft}`.trim());
  return parseSignalWeight(pFull) > parseSignalWeight(pBase);
}
