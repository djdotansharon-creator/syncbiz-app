import type { UnifiedSource } from "@/lib/source-types";

/** Controller-style provenance chips for artwork / placeholders and search UX. */
export type TrackSourceChip = "LOCAL" | "YT" | "SC" | "CAT" | "LIB" | "RADIO";

export function inferTrackSourceChip(source: UnifiedSource): TrackSourceChip {
  if (source.origin === "radio") return "RADIO";
  // Platform beats catalog membership for the badge: an operator needs to see at a
  // glance whether a track streams from YouTube vs SoundCloud.
  if (source.type === "youtube") return "YT";
  if (source.type === "soundcloud") return "SC";
  if ((source.catalogItemId ?? "").trim().length > 0) return "CAT";
  switch (source.type) {
    case "local":
    case "winamp":
      return "LOCAL";
    default:
      break;
  }
  if (source.origin === "playlist" && source.playlist) return "LIB";
  return "LIB";
}
