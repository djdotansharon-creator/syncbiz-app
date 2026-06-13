/**
 * Shared local MP3 snapshot search helpers (Desktop main + Next.js ai-build merge).
 * Snapshot rows are searched across ID3 fields, filename, folder path, and metadata bank imports.
 * Multi-intent queries (e.g. "ים תיכוני רגוע") require matches across intent groups — not one broad alias.
 */

import {
  DJ_INTENT_LOCAL_GROUP_DEFINITIONS,
  DJ_INTENT_MEDITERRANEAN_PHRASE_BOOST_TERMS,
  DJ_INTENT_TOKEN_EXPANSIONS,
  getDjIntentLocalGroupHaystackTerms,
  type DjIntentLocalGroupId,
} from "./dj-intent-dictionary";

export type LocalAiSearchTrackFields = {
  artist: string | null;
  title: string | null;
  album: string | null;
  genre: string | null;
  year: string | null;
  comment: string | null;
  bpm: number | null;
  rating: number | null;
  trackNumber?: string | null;
  durationSec?: number | null;
  relativePathFromRoot: string;
  absolutePath: string;
};

export type LocalSearchIntentGroupId = DjIntentLocalGroupId;

export type LocalSearchIntentGroup = {
  id: LocalSearchIntentGroupId;
  label: string;
  terms: string[];
};

export type LocalSearchGroupMatch = {
  groupId: LocalSearchIntentGroupId;
  label: string;
  matched: boolean;
  matchedTerms: string[];
  matchedFields: string[];
};

export type LocalSearchIntentParse = {
  groups: LocalSearchIntentGroup[];
  phrase: string;
  tokens: string[];
};

export type LocalSearchScoreResult = {
  score: number;
  groupsMatched: number;
  groupsTotal: number;
  fullMatch: boolean;
  groupMatches: LocalSearchGroupMatch[];
  reason: string;
};

export type LocalAiSearchMatchDebug = {
  groupsMatched: number;
  groupsTotal: number;
  fullMatch: boolean;
  score: number;
  reason: string;
  groups: Array<{
    label: string;
    matched: boolean;
    terms: string[];
    fields: string[];
  }>;
};

