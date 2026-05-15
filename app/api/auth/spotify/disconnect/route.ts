/**
 * Stage 6E-A — disconnect (forget) the current user's Spotify connection.
 *
 * Spotify exposes no public token-revocation endpoint, so this is a local
 * delete: the encrypted blob is removed and future blocked playlists fall back
 * to the existing Client-Credentials → paste-tracklist path. Same-origin check
 * plus the HttpOnly SameSite=Lax session cookie give CSRF protection.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";
import { deleteSpotifyConnection } from "@/lib/spotify-connection-store";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const user = await getCurrentUserFromCookies();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== req.nextUrl.host) {
        return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ error: "Bad origin" }, { status: 403 });
    }
  }
  await deleteSpotifyConnection(user.id);
  return NextResponse.json({ ok: true });
}
