/**
 * DJ Creator playlist recipe parse — single intent vs multi-lane prompts.
 * Within a lane: intent groups are AND (via parseLocalSearchIntents).
 * Across lanes: recipe sections are OR / playlist parts.
 */

import type { DjIntentLocalGroupId } from "@/lib/dj-intent-dictionary";
import {
  normalizeLocalSearchText,
  parseLocalSearchIntents,
  type LocalSearchIntentGroup,
} from "@/lib/local-ai-playlist-search";

export type DjPlaylistRecipeParseConfidence = "strong" | "medium" | "weak";

export type DjIntentLaneGroup = {
  id: DjIntentLocalGroupId;
  label: string;
};

export type DjIntentLane = {
  id: string;
  rawPhrase: string;
  label: string;
  groups: DjIntentLaneGroup[];
  weight: number;
  parseConfidence: DjPlaylistRecipeParseConfidence;
};

export type DjPlaylistRecipe = {
  mode: "single" | "multi";
  rawPrompt: string;
  lanes: DjIntentLane[];
  /** Intent group ids present in 2+ lanes (e.g. mood_calm across lanes). */
  sharedGroupIds?: DjIntentLocalGroupId[];
};

function substantiveGroups(groups: LocalSearchIntentGroup[]): LocalSearchIntentGroup[] {
  return groups.filter((g) => g.id !== "general");
}

/** True when segment parses to at least one non-general intent group. */
export function segmentQualifiesAsRecipeLane(phrase: string): boolean {
  const trimmed = phrase.trim();
  if (trimmed.length < 2) return false;
  return substantiveGroups(parseLocalSearchIntents(trimmed).groups).length >= 1;
}

/**
 * Comma split only when every part is an independent intent lane.
 * Skips binding lists: "rock, pop and soul" / "rock, pop ו soul".
 */
export function tryCommaIndependentLaneSplit(text: string): string[] | null {
  if (!text.includes(",")) return null;
  const norm = normalizeLocalSearchText(text);
  if (/\band\b/.test(norm) || /\sו\s/.test(norm)) return null;

  const parts = text
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  if (!parts.every((p) => segmentQualifiesAsRecipeLane(p))) return null;
  return parts;
}

/**
 * Split prompt into lane segment strings (not yet parsed).
 * Newline, semicolon, pipe = hard boundaries. Comma = soft when all parts are lanes.
 */
export function splitPromptIntoLaneSegments(rawPrompt: string): string[] {
  const trimmed = rawPrompt.trim();
  if (!trimmed) return [];

  const primary = trimmed
    .split(/\r?\n|[;|]/)
    .map((s) => s.trim())
    .filter(Boolean);

  let segments: string[];
  if (primary.length <= 1) {
    const base = primary[0] ?? trimmed;
    segments = tryCommaIndependentLaneSplit(base) ?? [base];
  } else {
    segments = primary;
  }

  return segments.filter((s) => s.trim().length > 0);
}

function laneConfidence(groups: DjIntentLaneGroup[]): DjPlaylistRecipeParseConfidence {
  const nonGeneral = groups.filter((g) => g.id !== "general");
  if (nonGeneral.length >= 2) return "strong";
  if (nonGeneral.length === 1) return "medium";
  return "weak";
}

function buildLaneLabel(groups: DjIntentLaneGroup[]): string {
  const nonGeneral = groups.filter((g) => g.id !== "general");
  const use = nonGeneral.length > 0 ? nonGeneral : groups;
  return use.map((g) => g.label).join(" · ") || "Query";
}

function toLaneGroups(parsed: ReturnType<typeof parseLocalSearchIntents>): DjIntentLaneGroup[] {
  return parsed.groups.map((g) => ({ id: g.id, label: g.label }));
}

function computeSharedGroupIds(lanes: DjIntentLane[]): DjIntentLocalGroupId[] {
  const counts = new Map<DjIntentLocalGroupId, number>();
  for (const lane of lanes) {
    for (const g of lane.groups) {
      if (g.id === "general") continue;
      counts.set(g.id, (counts.get(g.id) ?? 0) + 1);
    }
  }
  return [...counts.entries()].filter(([, n]) => n >= 2).map(([id]) => id);
}

function buildLane(rawPhrase: string, index: number): DjIntentLane {
  const parsed = parseLocalSearchIntents(rawPhrase.trim());
  const groups = toLaneGroups(parsed);
  return {
    id: `lane-${index + 1}`,
    rawPhrase: rawPhrase.trim(),
    label: buildLaneLabel(groups),
    groups,
    weight: 1,
    parseConfidence: laneConfidence(groups),
  };
}

/**
 * Parse a DJ Creator prompt as single-intent or multi-lane playlist recipe.
 */
export function parseDjPlaylistRecipe(rawPrompt: string): DjPlaylistRecipe {
  const trimmed = rawPrompt.trim();
  const segments = splitPromptIntoLaneSegments(trimmed);

  if (segments.length === 0) {
    return { mode: "single", rawPrompt: trimmed, lanes: [] };
  }

  const qualified = segments.filter((s) => segmentQualifiesAsRecipeLane(s) || s.trim().length >= 2);
  const laneSegments =
    qualified.length > 0
      ? qualified
      : segments;

  const lanes = laneSegments.map((seg, i) => buildLane(seg, i));

  const substantiveLaneCount = lanes.filter(
    (l) => l.groups.some((g) => g.id !== "general"),
  ).length;

  const mode: DjPlaylistRecipe["mode"] =
    laneSegments.length >= 2 && substantiveLaneCount >= 2 ? "multi" : "single";

  const sharedGroupIds = computeSharedGroupIds(lanes);
  return {
    mode,
    rawPrompt: trimmed,
    lanes,
    ...(sharedGroupIds.length > 0 ? { sharedGroupIds } : {}),
  };
}
