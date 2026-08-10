/**
 * Phase B1 — generic chart ingestion runner (provider-agnostic).
 *
 * Flow per the B0.3/B0.4/B0.5 design:
 *   ChartSnapshotData → MusicIngestionRun → ChartSnapshot (idempotent by editionUid +
 *   sourcePayloadHash) → per entry: ExternalTrackObservation + ChartObservationEntry →
 *   CatalogResolver → auto_match ⇒ ChartEntry (promoted); ambiguous/unresolved ⇒ kept,
 *   NOT promoted. Observations are never deleted after a match.
 *
 * Dry-run by default: resolves read-only and reports would-be counts; writes nothing.
 * A re-ingest of the same edition+payload is a no-op (no duplicate snapshot/observations).
 */

import type { PrismaClient } from "@prisma/client";
import type { ChartSnapshotData } from "@/lib/universal/music-intelligence";
import { buildChartEditionUid } from "@/lib/universal/chart-ingestion";
import { splitArtists } from "@/lib/universal/normalize";
import { resolveUniversalTrack, type ResolverPrisma } from "@/lib/universal/catalog-resolver";

export interface ChartIngestOptions {
  apply?: boolean;
  editionKey: string;
  capturedAt: string; // ISO 8601
  chartDate?: string; // ISO date
  sourcePayloadHash: string;
  providerVersion?: string;
  ingestionType?: string;
}

export interface ChartIngestReport {
  mode: "dry-run" | "apply";
  source: string;
  chartType: string;
  territory?: string;
  editionUid: string;
  sourcePayloadHash: string;
  snapshotAction: "created" | "updated" | "noop";
  fetched: number;
  parsed: number;
  valid: number;
  invalid: number;
  duplicateEntries: number;
  autoMatched: number;
  ambiguous: number;
  unresolved: number;
  createdSnapshots: number;
  createdObservations: number;
  promotedChartEntries: number;
  confidence: Record<string, number>;
  sampleMatches: Array<{ rank: number; title: string; artist: string; decision: string; confidence: number; reasons: string[]; universalTrackId?: string }>;
  ingestionRunId?: string;
}

