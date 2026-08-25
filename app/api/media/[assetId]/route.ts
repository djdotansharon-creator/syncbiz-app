import { NextRequest, NextResponse } from "next/server";
import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import { verifyMediaSessionToken } from "@/lib/media/media-token";
import { getMediaAsset, resolveLocalPreviewPath } from "@/lib/media/media-assets";

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
  const token = req.nextUrl.searchParams.get("mt") ?? "";
  const claims = verifyMediaSessionToken(token);
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

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
