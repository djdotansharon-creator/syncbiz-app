import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";
import { mintMediaSessionToken, mediaTokenDefaultTtlSec } from "@/lib/media/media-token";
import { allPreviewGenreIds, pocMediaFallbackAllowed } from "@/lib/media/media-assets";
import { getReadyMediaAssetGenreIds } from "@/lib/media/media-asset-db";

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
export async function POST(req: NextRequest) {
  const user = await getCurrentUserFromCookies();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

  let body: { deviceId?: string } = {};
  try { body = await req.json(); } catch { /* body is optional */ }

  const dbGenres = await getReadyMediaAssetGenreIds();
  const pocGenres = pocMediaFallbackAllowed() ? allPreviewGenreIds() : [];
  const allowedGenres = [...new Set([...dbGenres, ...pocGenres])];
  if (allowedGenres.length === 0) {
    return NextResponse.json({ error: "No media catalog is available on this server." }, { status: 503 });
  }

  const deviceId =
    typeof body.deviceId === "string" && body.deviceId.trim() ? body.deviceId.trim().slice(0, 64) : "web-preview";
  const workspaceId = String(user.id ?? "unknown"); // POC scope record (not a DB-enforced claim yet)

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
