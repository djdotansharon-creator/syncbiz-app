import type { UnifiedSource } from "@/lib/source-types";

/**
 * Canonical tile key for a fixed daypart pad (`daypart:morning`, `daypart:late_night`, …).
 * - Trims, lowercases, collapses whitespace in the slug to underscores.
 * - Maps legacy `night` → `late_night` to match `inferDaypartLabel` ("Late Night") and `FIXED_DAYPART_PADS`.
 * Non-`daypart:` keys (e.g. `customplaylist:…`) are only trimmed + lowercased.
 */
export function normalizeDaypartTileKey(key: string): string {
  const trimmed = key.trim().toLowerCase();
  if (!trimmed.startsWith("daypart:")) return trimmed;
  const slug = trimmed.slice("daypart:".length).replace(/\s+/g, "_");
  const canonSlug = slug === "night" ? "late_night" : slug;
  return `daypart:${canonSlug}`;
}

/**
 * Canonical keys for `syncbiz-daypart-playlist-assignments` (must match `FIXED_DAYPART_PADS` in sources-manager).
 * Night uses `daypart:late_night` because `inferDaypartLabel` returns "Late Night" → slug `late_night`.
 */
export function normalizeDaypartPlaylistAssignments(raw: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v !== "string" || !v.trim()) continue;
    const key = normalizeDaypartTileKey(k);
    if (out[key] === undefined) out[key] = v;
  }
  return out;
}

export function inferDaypartLabel(source: UnifiedSource): string {
  const t = `${source.title} ${source.genre ?? ""}`.toLowerCase();
  if (/(morning|breakfast|sunrise)/i.test(t)) return "Morning";
  if (/(afternoon|lunch|midday)/i.test(t)) return "Afternoon";
  if (/(evening|dinner|sunset)/i.test(t)) return "Evening";
  if (/(night|late|midnight)/i.test(t)) return "Late Night";
  return "General Daypart";
}

/** Play / drag: use full `sources` list so genre filter does not empty the queue (matches syncbiz_playlist). */
export function resolveDaypartCollectionSources(key: string, allSources: UnifiedSource[]): UnifiedSource[] {
  if (key.startsWith("customplaylist:")) return [];
  return allSources.filter(
    (s) => `daypart:${inferDaypartLabel(s).toLowerCase().replace(/\s+/g, "_")}` === key
  );
}
