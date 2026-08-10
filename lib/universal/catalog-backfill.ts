/**
 * Phase B0.1 — idempotent, reversible CatalogItem → UniversalTrack backfill.
 *
 * SAFETY:
 *  - Dry-run by DEFAULT. Nothing is written unless `apply: true`.
 *  - NEVER updates or deletes a CatalogItem — the legacy catalog is read-only here.
 *  - Idempotent: re-runs skip items already bridged (UniversalTrack.legacyCatalogItemId).
 *  - Reversible: everything created carries a "catalog_backfill" SourceProvenance, so
 *    rollbackBackfill() can remove exactly what this job produced.
 *  - The caller supplies the PrismaClient; this module is type-only coupled to it.
 *
 * It is deliberately NOT executed against production by the author — run it against a
 * disposable/dev database via `npx tsx scripts/backfill-universal-tracks.ts`.
 */

import type { PrismaClient } from "@prisma/client";
import {
  normalizeArtistName,
  normalizeTitle,
  splitArtists,
  versionTypeFromTitle,
} from "@/lib/universal/normalize";

export interface BackfillOptions {
  /** false (default) = dry-run: compute + report, write nothing. */
  apply?: boolean;
  batchSize?: number;
  /** Resume after this CatalogItem id (exclusive). */
  cursor?: string | null;
  /** Max items to process this run (null = all). */
  limit?: number | null;
}

export interface BackfillConflict {
  catalogItemId: string;
  reason: string;
  detail?: string;
}

export interface BackfillReport {
  mode: "dry-run" | "apply";
  scanned: number;
  created: number;
  skippedExisting: number;
  artistsCreated: number;
  mappingsCreated: number;
  provenanceCreated: number;
  durationMapped: number;
  conflicts: BackfillConflict[];
  errors: Array<{ catalogItemId: string; message: string }>;
  lastCursor: string | null;
  hasMore: boolean;
}

const YT_ID_RE = /[?&]v=([A-Za-z0-9_-]{6,})/;

/** Decide the (provider, externalId) for a CatalogItem's ProviderMapping. */
function deriveProviderRef(item: {
  provider: string | null;
  videoId: string | null;
  canonicalUrl: string | null;
  url: string;
}): { provider: string; externalId: string } | null {
  const provider = item.provider ?? (item.videoId ? "youtube" : "direct");
  if (provider === "youtube") {
    const id = item.videoId || item.canonicalUrl?.match(YT_ID_RE)?.[1] || item.url.match(YT_ID_RE)?.[1] || "";
    if (!id) return null;
    return { provider: "youtube", externalId: id };
  }
  // Non-YouTube: the URL itself is the stable external id.
  const externalId = (item.canonicalUrl || item.url || "").trim();
  if (!externalId) return null;
  return { provider, externalId };
}

