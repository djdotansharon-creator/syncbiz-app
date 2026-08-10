import type { PrismaClient } from "@prisma/client";
import { normalizeTitle, versionTypeFromTitle } from "./normalize";

/**
 * THE single path to reuse-or-create a UniversalTrack (a Recording).
 *
 * Principle — IDENTITY ≠ SELECTION, and False Duplicate > False Merge:
 *   Reuse an existing UniversalTrack ONLY on a STRONG identifier —
 *     1) same provider + same externalId (the same asset already mapped), or
 *     2) the same ISRC (cross-source recording identity).
 *   Otherwise CREATE a NEW Recording. Never reuse/merge by title or versionType.
 *
 * `normalizedTitle` is stored only as a field for later Candidate SUGGESTION (never a match key here);
 * `versionType` (from `versionTypeFromTitle`) is CLASSIFICATION metadata, never an identity key
 * (two REMIX rows are not necessarily the same remix). No fuzzy/title auto-merge happens here.
 *
 * Callers (recommend / bank ingest / imports / any future source) MUST route through this so no site
 * invents its own dedup rule. It does NOT create the ProviderMapping — the caller owns that.
 */
export async function ensureUniversalTrackId(
  prisma: PrismaClient,
  input: {
    provider?: string;
    externalId?: string;
    isrc?: string | null;
    title: string;
    durationMs?: number | null;
  },
): Promise<{ universalTrackId: string; created: boolean; method: "provider_external_id" | "isrc" | "created" }> {
  // 1) Strong: same provider + same externalId.
  if (input.provider && input.externalId) {
    const m = await prisma.providerMapping.findFirst({
      where: { provider: input.provider, externalId: input.externalId },
      select: { universalTrackId: true },
    });
    if (m?.universalTrackId) return { universalTrackId: m.universalTrackId, created: false, method: "provider_external_id" };
  }

  // 2) Strong: ISRC.
  const isrc = input.isrc?.trim().toUpperCase() || null;
  if (isrc) {
    const t = await prisma.universalTrack.findUnique({ where: { canonicalIsrc: isrc }, select: { id: true } });
    if (t) return { universalTrackId: t.id, created: false, method: "isrc" };
  }

  // 3) No strong identity → a NEW Recording (never merge by title).
  const created = await prisma.universalTrack.create({
    data: {
      displayTitle: input.title,
      normalizedTitle: normalizeTitle(input.title),
      durationMs: input.durationMs ?? null,
      versionType: versionTypeFromTitle(input.title),
      ...(isrc ? { canonicalIsrc: isrc } : {}),
    },
    select: { id: true },
  });
  return { universalTrackId: created.id, created: true, method: "created" };
}
