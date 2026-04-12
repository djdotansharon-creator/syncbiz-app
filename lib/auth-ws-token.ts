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

function mintToken(
  userId: string,
  purpose: typeof PURPOSE_WS_REGISTER | typeof PURPOSE_DESKTOP_ACCESS,
  ttlSec: number,
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    purpose,
    userId: userId.trim(),
    iat: now,
    exp: now + ttlSec,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  const sig = signPayload(payloadB64);
  return `${payloadB64}.${sig}`;
}

/** Create short-lived token for WS REGISTER. Minted by GET /api/auth/ws-token. */
export function createWsToken(userId: string): string {
  return mintToken(userId, PURPOSE_WS_REGISTER, 60);
}

/**
 * Long-lived token for Electron desktop HTTP + WS (same secret as ws_register).
 * Minted by POST /api/auth/desktop/token.
 */
export function getDesktopTokenTtlSeconds(): number {
  const raw = Number(process.env.SYNCBIZ_DESKTOP_TOKEN_TTL_SEC);
  return Number.isFinite(raw) && raw > 60 && raw <= MAX_DESKTOP_TTL_SEC ? Math.floor(raw) : DEFAULT_DESKTOP_TTL_SEC;
}

export function createDesktopAccessToken(userId: string): string {
  return mintToken(userId, PURPOSE_DESKTOP_ACCESS, getDesktopTokenTtlSeconds());
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