export async function ingestChartSnapshot(
  prisma: PrismaClient,
  snapshot: ChartSnapshotData,
  opts: ChartIngestOptions,
): Promise<ChartIngestReport> {
  const apply = opts.apply === true;
  const editionUid = buildChartEditionUid({
    source: snapshot.source,
    chartType: snapshot.chartType,
    territory: snapshot.territory,
    city: snapshot.city,
    genre: snapshot.genre,
    editionKey: opts.editionKey,
  });

  const fetched = snapshot.entries.length;
  const validEntries = snapshot.entries.filter((e) => (e.title ?? "").trim().length > 0);
  const invalid = fetched - validEntries.length;

  // duplicate providerExternalId within the payload
  const seenExt = new Set<string>();
  let duplicateEntries = 0;
  for (const e of snapshot.entries) {
    const id = e.providerExternalId ?? "";
    if (!id) continue;
    if (seenExt.has(id)) duplicateEntries += 1;
    else seenExt.add(id);
  }

  // idempotency
  const existing = await prisma.chartSnapshot.findUnique({ where: { editionUid }, select: { id: true, sourcePayloadHash: true } });
  const snapshotAction: "created" | "updated" | "noop" = !existing
    ? "created"
    : existing.sourcePayloadHash === opts.sourcePayloadHash
      ? "noop"
      : "updated";
  const willCreate = snapshotAction === "created";

  // resolve every valid entry (read-only)
  const decisions = { auto_match: 0, ambiguous: 0, unresolved: 0 };
  const confidence: Record<string, number> = { "<0.60": 0, "0.60-0.69": 0, "0.70-0.89": 0, ">=0.90": 0 };
  const resolved: Array<{ entry: (typeof validEntries)[number]; result: Awaited<ReturnType<typeof resolveUniversalTrack>> }> = [];
  for (const entry of validEntries) {
    const result = await resolveUniversalTrack(prisma as unknown as ResolverPrisma, {
      title: entry.title as string,
      artists: splitArtists(entry.artist),
      isrc: entry.isrc,
      durationMs: entry.durationMs,
      album: entry.album,
    });
    decisions[result.decision] += 1;
    const c = result.confidence;
    if (c < 0.6) confidence["<0.60"] += 1;
    else if (c < 0.7) confidence["0.60-0.69"] += 1;
    else if (c < 0.9) confidence["0.70-0.89"] += 1;
    else confidence[">=0.90"] += 1;
    resolved.push({ entry, result });
  }

  let ingestionRunId: string | undefined;

  if (apply && willCreate) {
    const run = await prisma.musicIngestionRun.create({
      data: {
        provider: snapshot.source,
        ingestionType: opts.ingestionType ?? "chart",
        sourceReference: editionUid,
        status: "RUNNING",
        sourcePayloadHash: opts.sourcePayloadHash,
        metadata: { editionKey: opts.editionKey, territory: snapshot.territory ?? null },
      },
      select: { id: true },
    });
    ingestionRunId = run.id;

    const snap = await prisma.chartSnapshot.create({
      data: {
        source: snapshot.source,
        chartType: snapshot.chartType,
        territory: snapshot.territory,
        city: snapshot.city,
        genre: snapshot.genre,
        editionKey: opts.editionKey,
        editionUid,
        capturedAt: new Date(opts.capturedAt),
        chartDate: opts.chartDate ? new Date(opts.chartDate) : undefined,
        providerVersion: opts.providerVersion,
        sourcePayloadHash: opts.sourcePayloadHash,
      },
      select: { id: true },
    });

    for (const { entry, result } of resolved) {
      const matchStatus = result.decision === "auto_match" ? "MATCHED" : result.decision === "ambiguous" ? "AMBIGUOUS" : "PENDING";
      const obs = await prisma.externalTrackObservation.create({
        data: {
          source: snapshot.source,
          sourceType: "chart",
          sourceTrackId: entry.providerExternalId,
          rawTitle: entry.title as string,
          rawArtists: splitArtists(entry.artist),
          rawAlbum: entry.album,
          rawIsrc: entry.isrc,
          rawDurationMs: entry.durationMs,
          rawReleaseDate: entry.releaseDate ? new Date(entry.releaseDate) : undefined,
          territory: snapshot.territory,
          genre: entry.genre,
          observedAt: new Date(opts.capturedAt),
          rawMetadata: { artworkUrl: entry.artworkUrl ?? null },
          matchStatus,
          matchedUniversalTrackId: result.decision === "auto_match" ? result.match?.id : undefined,
          matchConfidence: result.confidence,
          matchMethod: result.method,
          matchReasons: result.reasons,
        },
        select: { id: true },
      });

      let promotedChartEntryId: string | undefined;
      if (result.decision === "auto_match" && result.match) {
        const ce = await prisma.chartEntry.create({
          data: {
            snapshotId: snap.id,
            universalTrackId: result.match.id,
            rank: entry.rank,
            previousRank: entry.previousRank,
            providerExternalId: entry.providerExternalId,
            matchConfidence: result.confidence,
          },
          select: { id: true },
        });
        promotedChartEntryId = ce.id;
      }

      await prisma.chartObservationEntry.create({
        data: {
          chartSnapshotId: snap.id,
          externalTrackObservationId: obs.id,
          rank: entry.rank,
          previousRank: entry.previousRank,
          sourceExternalId: entry.providerExternalId,
          rawEntryMetadata: { genre: entry.genre ?? null },
          matchStatus,
          matchedUniversalTrackId: result.decision === "auto_match" ? result.match?.id : undefined,
          promotedChartEntryId,
        },
      });
    }

    await prisma.musicIngestionRun.update({
      where: { id: run.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(opts.capturedAt),
        fetchedCount: fetched,
        matchedCount: decisions.auto_match,
        ambiguousCount: decisions.ambiguous,
        unresolvedCount: decisions.unresolved,
        rejectedCount: invalid,
        createdSnapshotCount: 1,
      },
    });
  }

  return {
    mode: apply ? "apply" : "dry-run",
    source: snapshot.source,
    chartType: snapshot.chartType,
    territory: snapshot.territory,
    editionUid,
    sourcePayloadHash: opts.sourcePayloadHash,
    snapshotAction,
    fetched,
    parsed: fetched,
    valid: validEntries.length,
    invalid,
    duplicateEntries,
    autoMatched: decisions.auto_match,
    ambiguous: decisions.ambiguous,
    unresolved: decisions.unresolved,
    createdSnapshots: willCreate ? 1 : 0,
    createdObservations: willCreate ? validEntries.length : 0,
    promotedChartEntries: willCreate ? decisions.auto_match : 0,
    confidence,
    sampleMatches: resolved.slice(0, 10).map(({ entry, result }) => ({
      rank: entry.rank,
      title: entry.title as string,
      artist: entry.artist ?? "",
      decision: result.decision,
      confidence: result.confidence,
      reasons: result.reasons,
      universalTrackId: result.match?.id,
    })),
    ingestionRunId,
  };
}
