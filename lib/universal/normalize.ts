/**
 * Phase B0 — pure normalization + version-detection helpers.
 *
 * Shared by the catalog backfill (B0.1) and CatalogResolver v2 (B0.2). Everything
 * here is PURE (no DB, no network, no side effects) so it can be unit-tested with
 * `npx tsx scripts/check-universal-resolver.ts` without touching any database.
 */

import type { TrackVersionName } from "@/lib/universal/universal-track";

/** Lowercase, strip diacritics, drop feat/parenthetical qualifiers, collapse punctuation. */
export function normalizeTitle(raw: string): string {
  if (!raw) return "";
  let s = raw.normalize("NFKD").replace(/\p{M}/gu, ""); // strip combining marks (any script)
  s = s.toLowerCase();
  s = s.replace(/&/g, " and ");
  // Drop "(feat. …)" / "[feat …]" / trailing "feat …" credits.
  s = s.replace(/[([{][^)\]}]*\b(feat\.?|ft\.?|featuring|with)\b[^)\]}]*[)\]}]/gi, " ");
  s = s.replace(/\b(feat\.?|ft\.?|featuring)\b.*$/gi, " ");
  // Drop any remaining bracketed qualifier (remaster/version/etc.) for the index key.
  s = s.replace(/[([{][^)\]}]*[)\]}]/g, " ");
  s = s.replace(/[^\p{L}\p{N}\s]/gu, " "); // punctuation → space (keeps Hebrew/other scripts)
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/** Normalize a single artist name for dedupe (Artist.normalizedName). */
export function normalizeArtistName(raw: string): string {
  if (!raw) return "";
  let s = raw.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  s = s.replace(/&/g, " and ");
  s = s.replace(/[^\p{L}\p{N}\s]/gu, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

const ARTIST_SPLIT = /\s*(?:,|&| feat\.? | ft\.? | featuring | with | x | vs\.? |×|\/| and )\s*/gi;

/** Split a free-text artist string into an ordered list (primary first). */
export function splitArtists(raw: string | null | undefined): string[] {
  const s = (raw ?? "").trim();
  if (!s) return [];
  return s
    .split(ARTIST_SPLIT)
    .map((a) => a.trim())
    .filter((a) => a.length > 0);
}

/**
 * Version cues we can detect in a title. These are BROADER than the TrackVersionType
 * enum on purpose — "nightcore" and "compilation" are guard signals, not stored
 * versions. Used by the resolver to avoid resolving to a wrong edit.
 */
export const VERSION_CUE_PATTERNS: Record<string, RegExp> = {
  live: /\blive\b(?!\s*(?:wire|stream))|\blive\s+(?:at|from|in)\b/i,
  // NOTE: does NOT match a bare "mix" (so "Extended Mix" is not a remix); requires
  // "remix"/"re-mix"/"rmx"/etc. Includes Hebrew (רמיקס) and Arabic (ريمكس).
  remix: /\bremix\b|\bre-mix\b|\brmx\b|\bbootleg\b|\bflip\b|\brework\b|רמיקס|ريمكس/i,
  radio_edit: /\bradio\s*edit\b/i,
  extended: /\bextended\b/i,
  cover: /\bcover\b/i,
  karaoke: /\bkaraoke\b|\bbacking\s*track\b/i,
  instrumental: /\binstrumental\b/i,
  acoustic: /\bacoustic\b|\bunplugged\b/i,
  remaster: /\bremaster(?:ed)?\b|\b(?:19|20)\d{2}\s*remaster\b/i,
  sped_up: /\bsped[\s-]?up\b|\bspeed\s*up\b|\bnightcore\b/i,
  slowed: /\bslowed\b|\bslowed\s*(?:down|(?:&|and)\s*reverb)\b/i,
  nightcore: /\bnightcore\b/i,
  compilation: /\bcompilation\b|\bmegamix\b|\bgreatest\s+hits\b|\bfull\s+album\b|\bnonstop\b/i,
};

/** All version cues present in a title. */
export function detectVersionCues(title: string): string[] {
  if (!title) return [];
  const cues: string[] = [];
  for (const [cue, re] of Object.entries(VERSION_CUE_PATTERNS)) {
    if (re.test(title)) cues.push(cue);
  }
  return cues;
}

/**
 * Priority order used to pick ONE stored versionType when a title carries multiple
 * cues. EXTENDED intentionally precedes REMIX so "Extended Mix/Version/Edit/Remix" is
 * EXTENDED, not REMIX. LIVE/COVER/KARAOKE (distinct performances) rank highest;
 * RADIO_EDIT stays distinct (there is no generic "edit" cue to swallow it), and
 * REMASTER is a real cue so it never collapses to ORIGINAL.
 */
const VERSION_TYPE_PRIORITY: Array<[string, TrackVersionName]> = [
  ["live", "LIVE"],
  ["cover", "COVER"],
  ["karaoke", "KARAOKE"],
  ["instrumental", "INSTRUMENTAL"],
  ["acoustic", "ACOUSTIC"],
  ["extended", "EXTENDED"], // before remix
  ["remix", "REMIX"],
  ["radio_edit", "RADIO_EDIT"],
  ["remaster", "REMASTER"],
  ["sped_up", "SPED_UP"],
  ["slowed", "SLOWED"],
  ["nightcore", "SPED_UP"],
];

/** Stored TrackVersionType for a title (ORIGINAL when no special cue). */
export function versionTypeFromTitle(title: string): TrackVersionName {
  const cues = new Set(detectVersionCues(title));
  for (const [cue, v] of VERSION_TYPE_PRIORITY) if (cues.has(cue)) return v;
  return cues.size > 0 ? "OTHER" : "ORIGINAL";
}

/** Cues that make a candidate a DIFFERENT recording/edit than a plain original. */
const SPECIAL_CUES = new Set([
  "live",
  "remix",
  "radio_edit",
  "extended",
  "remaster",
  "cover",
  "karaoke",
  "instrumental",
  "acoustic",
  "sped_up",
  "slowed",
  "nightcore",
  "compilation",
]);

/**
 * Version compatibility between a query title and a candidate title. If the candidate
 * carries a special cue that the query did NOT ask for, they are incompatible
 * (e.g. query "Song" vs candidate "Song (Live)"). Symmetric on the special set.
 */
export function versionCompatible(queryTitle: string, candidateTitle: string): {
  compatible: boolean;
  mismatchedCues: string[];
} {
  const q = new Set(detectVersionCues(queryTitle).filter((c) => SPECIAL_CUES.has(c)));
  const c = new Set(detectVersionCues(candidateTitle).filter((cue) => SPECIAL_CUES.has(cue)));
  const mismatchedCues: string[] = [];
  for (const cue of c) if (!q.has(cue)) mismatchedCues.push(cue);
  for (const cue of q) if (!c.has(cue)) mismatchedCues.push(`missing:${cue}`);
  return { compatible: mismatchedCues.length === 0, mismatchedCues };
}
