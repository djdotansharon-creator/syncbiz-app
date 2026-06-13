/** Shared normalization for smart catalog + DJ intent catalog parse (ASCII lower, whitespace). */

function lowerAscii(s: string): string {
  return s.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/** Lowercase ASCII; keep Hebrew and other scripts as-is; collapse whitespace. */
export function normalizeSmartQueryText(raw: string): string {
  const t = raw.trim().replace(/\s+/g, " ");
  return lowerAscii(t);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * True when `token` appears as its own space-delimited word in a normalized smart query.
 */
export function smartQueryHasStandaloneToken(normalized: string, token: string): boolean {
  const t = normalizeSmartQueryText(token);
  if (!t) return false;
  return new RegExp(`(?:^|\\s)${escapeRegex(t)}(?:\\s|$)`).test(normalized);
}

/**
 * PHRASE_MAP / catalog phrase matching.
 * - Multi-word phrases: substring (e.g. "ליד הים", "ים תיכוני" via dictionary).
 * - Single-word phrases: standalone token only — avoids "ים" inside "מובחרים".
 * - Bare "ים" (sea): exact query only — avoids "ים תיכוני" Mediterranean false positive.
 */
export function smartQueryPhraseMatches(normalized: string, phrase: string): boolean {
  const p = normalizeSmartQueryText(phrase);
  if (p.length < 2) return false;

  if (p === "ים") {
    return normalized === "ים";
  }

  if (p.includes(" ")) {
    return normalized.includes(p);
  }

  return smartQueryHasStandaloneToken(normalized, p);
}