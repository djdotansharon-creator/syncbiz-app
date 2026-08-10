/**
 * Phase B0.5 — pure chart-ingestion helpers (idempotency + promotion).
 *
 * No provider, no network, no DB. These make chart re-ingestion deterministic and
 * describe how a raw ChartObservationEntry is promoted to a canonical ChartEntry.
 * Unit-tested via scripts/check-universal-resolver.ts.
 */

import crypto from "node:crypto";
import type { ChartTypeName } from "@/lib/universal/music-intelligence";

export interface ChartEditionKeyParts {
  source: string;
  chartType: ChartTypeName;
  territory?: string | null;
  city?: string | null;
  genre?: string | null;
  editionKey?: string | null;
}

/**
 * Deterministic, NULL-safe dedupe key for a ChartSnapshot edition. Re-ingesting the SAME
 * edition (regardless of capturedAt) yields the same uid → the unique index upserts one
 * snapshot. Discriminators fall back to sentinels so NULLs never collide-distinct.
 */
export function buildChartEditionUid(p: ChartEditionKeyParts): string {
  const norm = (v: string | null | undefined, fallback: string) =>
    ((v ?? "").trim().toLowerCase() || fallback).replace(/::/g, ":");
  return [
    norm(p.source, "unknown"),
    norm(p.chartType, "unknown"),
    norm(p.territory, "global"),
    norm(p.city, "-"),
    norm(p.genre, "-"),
    norm(p.editionKey, "-"),
  ].join("::");
}

/** Stable SHA-256 hash of a raw provider payload — a retry with the same payload is a no-op. */
export function buildSourcePayloadHash(payload: unknown): string {
  const json = typeof payload === "string" ? payload : JSON.stringify(payload);
  return crypto.createHash("sha256").update(json).digest("hex");
}

/** Raw chart row shape needed to promote to a ChartEntry (subset of ChartObservationEntry). */
export interface ChartObservationLike {
  rank: number;
  previousRank?: number | null;
  peakRank?: number | null;
  daysOnChart?: number | null;
  sourceExternalId?: string | null;
  matchedUniversalTrackId?: string | null;
  matchConfidence?: number | null;
}

/** Canonical ChartEntry input produced when an observation is safely matched. */
export interface PromotedChartEntryData {
  rank: number;
  previousRank: number | null;
  peakRank: number | null;
  daysOnChart: number | null;
  providerExternalId: string | null;
  universalTrackId: string | null;
  matchConfidence: number | null;
}

/**
 * Map a matched ChartObservationEntry to the data for a canonical ChartEntry. The raw
 * observation row is NEVER deleted; this only produces the promoted projection.
 */
export function promoteObservationToChartEntryData(obs: ChartObservationLike): PromotedChartEntryData {
  return {
    rank: obs.rank,
    previousRank: obs.previousRank ?? null,
    peakRank: obs.peakRank ?? null,
    daysOnChart: obs.daysOnChart ?? null,
    providerExternalId: obs.sourceExternalId ?? null,
    universalTrackId: obs.matchedUniversalTrackId ?? null,
    matchConfidence: obs.matchConfidence ?? null,
  };
}
