import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromApiRequest } from "@/lib/auth-helpers";
import { mintJingleToken, jingleTokenDefaultTtlSec } from "@/lib/jingles/jingle-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * F3 — mint a short-lived, workspace-scoped Jingle Access Token.
 *
 * Requires an authenticated SyncBiz session (cookie). The workspace is ALWAYS taken from the session
 * (`user.tenantId`) — the client can never widen or spoof it. The token is returned to the client to
 * hold IN MEMORY only and append to `/api/jingles/audio/<id>` at fire time (the ONLY way the station
 * MPV, which cannot send a cookie, can authenticate the audio read). The browser preview path uses the
 * cookie directly and does not need this token.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUserFromApiRequest(req);
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  if (!user.tenantId) return NextResponse.json({ error: "No workspace." }, { status: 403 });

  try {
    const minted = mintJingleToken(user.tenantId);
    return NextResponse.json({
      ok: true,
      token: minted.token,
      exp: minted.exp,
      ttlSec: jingleTokenDefaultTtlSec(),
    });
  } catch (e) {
    // Fail-closed when SYNCBIZ_MEDIA_SECRET is missing/short.
    console.error("[jingles/authorize] mint failed:", e instanceof Error ? e.message : String(e));
    return NextResponse.json({ error: "Jingle authorization is not configured." }, { status: 503 });
  }
}
