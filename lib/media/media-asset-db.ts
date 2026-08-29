/**
 * DB-backed MediaAsset resolver — the production source of truth for /api/media (Phase 3 / 3.6).
 * The route trusts ONLY this: an asset must exist in the DB and be READY before any storage access.
 * Provider/bucket/objectKey come from here (server-authoritative), never from client input.
 *
 * Resolution is by LOGICAL id (the stable public id in /api/media/<logicalId>), returning the single
 * READY physical version. This is what makes content replacement safe: the old version is RETIRED and a
 * new one becomes READY under the SAME logicalId, so the URL / playlist / catalog never change.
 */
import { prisma } from "@/lib/prisma";

export type DbMediaAsset = {
  id: string; // physical version row id (internal)
  logicalId: string | null;
  status: "PENDING" | "READY" | "RETIRED" | "FAILED";
  genreId: string | null;
  provider: "R2" | "S3" | "B2" | "LOCAL_PREVIEW";
  bucket: string;
  objectKey: string;
  mimeType: string;
  sizeBytes: bigint;
};

/**
 * Resolve the currently-READY physical version for a LOGICAL asset id (the value in /api/media/<id>).
 * Returns null if there is no READY version (unknown id, or only PENDING/RETIRED/FAILED exist) OR the
 * DB is unreachable — the caller then fails closed (prod) or falls through to the POC path (dev). A
 * partial-unique index guarantees at most one READY per logicalId; orderBy(updatedAt desc) is a
 * belt-and-suspenders tiebreak so resolution is always deterministic. Never throws.
 */
export async function getMediaAssetFromDb(logicalId: string): Promise<DbMediaAsset | null> {
  try {
    const a = await prisma.mediaAsset.findFirst({
      where: { logicalId, status: "READY" },
      orderBy: { updatedAt: "desc" },
      select: { id: true, logicalId: true, status: true, genreId: true, provider: true, bucket: true, objectKey: true, mimeType: true, sizeBytes: true },
    });
    return (a as DbMediaAsset | null) ?? null;
  } catch {
    return null;
  }
}

/**
 * Distinct genre-pack ids that have at least one READY MediaAsset. This is the PRODUCTION source of
 * truth for a media-token's allowedGenres scope — derived only from what is actually playable in prod,
 * never from the POC preview-cache manifest. Returns [] on error (authorize then fails closed → 503).
 */
export async function getReadyMediaAssetGenreIds(): Promise<string[]> {
  try {
    const rows = await prisma.mediaAsset.findMany({
      where: { status: "READY", genreId: { not: null } },
      distinct: ["genreId"],
      select: { genreId: true },
    });
    return rows.map((r) => r.genreId).filter((g): g is string => !!g);
  } catch {
    return [];
  }
}

/** R2/S3/B2 are served via a presigned redirect; LOCAL_PREVIEW streams from disk (dev/POC). */
export function isObjectStorageProvider(p: string): boolean {
  return p === "R2" || p === "S3" || p === "B2";
}
