/**
 * DB-backed MediaAsset resolver — the production source of truth for /api/media (Phase 3).
 * The route trusts ONLY this: an asset must exist in the DB and be READY before any storage access.
 * Provider/bucket/objectKey come from here (server-authoritative), never from client input.
 */
import { prisma } from "@/lib/prisma";

export type DbMediaAsset = {
  id: string;
  status: "PENDING" | "READY" | "RETIRED" | "FAILED";
  genreId: string | null;
  provider: "R2" | "S3" | "B2" | "LOCAL_PREVIEW";
  bucket: string;
  objectKey: string;
  mimeType: string;
  sizeBytes: bigint;
};

/** Look up a MediaAsset by its public id. Returns null if absent OR the DB is unreachable (caller
 *  then falls through to the POC manifest path, or fails closed). Never throws. */
export async function getMediaAssetFromDb(id: string): Promise<DbMediaAsset | null> {
  try {
    const a = await prisma.mediaAsset.findUnique({
      where: { id },
      select: { id: true, status: true, genreId: true, provider: true, bucket: true, objectKey: true, mimeType: true, sizeBytes: true },
    });
    return (a as DbMediaAsset | null) ?? null;
  } catch {
    return null;
  }
}

/** R2/S3/B2 are served via a presigned redirect; LOCAL_PREVIEW streams from disk (dev/POC). */
export function isObjectStorageProvider(p: string): boolean {
  return p === "R2" || p === "S3" || p === "B2";
}
