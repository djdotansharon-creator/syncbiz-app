import type { UnifiedSource } from "@/lib/source-types";

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
