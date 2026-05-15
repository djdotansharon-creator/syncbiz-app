/**
 * Stage 6E-A — Spotify OAuth redirect handler.
 *
 * Validates the CSRF `state` cookie, exchanges the auth code (with the PKCE
 * verifier) for tokens, reads `/v1/me` for the display name, and persists an
 * encrypted connection bound to the SESSION user. A leaked `code` cannot be
 * redeemed against a different account because the session is resolved here,
 * server-side, before anything is written.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";
import {
  exchangeSpotifyAuthCode,
  fetchSpotifyProfile,
  resolveSpotifyRedirectUri,
  saveSpotifyConnection,
} from "@/lib/spotify-connection-store";
import { isSpotifyCryptoConfigured } from "@/lib/spotify-crypto";

export const runtime = "nodejs";

const STATE_COOKIE = "sb_spotify_oauth_state";
const VERIFIER_COOKIE = "sb_spotify_oauth_verifier";

function clearOauthCookies(res: NextResponse): void {
  for (const name of [STATE_COOKIE, VERIFIER_COOKIE]) {
    res.cookies.set(name, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 0,
      path: "/api/auth/spotify",
    });
  }
}

function redirectWith(req: NextRequest, status: string): NextResponse {
  const res = NextResponse.redirect(new URL(`/sources?spotify=${status}`, req.url));
  clearOauthCookies(res);
  return res;
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUserFromCookies();
  if (!user) {
    const login = new URL("/login", req.url);
    login.searchParams.set("from", "/sources");
    return NextResponse.redirect(login);
  }

  const url = req.nextUrl;
  const errorParam = url.searchParams.get("error");
  if (errorParam) {
    /** User clicked "Cancel" on Spotify's consent screen. */
    return redirectWith(req, "denied");
  }

  const code = (url.searchParams.get("code") ?? "").trim();
  const stateFromQuery = (url.searchParams.get("state") ?? "").trim();
  const stateFromCookie = (req.cookies.get(STATE_COOKIE)?.value ?? "").trim();
  const verifier = (req.cookies.get(VERIFIER_COOKIE)?.value ?? "").trim();

  if (!code || !stateFromQuery || !stateFromCookie || stateFromQuery !== stateFromCookie || !verifier) {
    return redirectWith(req, "state_error");
  }
  if (!isSpotifyCryptoConfigured()) {
    return redirectWith(req, "not_configured");
  }
  const redirectUri = resolveSpotifyRedirectUri(url.origin);
  if (!redirectUri) {
    return redirectWith(req, "not_configured");
  }

  const exchanged = await exchangeSpotifyAuthCode({ code, codeVerifier: verifier, redirectUri });
  if (!exchanged.ok) {
    return redirectWith(req, "exchange_failed");
  }

  const profile = await fetchSpotifyProfile(exchanged.accessToken);
  if (!profile) {
    return redirectWith(req, "profile_failed");
  }

  try {
    await saveSpotifyConnection({
      userId: user.id,
      spotifyUserId: profile.id,
      spotifyDisplayName: profile.displayName,
      accessToken: exchanged.accessToken,
      refreshToken: exchanged.refreshToken,
      scope: exchanged.scope,
      expiresAt: new Date(Date.now() + exchanged.expiresInSec * 1000),
    });
  } catch {
    return redirectWith(req, "save_failed");
  }

  return redirectWith(req, "connected");
}
