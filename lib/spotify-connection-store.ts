/**
 * Stage 6E-A — Prisma-backed Spotify OAuth connection store + config.
 *
 * Scope: read playlist tracklists ONLY. The stored token is used solely to call
 * `GET /v1/playlists/{id}` + `/tracks` when Client Credentials returns
 * `playlist_blocked`. No Spotify URL is persisted as playback, no audio is
 * downloaded, no playback originates from Spotify.
 *
 * Connection is per-User (one human = one Spotify account), shared across every
 * workspace that user belongs to. Tokens are AES-256-GCM encrypted at rest via
 * `lib/spotify-crypto`; plaintext never leaves this module.
 *
 * Node runtime only (Prisma + Node crypto). Never import from middleware/Edge.
 */

import { prisma } from "@/lib/prisma";
import {
  decryptSpotifyTokenBlob,
  encryptSpotifyTokenBlob,
  isSpotifyCryptoConfigured,
} from "@/lib/spotify-crypto";

/** Minimum scopes — read-only playlist access. Never request more (Stage 6E-A). */
export const SPOTIFY_SCOPES = ["playlist-read-private", "playlist-read-collaborative"] as const;
export const SPOTIFY_SCOPE_STRING = SPOTIFY_SCOPES.join(" ");

export const SPOTIFY_AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
export const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_ME_URL = "https://api.spotify.com/v1/me";

/** Refresh this many ms before the stored expiry to avoid mid-request 401s. */
const EXPIRY_SKEW_MS = 60_000;

