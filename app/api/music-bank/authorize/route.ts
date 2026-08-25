import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";
import { mintMediaSessionToken, mediaTokenDefaultTtlSec } from "@/lib/media/media-token";
import { allPreviewGenreIds } from "@/lib/media/media-assets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Stage A — mint a scoped, short-lived Media Session Token for Music Bank PREVIEW streaming.
 * Requires an authenticated SyncBiz session (cookie). The scope (allowed genres) is server-authoritative,
 * derived from the preview asset map — the client can never widen it. The token is returned to the
 * client to hold IN MEMORY only and append to `/api/media/<assetId>` at playback time.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUserFromCookies();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

  let body: { deviceId?: string } = {};
  try { body = await req.json(); } catch { /* body is optional */ }

  const allowedGenres = allPreviewGenreIds();
  if (allowedGenres.length === 0) {
    return NextResponse.json({ error: "No preview catalog is available on this server." }, { status: 503 });
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