export async function backfillCatalogToUniversal(
  prisma: PrismaClient,
  options: BackfillOptions = {},
): Promise<BackfillReport> {
  const apply = options.apply === true;
  const batchSize = Math.max(1, Math.min(1000, options.batchSize ?? 200));
  const limit = options.limit ?? null;

  const report: BackfillReport = {
    mode: apply ? "apply" : "dry-run",
    scanned: 0,
    created: 0,
    skippedExisting: 0,
    artistsCreated: 0,
    mappingsCreated: 0,
    provenanceCreated: 0,
    durationMapped: 0,
    conflicts: [],
    errors: [],
    lastCursor: options.cursor ?? null,
    hasMore: false,
  };

  let cursor = options.cursor ?? null;
  // Tracks (provider|externalId) that WOULD be created this run, so dry-run detects
  // intra-run duplicate mappings even though it writes nothing (dry-run == apply counts).
  const seenRefs = new Set<string>();

  while (true) {
    if (limit !== null && report.scanned >= limit) {
      report.hasMore = true;
      break;
    }
    const take = limit !== null ? Math.min(batchSize, limit - report.scanned) : batchSize;
    const batch = await prisma.catalogItem.findMany({
      where: cursor ? { id: { gt: cursor } } : undefined,
      orderBy: { id: "asc" },
      take,
      select: {
        id: true,
        url: true,
        canonicalUrl: true,
        videoId: true,
        provider: true,
        title: true,
        artist: true,
        durationSec: true,
      },
    });
    if (batch.length === 0) break;

    for (const item of batch) {
      report.scanned += 1;
      cursor = item.id;
      report.lastCursor = cursor;
      try {
        const existing = await prisma.universalTrack.findUnique({
          where: { legacyCatalogItemId: item.id },
          select: { id: true },
        });
        if (existing) {
          report.skippedExisting += 1;
          continue;
        }

        const ref = deriveProviderRef(item);
        if (!ref) {
          report.conflicts.push({ catalogItemId: item.id, reason: "no_external_id", detail: item.url });
          continue;
        }

        // Provider+externalId already owned (in the DB OR earlier in this run) → conflict.
        const refKey = `${ref.provider}|${ref.externalId}`;
        const clashInRun = seenRefs.has(refKey);
        const mappingClash = clashInRun
          ? null
          : await prisma.providerMapping.findFirst({
              where: { provider: ref.provider, externalId: ref.externalId },
              select: { id: true, universalTrackId: true },
            });
        if (clashInRun || mappingClash) {
          report.conflicts.push({
            catalogItemId: item.id,
            reason: "provider_external_id_taken",
            detail: clashInRun ? `${ref.provider}:${ref.externalId} (duplicate within this run)` : `${ref.provider}:${ref.externalId} → ${mappingClash?.universalTrackId}`,
          });
          continue;
        }
        seenRefs.add(refKey);

        const artistNames = splitArtists(item.artist)
          .map((name) => ({ displayName: name, normalizedName: normalizeArtistName(name) }))
          .filter((a) => a.normalizedName.length > 0);
        const durationMs = typeof item.durationSec === "number" && item.durationSec > 0 ? item.durationSec * 1000 : null;

        // Count would-be effects (same in both modes so the dry-run report is accurate).
        report.created += 1;
        report.mappingsCreated += 1;
        report.provenanceCreated += 1;
        if (durationMs !== null) report.durationMapped += 1;

        if (!apply) {
          report.artistsCreated += artistNames.length; // upper bound (dedupe happens on apply)
          continue;
        }

        await prisma.$transaction(async (tx) => {
          const track = await tx.universalTrack.create({
            data: {
              displayTitle: item.title,
              normalizedTitle: normalizeTitle(item.title),
              durationMs,
              versionType: versionTypeFromTitle(item.title),
              legacyCatalogItemId: item.id,
            },
            select: { id: true },
          });

          for (let i = 0; i < artistNames.length; i += 1) {
            const a = artistNames[i];
            const existingArtist = await tx.artist.findUnique({
              where: { normalizedName: a.normalizedName },
              select: { id: true },
            });
            const artist =
              existingArtist ??
              (await tx.artist.create({
                data: { normalizedName: a.normalizedName, displayName: a.displayName },
                select: { id: true },
              }));
            if (!existingArtist) report.artistsCreated += 1;
            await tx.trackArtist.create({
              data: { universalTrackId: track.id, artistId: artist.id, order: i, role: i === 0 ? "primary" : "featured" },
            });
          }

          await tx.providerMapping.create({
            data: {
              universalTrackId: track.id,
              provider: ref.provider,
              externalId: ref.externalId,
              externalUrl: item.canonicalUrl ?? item.url,
              playableStatus: ref.provider === "youtube" ? "PLAYABLE" : "UNKNOWN",
            },
          });

          await tx.sourceProvenance.create({
            data: {
              universalTrackId: track.id,
              source: "catalog_backfill",
              sourceType: "catalog",
              externalReference: item.url,
              rawMetadataRef: item.id,
            },
          });
        });
      } catch (err) {
        report.errors.push({ catalogItemId: item.id, message: err instanceof Error ? err.message : String(err) });
      }
    }

    if (batch.length < take) break;
  }

  return report;
}

export interface RollbackReport {
  mode: "dry-run" | "apply";
  tracksToRemove: number;
  removed: number;
  orphanArtistsRemoved: number;
}

/**
 * Reverse a backfill: delete exactly the UniversalTracks created by this job (identified
 * by a "catalog_backfill" provenance). Cascades remove their TrackArtist / ProviderMapping
 * / SourceProvenance. CatalogItem rows are never touched. Dry-run by default.
 */
export async function rollbackBackfill(
  prisma: PrismaClient,
  options: { apply?: boolean } = {},
): Promise<RollbackReport> {
  const apply = options.apply === true;
  const ids = await prisma.universalTrack.findMany({
    where: { provenance: { some: { source: "catalog_backfill" } } },
    select: { id: true },
  });
  if (!apply) return { mode: "dry-run", tracksToRemove: ids.length, removed: 0, orphanArtistsRemoved: 0 };
  const res = await prisma.universalTrack.deleteMany({
    where: { id: { in: ids.map((r) => r.id) } },
  });
  // Artists are only ever created by the backfill; once their last TrackArtist is
  // cascade-removed they are orphans and should go too, making rollback a true reverse.
  const orphans = await prisma.artist.findMany({ where: { tracks: { none: {} } }, select: { id: true } });
  const artists = await prisma.artist.deleteMany({ where: { id: { in: orphans.map((a) => a.id) } } });
  return { mode: "apply", tracksToRemove: ids.length, removed: res.count, orphanArtistsRemoved: artists.count };
}