export function getSpotifyOauthClient(): { clientId: string; clientSecret: string } | null {
  const clientId = (process.env.SPOTIFY_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.SPOTIFY_CLIENT_SECRET ?? "").trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/**
 * The redirect URI MUST be byte-identical between `/start` and `/callback` and
 * MUST be pre-registered in the Spotify dashboard. Prefer the explicit env var;
 * fall back to deriving it from the incoming request origin for local dev
 * (`http://127.0.0.1:3000/...`, which Spotify allows over plain HTTP).
 */
export function resolveSpotifyRedirectUri(requestOrigin: string): string | null {
  const fromEnv = (process.env.SPOTIFY_REDIRECT_URI ?? "").trim();
  if (fromEnv) return fromEnv;
  const origin = (requestOrigin ?? "").trim().replace(/\/+$/, "");
  if (origin) return `${origin}/api/auth/spotify/callback`;
  return null;
}

type StoredTokens = { accessToken: string; refreshToken: string };

function basicAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

export async function exchangeSpotifyAuthCode(opts: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<
  | { ok: true; accessToken: string; refreshToken: string; expiresInSec: number; scope: string }
  | { ok: false }
> {
  const client = getSpotifyOauthClient();
  if (!client) return { ok: false };
  const res = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(client.clientId, client.clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: opts.code,
      redirect_uri: opts.redirectUri,
      code_verifier: opts.codeVerifier,
    }).toString(),
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (!res.ok) return { ok: false };
  const data = (await res.json()) as {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
    scope?: unknown;
  };
  if (typeof data.access_token !== "string" || typeof data.refresh_token !== "string") {
    return { ok: false };
  }
  return {
    ok: true,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresInSec: typeof data.expires_in === "number" ? data.expires_in : 3600,
    scope: typeof data.scope === "string" ? data.scope : "",
  };
}

export async function fetchSpotifyProfile(
  accessToken: string,
): Promise<{ id: string; displayName: string | null } | null> {
  const res = await fetch(SPOTIFY_ME_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { id?: unknown; display_name?: unknown };
  if (typeof data.id !== "string") return null;
  return {
    id: data.id,
    displayName: typeof data.display_name === "string" ? data.display_name : null,
  };
}

export async function saveSpotifyConnection(opts: {
  userId: string;
  spotifyUserId: string;
  spotifyDisplayName: string | null;
  accessToken: string;
  refreshToken: string;
  scope: string;
  expiresAt: Date;
}): Promise<void> {
  const { ciphertext, iv } = encryptSpotifyTokenBlob(
    JSON.stringify({ accessToken: opts.accessToken, refreshToken: opts.refreshToken } satisfies StoredTokens),
  );
  const common = {
    spotifyUserId: opts.spotifyUserId,
    spotifyDisplayName: opts.spotifyDisplayName,
    encryptedTokenBlob: ciphertext,
    tokenIv: iv,
    scope: opts.scope,
    expiresAt: opts.expiresAt,
  };
  await prisma.spotifyConnection.upsert({
    where: { userId: opts.userId },
    create: { userId: opts.userId, ...common },
    update: common,
  });
}

export async function deleteSpotifyConnection(userId: string): Promise<void> {
  await prisma.spotifyConnection.deleteMany({ where: { userId } });
}

export type SpotifyConnectionStatus = {
  connected: boolean;
  spotifyDisplayName?: string | null;
  scope?: string;
  expiresAt?: string;
};

export async function getSpotifyConnectionStatus(userId: string): Promise<SpotifyConnectionStatus> {
  const row = await prisma.spotifyConnection.findUnique({ where: { userId } });
  if (!row) return { connected: false };
  return {
    connected: true,
    spotifyDisplayName: row.spotifyDisplayName,
    scope: row.scope,
    expiresAt: row.expiresAt.toISOString(),
  };
}

async function refreshSpotifyAccessToken(
  refreshToken: string,
): Promise<
  | { ok: true; accessToken: string; refreshToken?: string; expiresInSec: number; scope?: string }
  | { ok: false; reason: "invalid_grant" | "transient" }
> {
  const client = getSpotifyOauthClient();
  if (!client) return { ok: false, reason: "transient" };
  let res: Response;
  try {
    res = await fetch(SPOTIFY_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: basicAuthHeader(client.clientId, client.clientSecret),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }).toString(),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
  } catch {
    return { ok: false, reason: "transient" };
  }
  /** Spotify returns 400 `invalid_grant` when the refresh token was revoked. */
  if (res.status === 400 || res.status === 401) return { ok: false, reason: "invalid_grant" };
  if (!res.ok) return { ok: false, reason: "transient" };
  const data = (await res.json()) as {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
    scope?: unknown;
  };
  if (typeof data.access_token !== "string") return { ok: false, reason: "transient" };
  return {
    ok: true,
    accessToken: data.access_token,
    refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : undefined,
    expiresInSec: typeof data.expires_in === "number" ? data.expires_in : 3600,
    scope: typeof data.scope === "string" ? data.scope : undefined,
  };
}

export type ValidTokenResult =
  | { status: "ok"; accessToken: string; scope: string }
  | { status: "none" }
  | { status: "needs_reauth" }
  | { status: "not_configured" };

/**
 * Resolve a usable access token for the user, refreshing opportunistically.
 * `none` = user never connected; `needs_reauth` = refresh token revoked or the
 * encryption key changed (UI surfaces "Reconnect Spotify"); `not_configured` =
 * the encryption key env var is missing.
 */
export async function getValidSpotifyAccessToken(userId: string): Promise<ValidTokenResult> {
  if (!isSpotifyCryptoConfigured()) return { status: "not_configured" };
  const row = await prisma.spotifyConnection.findUnique({ where: { userId } });
  if (!row) return { status: "none" };

  let tokens: StoredTokens;
  try {
    tokens = JSON.parse(
      decryptSpotifyTokenBlob(Buffer.from(row.encryptedTokenBlob), Buffer.from(row.tokenIv)),
    ) as StoredTokens;
  } catch {
    /** Key rotated / blob tampered → force a clean reconnect. */
    return { status: "needs_reauth" };
  }
  if (!tokens?.accessToken || !tokens?.refreshToken) return { status: "needs_reauth" };

  if (row.expiresAt.getTime() > Date.now() + EXPIRY_SKEW_MS) {
    return { status: "ok", accessToken: tokens.accessToken, scope: row.scope };
  }

  const refreshed = await refreshSpotifyAccessToken(tokens.refreshToken);
  if (!refreshed.ok) {
    if (refreshed.reason === "invalid_grant") return { status: "needs_reauth" };
    /** Transient upstream failure: the stored token may still be valid briefly. */
    return { status: "ok", accessToken: tokens.accessToken, scope: row.scope };
  }
  const nextScope = refreshed.scope ?? row.scope;
  await saveSpotifyConnection({
    userId,
    spotifyUserId: row.spotifyUserId,
    spotifyDisplayName: row.spotifyDisplayName,
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken ?? tokens.refreshToken,
    scope: nextScope,
    expiresAt: new Date(Date.now() + refreshed.expiresInSec * 1000),
  });
  return { status: "ok", accessToken: refreshed.accessToken, scope: nextScope };
}
