/**
 * Stage 6E-A — Spotify connection status for the current session user.
 *
 * Lightweight read used by the Settings card and the blocked-playlist panel.
 * Never returns tokens. Does not perform a network refresh — true revocation
 * is surfaced at use time by the preview route.
 */

import { NextResponse } from "next/server";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";
import { getSpotifyConnectionStatus } from "@/lib/spotify-connection-store";
import { isSpotifyCryptoConfigured } from "@/lib/spotify-crypto";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUserFromCookies();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const status = await getSpotifyConnectionStatus(user.id);
  return NextResponse.json({
    ...status,
    /** When the encryption key is absent we cannot decrypt stored tokens → reconnect won't help until configured. */
    cryptoConfigured: isSpotifyCryptoConfigured(),
  });
}
