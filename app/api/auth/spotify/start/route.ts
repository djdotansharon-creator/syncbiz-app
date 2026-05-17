/**
 * Stage 6E-A — begin the Spotify Authorization-Code (PKCE) flow.
 *
 * Requires an authenticated SyncBiz session. Generates a CSRF `state` and a
 * PKCE verifier, stashes both in short-lived HttpOnly cookies, then 302s to
 * Spotify's consent screen requesting only the two read-only playlist scopes.
 * The connection is bound to the SESSION user at /callback time.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";
import { codeChallengeS256, generateCodeVerifier, generateOauthState } from "@/lib/spotify-pkce";
import {
  SPOTIFY_AUTHORIZE_URL,
  SPOTIFY_SCOPE_STRING,
  getSpotifyOauthClient,
  resolveSpotifyRedirectUri,
} from "@/lib/spotify-connection-store";

export const runtime = "nodejs";

const STATE_COOKIE = "sb_spotify_oauth_state";
const VERIFIER_COOKIE = "sb_spotify_oauth_verifier";
const OAUTH_COOKIE_TTL_SEC = 600; // 10 minutes — the whole consent round-trip

export async function GET(req: NextRequest) {
  const user = await getCurrentUserFromCookies();
  if (!user) {
    const login = new URL("/login", req.url);
    login.searchParams.set("from", "/sources");
    return NextResponse.redirect(login);
  }

  const client = getSpotifyOauthClient();
  if (!client) {
    return NextResponse.redirect(new URL("/sources?spotify=not_configured", req.url));
  }
  const redirectUri = resolveSpotifyRedirectUri(req.nextUrl.origin);
  if (!redirectUri) {
    return NextResponse.redirect(new URL("/sources?spotify=not_configured", req.url));
  }

  const state = generateOauthState();
  const verifier = generateCodeVerifier();
  const challenge = codeChallengeS256(verifier);

  const authorize = new URL(SPOTIFY_AUTHORIZE_URL);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", client.clientId);
  authorize.searchParams.set("scope", SPOTIFY_SCOPE_STRING);
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("code_challenge_method", "S256");
  authorize.searchParams.set("code_challenge", challenge);

  const res = NextResponse.redirect(authorize);
  /**
   * SameSite=Lax (NOT Strict): the callback navigation is a top-level GET
   * initiated by accounts.spotify.com (a different site), so Strict would drop
   * these cookies and the round-trip would always fail state validation.
   */
  const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: OAUTH_COOKIE_TTL_SEC,
    path: "/api/auth/spotify",
  };
  res.cookies.set(STATE_COOKIE, state, cookieOpts);
  res.cookies.set(VERIFIER_COOKIE, verifier, cookieOpts);
  return res;
}
