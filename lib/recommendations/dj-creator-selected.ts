/**
 * SELECTED quality-boost helper for DJ Creator (INTERNAL ranking only).
 *
 * SELECTED is the owner's per-genre "hand-picked" marker, stored ONLY in the local library layer:
 *   TrackEnrichment.manualSelected  (manual override)   OR
 *   originalComments[] containing the exact SELECTED token.
 * This helper returns ONLY a set of normalized titles that are SELECTED — never the raw comment text.
 * SELECTED is a tie-breaker/boost WITHIN already-matched results; it never overrides Genre/Mood/Energy/
 * Place/Daypart matching, and is never shown to the user.
 */
import type { PrismaClient } from "@prisma/client";
import { isSelectedComment } from "@/lib/universal/music-library-metadata";

const norm = (s: string | null | undefined): string => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** Normalized titles that are SELECTED (manualSelected wins; else an originalComments SELECTED token). */
export async function loadSelectedTitleSet(prisma: PrismaClient, titles: string[]): Promise<Set<string>> {
  const wanted = new Set(titles.map(norm).filter(Boolean));
  if (wanted.size === 0) return new Set();
  // Dev-scale scan (could use a normalized-title index later). We only READ Layer-A + enrichment flags.
  const files = await prisma.localTrackFile.findMany({
    where: { originalTitle: { not: null } },
    select: { originalTitle: true, originalComments: true, enrichment: { select: { manualSelected: true } } },
  });
  const selected = new Set<string>();
  for (const f of files) {
    const key = norm(f.originalTitle);
    if (!wanted.has(key) || selected.has(key)) continue;
    const manual = f.enrichment?.manualSelected;
    const isSel = manual === true || (manual == null && (f.originalComments ?? []).some((c) => isSelectedComment(c)));
    if (isSel) selected.add(key);
  }
  return selected;
}

export const normalizeTitleForSelected = norm;
