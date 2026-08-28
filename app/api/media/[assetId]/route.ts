import { NextRequest, NextResponse } from "next/server";
import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import { verifyMediaSessionToken } from "@/lib/media/media-token";
import { getMediaAsset, resolveLocalPreviewPath } from "@/lib/media/media-assets";
import { getMediaAssetFromDb, isObjectStorageProvider } from "@/lib/media/media-asset-db";
import { getR2Config, presignGet, r2PresignTtlSec } from "@/lib/media/r2-presign";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Stage A — SyncBiz-owned Music Bank media transport (PREVIEW). Per request, ONLY:
 *   1. verify the media session token (HMAC, SYNCBIZ_MEDIA_SECRET) — no DB,
 *   2. look up the asset in the in-memory map — no Prisma / no Drive metadata discovery,
 *   3. scope check (asset genre ∈ token.allowedGenres),
 *   4. stream bytes with HTTP Range (POC provider = local preview cache; drive/r2/s3 plug in later).
 * Streaming only — never buffers the whole file. Multi-range not supported (single range only).
 */

/**
 * The in-memory preview-cache streaming path is a DEV/TEST convenience only. In production the DB
 * MediaAsset is the ONE source of playable media — an unknown / non-READY / non-object-storage asset
 * must fail closed, never serve local bytes. Hard off when NODE_ENV=production (no env can re-enable
 * it in prod); in dev it is on unless explicitly disabled. This makes the invariant explicit rather
 * than relying on the cache directory happening to be absent from a deploy.
 */
function pocMediaFallbackAllowed(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return process.env.SYNCBIZ_MEDIA_POC_FALLBACK !== "0";
}

type ParsedRange = { start: number; end: number };

function parseRange(header: string | null, size: number): ParsedRange | null | "invalid" {
  if (!header) return null; // no Range → full content
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return "invalid";
  const [, s, e] = m;
  if (s === "" && e === "") return "invalid";
  let start: number;
  let end: number;
  if (s === "") {
    const n = parseInt(e, 10); // suffix: last N bytes
    if (!Number.isFinite(n) || n <= 0) return "invalid";
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = parseInt(s, 10);
    end = e === "" ? size - 1 : parseInt(e, 10);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "invalid";
  if (start < 0 || start > end || start >= size) return "invalid"; // → 416
  if (end >= size) end = size - 1;
  return { start, end };
}

async function handle(req: NextRequest, assetId: string, isHead: boolean): Promise<Response> {
  // Fail closed on server misconfig: a missing/short media secret is a 503 (never an unclear 500,
  // never a 401 that reads as a client problem).
  const secret = process.env.SYNCBIZ_MEDIA_SECRET;
  if (!secret || secret.length < 16) {
    return NextResponse.json({ error: "media transport not configured" }, { status: 503 });
  }

  const token = req.nextUrl.searchParams.get("mt") ?? "";
  const claims = verifyMediaSessionToken(token);
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const allowPoc = pocMediaFallbackAllowed();

  // ── Production path: the DB MediaAsset is the source of truth. Provider/bucket/objectKey come from
  //    HERE (server-authoritative) — NEVER from client input. Only a READY asset is ever served. ──
  const dbAsset = await getMediaAssetFromDb(assetId);
  if (dbAsset) {
    if (dbAsset.status !== "READY") {
      return NextResponse.json({ error: "not found" }, { status: 404 }); // non-READY: 404 hides state
    }
    if (!dbAsset.genreId || !claims.allowedGenres.includes(dbAsset.genreId)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (isObjectStorageProvider(dbAsset.provider)) {
      const noStore = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
      if (isHead) {
        // HEAD → metadata only, no signed URL minted.
        return new NextResponse(null, { status: 200, headers: {
          ...noStore, "Content-Type": dbAsset.mimeType, "Accept-Ranges": "bytes", "Content-Length": String(dbAsset.sizeBytes),
        } });
      }
      const cfg = getR2Config();
      if (!cfg) return NextResponse.json({ error: "storage not configured" }, { status: 503 }); // no creds → fail closed
      let signed: string;
      try {
        signed = presignGet(cfg, dbAsset.bucket, dbAsset.objectKey, r2PresignTtlSec());
      } catch {
        return NextResponse.json({ error: "storage unavailable" }, { status: 503 }); // presign fault → fail closed, never insecure
      }
      // 302 → short-lived signed R2 URL. MPV follows the redirect internally and streams Range/206 from
      // the edge. CONTROL never sees this URL; it never enters WS / PlaylistTrack / our logs (redacted).
      return new NextResponse(null, { status: 302, headers: { ...noStore, Location: signed } });
    }
    // READY but a non-object-storage provider (LOCAL_PREVIEW): servable ONLY via the dev/test POC path.
    // In production there are no local bytes to serve → fail closed, never fall through.
    if (!allowPoc) return NextResponse.json({ error: "not found" }, { status: 404 });
  } else if (!allowPoc) {
    // Not a MediaAsset at all. In production the DB is authoritative — never consult the POC cache.
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // ── POC / dev-test fallback: in-memory preview-cache manifest (unchanged, streams local bytes).
  //    Unreachable in production (gated above); reaching here means allowPoc === true. ──
  const asset = getMediaAsset(assetId);
  if (!asset) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (!claims.allowedGenres.includes(asset.genreId)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const abs = resolveLocalPreviewPath(asset);
  if (!abs) return NextResponse.json({ error: "asset unavailable" }, { status: 404 });
  let size: number;
  try { size = statSync(abs).size; } catch { return NextResponse.json({ error: "asset unavailable" }, { status: 404 }); }

  const common: Record<string, string> = {
    "Content-Type": asset.mimeType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    // Do not leak the tokenized URL via Referer (relevant only to the browser <audio> path; MPV sends none).
    "Referrer-Policy": "no-referrer",
  };

  const range = parseRange(req.headers.get("range"), size);

  if (range === "invalid") {
    return new NextResponse(null, { status: 416, headers: { ...common, "Content-Range": `bytes */${size}` } });
  }

  if (range === null) {
    const headers = { ...common, "Content-Length": String(size) };
    if (isHead) return new NextResponse(null, { status: 200, headers });
    return new NextResponse(Readable.toWeb(createReadStream(abs)) as unknown as BodyInit, { status: 200, headers });
  }

  const { start, end } = range;
  const headers = {
    ...common,
    "Content-Length": String(end - start + 1),
    "Content-Range": `bytes ${start}-${end}/${size}`,
  };
  if (isHead) return new NextResponse(null, { status: 206, headers });
  return new NextResponse(Readable.toWeb(createReadStream(abs, { start, end })) as unknown as BodyInit, { status: 206, headers });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ assetId: string }> }): Promise<Response> {
  const { assetId } = await ctx.params;
  return handle(req, assetId, false);
}

export async function HEAD(req: NextRequest, ctx: { params: Promise<{ assetId: string }> }): Promise<Response> {
  const { assetId } = await ctx.params;
  return handle(req, assetId, true);
}
