/**
 * Node-only signed tokens for WS REGISTER and desktop HTTP API.
 * Uses Node crypto. For API routes and WS server only. NOT for Edge/middleware.
 *
 * Purposes:
 * - `ws_register` — short-lived (60s), minted by GET /api/auth/ws-token (browser session).
 * - `desktop_access` — longer-lived, minted by POST /api/auth/desktop/token (Electron email/password).
 */

import { createHmac } from "crypto";

const PURPOSE_WS_REGISTER = "ws_register";
const PURPOSE_DESKTOP_ACCESS = "desktop_access";

/** Default desktop token TTL (seconds). Override with SYNCBIZ_DESKTOP_TOKEN_TTL_SEC. */
const DEFAULT_DESKTOP_TTL_SEC = 60 * 60 * 24 * 7; // 7 days
/** Hard cap on desktop token lifetime (seconds). */
const MAX_DESKTOP_TTL_SEC = 60 * 60 * 24 * 30; // 30 days

function getSecret(): string {
  const secret = process.env.SYNCBIZ_WS_SECRET ?? process.env.WS_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("SYNCBIZ_WS_SECRET or WS_SECRET required (min 16 chars)");
  }
  return secret;
}

function signPayload(payloadB64: string): string {
  return createHmac("sha256", getSecret()).update(payloadB64).digest("base64url");
}

/**
 * Optional authoritative branch claims, computed server-side (never from the client) and embedded
 * additively in the token so the DB-less WS server can authorize the requested branch. Omitting them
 * (or minting via the legacy path) yields a token with no branch claim → the WS server restricts it
 * to "default" only.
 */
export type WsTokenClaims = {
  workspaceId?: string | null;
  authorizedBranches?: string[];
};

function mintToken(
  userId: string,
  purpose: typeof PURPOSE_WS_REGISTER | typeof PURPOSE_DESKTOP_ACCESS,
  ttlSec: number,
  claims?: WsTokenClaims,
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: {
    purpose: string;
    userId: string;
    iat: number;
    exp: number;
    workspaceId?: string;
    authorizedBranches?: string[];
  } = {
    purpose,
    userId: userId.trim(),
    iat: now,
    exp: now + ttlSec,
  };
  // Additive only — legacy consumers ignore unknown fields.
  if (claims?.workspaceId) payload.workspaceId = claims.workspaceId;
  if (Array.isArray(claims?.authorizedBranches)) payload.authorizedBranches = claims!.authorizedBranches;
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  const sig = signPayload(payloadB64);
  return `${payloadB64}.${sig}`;
}

/** Create short-lived token for WS REGISTER. Minted by GET /api/auth/ws-token. */
export function createWsToken(userId: string, claims?: WsTokenClaims): string {
  return mintToken(userId, PURPOSE_WS_REGISTER, 60, claims);
}

/**
 * Long-lived token for Electron desktop HTTP + WS (same secret as ws_register).
 * Minted by POST /api/auth/desktop/token.
 */
export function getDesktopTokenTtlSeconds(): number {
  const raw = Number(process.env.SYNCBIZ_DESKTOP_TOKEN_TTL_SEC);
  return Number.isFinite(raw) && raw > 60 && raw <= MAX_DESKTOP_TTL_SEC ? Math.floor(raw) : DEFAULT_DESKTOP_TTL_SEC;
}

export function createDesktopAccessToken(userId: string, claims?: WsTokenClaims): string {
  return mintToken(userId, PURPOSE_DESKTOP_ACCESS, getDesktopTokenTtlSeconds(), claims);
}

/**
 * Verify signed token for WS server and HTTP Bearer. Accepts `ws_register` or `desktop_access`.
 * Returns userId or null.
 */
export function verifyWsToken(token: string): string | null {
  const secret = process.env.SYNCBIZ_WS_SECRET ?? process.env.WS_SECRET;
  if (!secret || secret.length < 16) return null;
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  const expectedSig = createHmac("sha256", secret).update(payloadB64).digest("base64url");
  if (expectedSig !== sigB64) return null;
  let payload: { purpose?: string; userId?: string; iat?: number; exp?: number };
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
  } catch {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp < now) return null;
  if (typeof payload.iat !== "number" || payload.iat > now + 300) return null;

  const userId = typeof payload.userId === "string" ? payload.userId.trim() : "";
  if (!userId) return null;

  if (payload.purpose === PURPOSE_WS_REGISTER) {
    if (payload.exp > now + 120) return null;
    return userId;
  }
  if (payload.purpose === PURPOSE_DESKTOP_ACCESS) {
    if (payload.exp - payload.iat > MAX_DESKTOP_TTL_SEC) return null;
    if (payload.exp > now + MAX_DESKTOP_TTL_SEC) return null;
    return userId;
  }
  return null;
}

/** Verified claims from a `desktop_access` token. `workspaceId` is the server-signed scope the token was minted
 *  for (null if the token carries no workspace claim). */
export type DesktopAccessClaims = {
  userId: string;
  workspaceId: string | null;
  authorizedBranches: string[] | null;
};

/**
 * Full verification for `desktop_access` ONLY (rejects ws_register and every other purpose). Returns the signed
 * claims — including the token's `workspaceId` scope — or null. The signed workspaceId is authoritative: callers
 * must scope to it and re-validate DB membership, NEVER resolve the user's primary/other workspace instead.
 */
function verifyDesktopAccessPayload(token: string): DesktopAccessClaims | null {
  const secret = process.env.SYNCBIZ_WS_SECRET ?? process.env.WS_SECRET;
  if (!secret || secret.length < 16) return null;
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  const expectedSig = createHmac("sha256", secret).update(payloadB64).digest("base64url");
  if (expectedSig !== sigB64) return null;
  let payload: {
    purpose?: string;
    userId?: string;
    iat?: number;
    exp?: number;
    workspaceId?: unknown;
    authorizedBranches?: unknown;
  };
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
  } catch {
    return null;
  }
  if (payload.purpose !== PURPOSE_DESKTOP_ACCESS) return null; // ws_register / anything else → reject
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp < now) return null;
  if (typeof payload.iat !== "number" || payload.iat > now + 300) return null;
  if (payload.exp - payload.iat > MAX_DESKTOP_TTL_SEC) return null;
  if (payload.exp > now + MAX_DESKTOP_TTL_SEC) return null;
  const userId = typeof payload.userId === "string" ? payload.userId.trim() : "";
  if (!userId) return null;
  const workspaceId =
    typeof payload.workspaceId === "string" && payload.workspaceId.trim() ? payload.workspaceId.trim() : null;
  const authorizedBranches = Array.isArray(payload.authorizedBranches)
    ? (payload.authorizedBranches as string[])
    : null;
  return { userId, workspaceId, authorizedBranches };
}

/**
 * Verify a token and return userId ONLY when purpose === `desktop_access`. Rejects `ws_register` and every
 * other purpose. Compatibility API for callers that only need the userId.
 */
export function verifyDesktopAccessToken(token: string): string | null {
  return verifyDesktopAccessPayload(token)?.userId ?? null;
}

/**
 * Verify a `desktop_access` token and return its signed { userId, workspaceId }. Use this for endpoints that
 * must scope to the exact workspace the token was minted for (e.g. POST /api/devices/register) to prevent
 * token-scope drift for multi-workspace users.
 */
export function verifyDesktopAccessTokenClaims(token: string): { userId: string; workspaceId: string | null } | null {
  const c = verifyDesktopAccessPayload(token);
  return c ? { userId: c.userId, workspaceId: c.workspaceId } : null;
}
