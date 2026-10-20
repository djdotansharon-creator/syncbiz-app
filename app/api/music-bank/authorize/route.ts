import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";
import { mintMediaSessionToken, mediaTokenDefaultTtlSec } from "@/lib/media/media-token";
import { allPreviewGenreIds, pocMediaFallbackAllowed } from "@/lib/media/media-assets";
import { getReadyMediaAssetGenreIds } from "@/lib/media/media-asset-db";
import { verifyDesktopStationToken } from "@/lib/auth-ws-token";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Stage A/A.1 — mint a scoped, short-lived Media Session Token for Music Bank streaming.
 * Requires an authenticated SyncBiz session (cookie). The scope (allowed genres) is server-authoritative
 * — the client can never widen it.
 *
 * Scope source of truth:
 *   - PRODUCTION: genres that have at least one READY MediaAsset (real, playable, DB-backed) — NEVER the
 *     POC preview-cache manifest (which does not exist in prod).
 *   - DEV/TEST: the READY-MediaAsset genres UNIONED with the POC preview-cache genres, so the local POC
 *     A/B mode keeps working. The POC contribution is gated by pocMediaFallbackAllowed() (off in prod).
 * The token is returned to the client to hold IN MEMORY only and append to `/api/media/<logicalId>` at
 * playback time.
 */
/**
 * beta.22 — STATION media authorization: the station's Electron MAIN calls this itself with
 * `Authorization: Bearer <desktop_access>` (the signed, station-bound token MAIN already holds). The token must
 * carry the bound station id + workspace AND that station must be a registered StationDevice of that workspace.
 * The media token is returned to MAIN only (never over WS) and scoped to that station. No user cookie involved.
 */
async function stationFromBearer(req: NextRequest): Promise<{ workspaceId: string; stationDeviceId: string } | "invalid" | null> {
  const h = req.headers.get("authorization") ?? "";
  if (!/^Bearer\s+/i.test(h)) return null; // not a station request → cookie path
  const claims = verifyDesktopStationToken(h.replace(/^Bearer\s+/i, "").trim());
  if (!claims) return "invalid";
  const station = await prisma.stationDevice.findUnique({ where: { durableDeviceId: claims.stationDeviceId }, select: { workspaceId: true } });
  if (!station || station.workspaceId !== claims.workspaceId) return "invalid";
  return { workspaceId: claims.workspaceId, stationDeviceId: claims.stationDeviceId };
}

export async function POST(req: NextRequest) {
  const station = await stationFromBearer(req);
  if (station === "invalid") return NextResponse.json({ error: "Station not authorized." }, { status: 401 });
  const user = station ? null : await getCurrentUserFromCookies();
  if (!station && !user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

  let body: { deviceId?: string } = {};
  try { body = await req.json(); } catch { /* body is optional */ }

  const dbGenres = await getReadyMediaAssetGenreIds();
  const pocGenres = pocMediaFallbackAllowed() ? allPreviewGenreIds() : [];
  const allowedGenres = [...new Set([...dbGenres, ...pocGenres])];
  if (allowedGenres.length === 0) {
    return NextResponse.json({ error: "No media catalog is available on this server." }, { status: 503 });
  }

  const deviceId = station
    ? station.stationDeviceId
    : typeof body.deviceId === "string" && body.deviceId.trim() ? body.deviceId.trim().slice(0, 64) : "web-preview";
  const workspaceId = station ? station.workspaceId : String(user!.id ?? "unknown"); // POC scope record (not a DB-enforced claim yet)

  try {
    const minted = mintMediaSessionToken({ workspaceId, deviceId, accessMode: "preview", allowedGenres });
    return NextResponse.json({
      ok: true,
      token: minted.token,
      exp: minted.exp,
      ttlSec: mediaTokenDefaultTtlSec(),
      accessMode: "preview",
      allowedGenres,
    });
  } catch (e) {
    // Fail-closed when SYNCBIZ_MEDIA_SECRET is missing/short.
    console.error("[music-bank/authorize] mint failed:", e instanceof Error ? e.message : String(e));
    return NextResponse.json({ error: "Media authorization is not configured." }, { status: 503 });
  }
}
