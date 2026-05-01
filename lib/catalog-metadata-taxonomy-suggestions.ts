/**
 * Stage 5.9 — match provider snapshot text/tags against ACTIVE MusicTaxonomyTag rows (suggestions only).
 */

import type {
  CatalogTagSuggestion,
  CatalogTagSuggestionDictionaryRow,
} from "@/lib/catalog-tagging-suggestions";
import { matchTaxonomyDictionaryTagAgainstHaystack } from "@/lib/catalog-tagging-suggestions";

export type MetadataTaxonomySuggestionInput = {
  dictionary: readonly CatalogTagSuggestionDictionaryRow[];
  assignedIds: ReadonlySet<string>;
  title: string | null | undefined;
  description: string | null | undefined;
  hashtags: readonly string[];
  sourceTags: readonly string[];
};

export type MetadataTaxonomySuggestionsResult = {
  suggestions: CatalogTagSuggestion[];
  unknownCues: string[];
};

function buildMetadataHaystack(input: MetadataTaxonomySuggestionInput): string {
  return [
    input.title ?? "",
    input.description ?? "",
    ...(input.hashtags ?? []),
    ...(input.sourceTags ?? []),
  ]
    .join(" ")
    .toLowerCase();
}

function normalizeCueToken(raw: string): string {
  return raw.trim().replace(/^#+/u, "").trim().toLowerCase();
}

/**
 * Deterministic dictionary matches against snapshot-only haystack (no URL/title keyword rules).
 */
export function computeMetadataTaxonomySuggestions(
  input: MetadataTaxonomySuggestionInput,
): MetadataTaxonomySuggestionsResult {
  const hay = buildMetadataHaystack(input);
  const suggestions: CatalogTagSuggestion[] = [];
  const seen = new Set<string>();

  for (const tag of input.dictionary) {
    if (input.assignedIds.has(tag.id) || seen.has(tag.id)) continue;
    const direct = matchTaxonomyDictionaryTagAgainstHaystack(tag, hay);
    if (direct.match && direct.reason) {
      seen.add(tag.id);
      const preselectPending =
        direct.reason.includes("matched alias") ||
        direct.reason.includes("matched Hebrew label") ||
        direct.reason.includes("matched title/URL text for slug");
      suggestions.push({
        taxonomyTagId: tag.id,
        slug: tag.slug,
        labelEn: tag.labelEn,
        reason: `source metadata — ${direct.reason}`,
        preselectPending,
      });
    }
  }

  const unknownCues = computeUnknownMetadataCues(
    input.dictionary,
    input.hashtags,
    input.sourceTags,
  );
  return { suggestions, unknownCues };
}

/** Hashtag/source strings that did not individually match any dictionary tag using the same matcher. */
export function computeUnknownMetadataCues(
  dictionary: readonly CatalogTagSuggestionDictionaryRow[],
  hashtags: readonly string[],
  sourceTags: readonly string[],
): string[] {
  const cues = [...hashtags, ...sourceTags].map((s) => s.trim()).filter((s) => s.length >= 1);
  const unknown: string[] = [];
  const seenKey = new Set<string>();

  for (const raw of cues) {
    const nk = normalizeCueToken(raw);
    if (nk.length < 2) continue;
    if (seenKey.has(nk)) continue;
    seenKey.add(nk);

    const paddedHay = ` ${nk} `;
    let mapped = false;
    for (const tag of dictionary) {
      const m = matchTaxonomyDictionaryTagAgainstHaystack(tag, paddedHay);
      if (m.match) {
        mapped = true;
        break;
      }
    }
    if (!mapped) unknown.push(raw);
  }

  return unknown;
}
