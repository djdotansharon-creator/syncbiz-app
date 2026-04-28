import { prisma } from "@/lib/prisma";

/**
 * Old embedded-default slugs that duplicate Excel canonical vocabulary.
 * Source (left) → target (right, canonical Excel slug). Sources are marked MERGED.
 */
export const MUSIC_TAXONOMY_DEFAULT_DUPLICATE_MERGE_PAIRS: ReadonlyArray<
  readonly [sourceSlug: string, targetSlug: string]
> = [
  ["vibe-energy-low", "low-energy"],
  ["genre-hip-hop", "hip-hop"],
  ["day-lunch", "lunch"],
  ["day-afternoon", "afternoon"],
  ["vibe-energy-high", "high-energy"],
  ["genre-jazz", "jazz"],
  ["day-dinner", "dinner"],
  ["day-late-night", "late-night"],
  ["genre-reggae", "reggae-dub"],
];

export type MusicTaxonomyDefaultMergeResult = {
  merged: number;
  skipped: Array<{ source: string; target: string; reason: string }>;
};

/**
 * Idempotent: sets `MERGED` + `mergedIntoId` on duplicate default slugs only.
 * Does not delete rows or modify target tags.
 */
export async function applyMusicTaxonomyStage3DefaultDuplicateMerges(): Promise<MusicTaxonomyDefaultMergeResult> {
  const skipped: MusicTaxonomyDefaultMergeResult["skipped"] = [];
  let merged = 0;

  for (const [sourceSlug, targetSlug] of MUSIC_TAXONOMY_DEFAULT_DUPLICATE_MERGE_PAIRS) {
    if (sourceSlug === targetSlug) {
      skipped.push({ source: sourceSlug, target: targetSlug, reason: "source equals target" });
      continue;
    }

    const [src, tgt] = await Promise.all([
      prisma.musicTaxonomyTag.findUnique({
        where: { slug: sourceSlug },
        select: { id: true },
      }),
      prisma.musicTaxonomyTag.findUnique({
        where: { slug: targetSlug },
        select: { id: true },
      }),
    ]);

    if (!src || !tgt) {
      const reason =
        [!src && "missing source", !tgt && "missing target"].filter(Boolean).join("; ") ||
        "unknown";
      console.warn(`[taxonomy Stage3 merge] SKIP ${sourceSlug} -> ${targetSlug}: ${reason}`);
      skipped.push({ source: sourceSlug, target: targetSlug, reason });
      continue;
    }

    await prisma.musicTaxonomyTag.update({
      where: { slug: sourceSlug },
      data: {
        status: "MERGED",
        mergedIntoId: tgt.id,
      },
    });
    merged += 1;
    console.info(`[taxonomy Stage3 merge] MERGED ${sourceSlug} -> ${targetSlug}`);
  }

  console.info(`[taxonomy Stage3 merge] Done: merged=${merged}, skipped=${skipped.length}`);
  return { merged, skipped };
}
