import type { UnifiedSource } from "@/lib/source-types";

/** Controller-style provenance chips for artwork / placeholders and search UX. */
export type TrackSourceChip = "LOCAL" | "YT" | "CAT" | "LIB" | "RADIO";

export function inferTrackSourceChip(source: UnifiedSource): TrackSourceChip {
  if (source.origin === "radio") return "RADIO";
  if ((source.catalogItemId ?? "").trim().length > 0) return "CAT";
  switch (source.type) {
    case "youtube":
      return "YT";
    case "local":
    case "winamp":
      return "LOCAL";
    default:
      break;
  }
  if (source.origin === "playlist" && source.playlist) return "LIB";
  return "LIB";
}