/** NFC, strip niqqud/cantillation, fold Hebrew final forms, lowercase Latin. */
export function normalizeLocalSearchText(raw: string): string {
  return (raw ?? "")
    .normalize("NFC")
    .replace(/[\u0591-\u05C7]/g, "")
    .replace(/[\u05BE\u05F3\u05F4'"]/g, " ")
    .toLowerCase()
    .replace(/\u05da/g, "\u05db")
    .replace(/\u05dd/g, "\u05de")
    .replace(/\u05df/g, "\u05e0")
    .replace(/\u05e3/g, "\u05e4")
    .replace(/\u05e5/g, "\u05e6")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTokenEdges(w: string): string {
  return w.replace(/^[^a-z0-9\u0590-\u05ff]+|[^a-z0-9\u0590-\u05ff]+$/gi, "");
}

function tokenMinLength(token: string): number {
  if (/^20\d{2}$/.test(token)) return 4;
  if (/^19\d{2}$/.test(token)) return 4;
  if (/[\u0590-\u05ff]/.test(token)) return 2;
  return 2;
}

function expandDecadeTokens(part: string, bag: Set<string>): void {
  const m80 = part.match(/^שנות[\s-]*ה?[\s-]*?(80|שמונים)$/);
  if (m80) {
    bag.add("1980");
    bag.add("1980s");
    bag.add("80s");
  }
  const m70 = part.match(/^שנות[\s-]*ה?[\s-]*?(70|שבעים)$/);
  if (m70) {
    bag.add("1970");
    bag.add("1970s");
    bag.add("70s");
  }
}

function phraseIncludesAny(phrase: string, needles: string[]): boolean {
  for (const n of needles) {
    const t = normalizeLocalSearchText(n);
    if (t.length >= 2 && phrase.includes(t)) return true;
  }
  return false;
}

function phraseIncludesLatinWord(phrase: string, word: string): boolean {
  const w = word.toLowerCase();
  return new RegExp(`(?:^|\\s)${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$)`).test(phrase);
}

/**
 * Short Latin alias terms ("easy", "soft", "slow", "rock", "pop") use substring match
 * elsewhere in the haystack, but inside `title`/`artist`/`album` (and the joined haystack
 * fallback) they need a word boundary — otherwise "easygoing" leaks into Calm/Easy,
 * "rocker" into Rock, etc. Hebrew terms keep substring (no Latin word-edge morphology),
 * multi-word terms keep substring, and decade tokens ("1980", "80s") keep substring.
 */
function isSingleLatinWordTerm(term: string): boolean {
  if (term.length === 0 || term.length > 5) return false;
  if (term.includes(" ")) return false;
  if (/[֐-׿]/.test(term)) return false;
  if (/^[0-9]/.test(term)) return false;
  if (!/[a-z]/.test(term)) return false;
  return true;
}

function escapeRegexLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function termMatchesField(val: string, term: string): boolean {
  if (!val) return false;
  if (isSingleLatinWordTerm(term)) {
    return new RegExp(`(?:^|[^a-z0-9])${escapeRegexLiteral(term)}(?:[^a-z0-9]|$)`).test(val);
  }
  return val.includes(term);
}

function uniqueNormalizedTerms(terms: string[]): string[] {
  const out = new Set<string>();
  for (const t of terms) {
    const n = normalizeLocalSearchText(t);
    if (n.length >= tokenMinLength(n)) out.add(n);
  }
  return [...out];
}

function buildIntentGroup(
  id: LocalSearchIntentGroupId,
  label: string,
  terms: string[],
): LocalSearchIntentGroup {
  return { id, label, terms: uniqueNormalizedTerms(terms) };
}

/**
 * Tokenize prompt + synonym expansions. Whole normalized phrase is also kept for substring scoring.
 */
export function expandLocalSearchTokens(query: string): { tokens: string[]; phrase: string } {
  const phrase = normalizeLocalSearchText(query);
  const rawParts = phrase.split(/\s+/).map(stripTokenEdges).filter(Boolean);
  const bag = new Set<string>();
  for (const part of rawParts) {
    expandDecadeTokens(part, bag);
    if (part.length < tokenMinLength(part)) continue;
    bag.add(part);
    const extras = DJ_INTENT_TOKEN_EXPANSIONS[part];
    if (extras) {
      for (const e of extras) {
        const n = normalizeLocalSearchText(e);
        if (n.length >= tokenMinLength(n)) bag.add(n);
      }
    }
  }
  if (phrase.length >= 2) {
    bag.add(phrase);
    if (phrase.includes("ים תיכוני") || phrase.includes("ים תיכון")) {
      for (const term of DJ_INTENT_MEDITERRANEAN_PHRASE_BOOST_TERMS) {
        bag.add(term);
      }
    }
  }
  return { tokens: [...bag], phrase };
}

/**
 * Split a query into intent groups (style, mood, decade, etc.).
 * When multiple groups are present, scoring requires/b strongly prefers matches across all groups.
 */
export function parseLocalSearchIntents(query: string): LocalSearchIntentParse {
  const phrase = normalizeLocalSearchText(query);
  const { tokens } = expandLocalSearchTokens(query);
  const groups: LocalSearchIntentGroup[] = [];

  for (const def of DJ_INTENT_LOCAL_GROUP_DEFINITIONS) {
    const latinHit = def.detectLatinWords?.some((w) => phraseIncludesLatinWord(phrase, w)) ?? false;
    const patternHit =
      def.detectPatternSources?.some((src) => new RegExp(src).test(phrase)) ?? false;
    const phraseHit = phraseIncludesAny(phrase, def.detectPhrases);
    if (!phraseHit && !latinHit && !patternHit) continue;
    groups.push(buildIntentGroup(def.id, def.label, getDjIntentLocalGroupHaystackTerms(def)));
  }

  if (groups.length === 0) {
    const generalTerms = tokens.filter((t) => t !== phrase && t.length >= tokenMinLength(t));
    if (generalTerms.length > 0) {
      groups.push(buildIntentGroup("general", "Query tokens", generalTerms));
    }
  }

  return { groups, phrase, tokens };
}

export function buildLocalTrackHaystack(row: LocalAiSearchTrackFields): string {
  const name = row.absolutePath.replace(/^.*[\\/]/, "");
  const folderParts = row.relativePathFromRoot.split("/").filter(Boolean);
  const folderJoined = folderParts.join(" ");
  const bpmStr = row.bpm != null ? String(Math.round(row.bpm)) : "";
  const ratingStr = row.rating != null ? String(Math.round(row.rating)) : "";
  const durationStr = row.durationSec != null ? String(Math.round(row.durationSec)) : "";
  const trackNum = (row.trackNumber ?? "").trim();
  const parts = [
    row.artist,
    row.title,
    row.album,
    row.genre,
    row.year,
    row.comment,
    bpmStr,
    ratingStr,
    durationStr,
    trackNum,
    trackNum ? `#${trackNum}` : null,
    row.relativePathFromRoot,
    folderJoined,
    ...folderParts,
    name.replace(/\.[a-z0-9]+$/i, ""),
    name,
  ];
  return normalizeLocalSearchText(parts.filter(Boolean).join(" "));
}

function normField(s: string | null | undefined): string {
  return normalizeLocalSearchText(s ?? "");
}

function matchIntentGroup(
  row: LocalAiSearchTrackFields,
  hay: string,
  group: LocalSearchIntentGroup,
): LocalSearchGroupMatch {
  const matchedTerms: string[] = [];
  const matchedFields: string[] = [];

  const fields: Array<[string, string]> = [
    ["genre", normField(row.genre)],
    ["comment", normField(row.comment)],
    ["path", normField(row.relativePathFromRoot)],
    ["title", normField(row.title)],
    ["artist", normField(row.artist)],
    ["album", normField(row.album)],
    ["year", normField(row.year)],
  ];

  const bpmStr = row.bpm != null ? String(Math.round(row.bpm)) : "";

  for (const term of group.terms) {
    if (term.length < tokenMinLength(term)) continue;
    let hit = false;
    for (const [field, val] of fields) {
      if (!termMatchesField(val, term)) continue;
      hit = true;
      if (!matchedFields.includes(field)) matchedFields.push(field);
    }
    if (!hit && termMatchesField(hay, term)) {
      hit = true;
      if (
        termMatchesField(normField(row.relativePathFromRoot), term) ||
        termMatchesField(normField(row.absolutePath), term)
      ) {
        if (!matchedFields.includes("path")) matchedFields.push("path");
      } else {
        if (!matchedFields.includes("haystack")) matchedFields.push("haystack");
      }
    }

    // Mood group: low BPM is a weak calm signal when comment/genre/path also soft.
    if (group.id === "mood_calm" && !hit && bpmStr && Number(bpmStr) > 0 && Number(bpmStr) <= 95) {
      const softCtx =
        normField(row.genre).includes("easy") ||
        normField(row.comment).includes("easy") ||
        normField(row.comment).includes("calm") ||
        hay.includes("easy") ||
        hay.includes("calm");
      if (softCtx) {
        hit = true;
        if (!matchedFields.includes("bpm")) matchedFields.push("bpm");
      }
    }

    if (hit && !matchedTerms.includes(term)) matchedTerms.push(term);
  }

  return {
    groupId: group.id,
    label: group.label,
    matched: matchedTerms.length > 0,
    matchedTerms,
    matchedFields,
  };
}

function buildMatchReason(
  groupMatches: LocalSearchGroupMatch[],
  groupsTotal: number,
  fullMatch: boolean,
  score: number,
): string {
  const matched = groupMatches.filter((g) => g.matched);
  if (matched.length === 0) return "no intent groups matched";
  const parts = matched.map((g) => {
    const fields = g.matchedFields.length > 0 ? g.matchedFields.join("+") : "haystack";
    const terms = g.matchedTerms.slice(0, 3).join(", ");
    return `${g.label} (${fields}: ${terms})`;
  });
  const prefix = groupsTotal >= 2 ? (fullMatch ? "full match" : "partial match") : "match";
  return `${prefix} · score ${score} · ${parts.join(" · ")}`;
}

export function scoreLocalTrackForAiSearch(
  row: LocalAiSearchTrackFields,
  intents: LocalSearchIntentParse,
): LocalSearchScoreResult {
  const hay = buildLocalTrackHaystack(row);
  if (!hay || intents.groups.length === 0) {
    return {
      score: 0,
      groupsMatched: 0,
      groupsTotal: 0,
      fullMatch: false,
      groupMatches: [],
      reason: "empty haystack or no intent groups",
    };
  }

  const groupMatches = intents.groups.map((g) => matchIntentGroup(row, hay, g));
  const groupsTotal = intents.groups.length;
  const groupsMatched = groupMatches.filter((g) => g.matched).length;

  if (groupsMatched === 0) {
    return {
      score: 0,
      groupsMatched: 0,
      groupsTotal,
      fullMatch: false,
      groupMatches,
      reason: "no intent groups matched",
    };
  }

  let score = 0;
  for (const m of groupMatches) {
    if (!m.matched) continue;
    score += 14;
    score += m.matchedTerms.length * 5;
    for (const field of m.matchedFields) {
      if (field === "genre") score += 6;
      else if (field === "comment") score += 5;
      else if (field === "path") score += 5;
      else if (field === "title" || field === "artist") score += 4;
      else if (field === "year") score += 4;
      else score += 2;
    }
  }

  if (intents.phrase.length >= 4 && hay.includes(intents.phrase)) {
    score += 16;
  }

  const fullMatch = groupsMatched === groupsTotal;
  if (groupsTotal >= 2) {
    if (fullMatch) {
      score += groupsMatched * 18;
    } else {
      score = Math.floor(score * 0.28);
    }
  }

  if (row.rating != null && row.rating >= 4) {
    score += Math.min(2, Math.max(0, row.rating - 3));
  }

  return {
    score,
    groupsMatched,
    groupsTotal,
    fullMatch,
    groupMatches,
    reason: buildMatchReason(groupMatches, groupsTotal, fullMatch, score),
  };
}

export function toLocalAiSearchMatchDebug(result: LocalSearchScoreResult): LocalAiSearchMatchDebug {
  return {
    groupsMatched: result.groupsMatched,
    groupsTotal: result.groupsTotal,
    fullMatch: result.fullMatch,
    score: result.score,
    reason: result.reason,
    groups: result.groupMatches.map((g) => ({
      label: g.label,
      matched: g.matched,
      terms: g.matchedTerms,
      fields: g.matchedFields,
    })),
  };
}

/** Legacy flat token scorer — delegates to intent-aware scoring when query is provided. */
export function scoreLocalTrackHaystack(
  hay: string,
  tokens: string[],
  phrase: string,
  row: LocalAiSearchTrackFields,
  query?: string,
): number {
  const intents = query ? parseLocalSearchIntents(query) : parseLocalSearchIntents(phrase);
  if (intents.groups.length === 0) {
    intents.groups.push(buildIntentGroup("general", "Query tokens", tokens.filter((t) => t !== phrase)));
  }
  const result = scoreLocalTrackForAiSearch(row, intents);
  return result.score;
}

export type RankedLocalAiSearchHit<T extends { score: number; matchDebug?: LocalAiSearchMatchDebug }> = T & {
  matchDebug?: LocalAiSearchMatchDebug;
};

/** Sort by intent coverage first, then score. Logs partial fallback in dev when no full matches. */
export function rankLocalAiSearchResults<T extends { score: number; matchDebug?: LocalAiSearchMatchDebug }>(
  rows: T[],
  intents: LocalSearchIntentParse,
): { results: T[]; partialFallback: boolean; partialFallbackMessage: string | null } {
  const multiGroup = intents.groups.length >= 2 && intents.groups[0]?.id !== "general";
  const sorted = [...rows].sort((a, b) => {
    const fullA = a.matchDebug?.fullMatch ? 1 : 0;
    const fullB = b.matchDebug?.fullMatch ? 1 : 0;
    if (fullB !== fullA) return fullB - fullA;
    const gmA = a.matchDebug?.groupsMatched ?? 0;
    const gmB = b.matchDebug?.groupsMatched ?? 0;
    if (gmB !== gmA) return gmB - gmA;
    return b.score - a.score;
  });

  const hasFull = multiGroup && sorted.some((r) => r.matchDebug?.fullMatch);
  const partialFallback = multiGroup && sorted.length > 0 && !hasFull;
  const partialFallbackMessage = partialFallback ? "No full local match; showing partial matches." : null;

  if (partialFallback && typeof process !== "undefined" && process.env.NODE_ENV === "development") {
    console.warn("[local-ai-search]", partialFallbackMessage, { query: intents.phrase, groups: intents.groups.map((g) => g.label) });
  }

  return { results: sorted, partialFallback, partialFallbackMessage };
}

export function scoreAndRankLocalTracksForQuery<T extends LocalAiSearchTrackFields>(
  rows: T[],
  query: string,
  limit: number,
): {
  results: Array<T & { score: number; matchDebug: LocalAiSearchMatchDebug }>;
  partialFallback: boolean;
  partialFallbackMessage: string | null;
  intents: LocalSearchIntentParse;
} {
  const intents = parseLocalSearchIntents(query);
  if (intents.groups.length === 0) {
    return { results: [], partialFallback: false, partialFallbackMessage: null, intents };
  }

  const scored: Array<T & { score: number; matchDebug: LocalAiSearchMatchDebug }> = [];
  for (const row of rows) {
    const r = scoreLocalTrackForAiSearch(row, intents);
    if (r.score <= 0) continue;
    scored.push({
      ...row,
      score: r.score,
      matchDebug: toLocalAiSearchMatchDebug(r),
    });
  }

  const cap = Math.min(80, Math.max(1, limit));
  const { results, partialFallback, partialFallbackMessage } = rankLocalAiSearchResults(scored, intents);
  return {
    results: results.slice(0, cap),
    partialFallback,
    partialFallbackMessage,
    intents,
  };
}
