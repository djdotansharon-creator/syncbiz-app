import type { BusinessType } from "@prisma/client";
import type { DaypartSlug } from "@/lib/recommendations/fit-rules.types";
import {
  daypartSegmentSchema,
  type DaypartSegment,
} from "@/lib/recommendations/business-daypart-vibe.types";

/** All segments available in Recommendation Preview (business-daypart vibe lookup). */
export const DAYPART_SEGMENT_OPTIONS: readonly DaypartSegment[] = [
  "morning",
  "lunch",
  "afternoon",
  "evening",
  "dinner",
  "night",
  "early_evening",
  "after_hours",
] as const;

/**
 * Maps coarse tag-level daypart (fit-rules taxonomy dayparts) → fine segment when URL `segment` is absent.
 * BAR skews lunch→afternoon and dinner→early_evening so vibe rows align with hospitality habits.
 */
export function defaultSegmentForBusinessType(
  primaryBusinessType: BusinessType | null | undefined,
  coarseDaypart: DaypartSlug,
): DaypartSegment {
  if (primaryBusinessType === "BAR") {
    switch (coarseDaypart) {
      case "morning":
        return "afternoon";
      case "lunch":
        return "afternoon";
      case "dinner":
        return "early_evening";
      case "night":
        return "night";
      default:
        return coarseDaypart as DaypartSegment;
    }
  }
  return coarseDaypart as DaypartSegment;
}

/** Segments valid for coarse mapping without BAR overrides (morning/lunch/dinner/night overlap taxonomy slugs). */
export function resolveDaypartSegment(args: {
  segmentParam: string | undefined | null;
  primaryBusinessType: BusinessType | null | undefined;
  coarseDaypart: DaypartSlug;
}): DaypartSegment {
  const trimmed = typeof args.segmentParam === "string" ? args.segmentParam.trim() : "";
  if (trimmed.length > 0) {
    const parsed = daypartSegmentSchema.safeParse(trimmed);
    if (parsed.success) return parsed.data;
  }
  return defaultSegmentForBusinessType(args.primaryBusinessType, args.coarseDaypart);
}
