/**
 * Node-only WS token utilities. Uses Node crypto.
 * For API routes and WS server only. NOT for Edge/middleware.
 */

import { createHmac } from "crypto";

const WS_TOKEN_PURPOSE = "ws_register";

/** Create short-lived token for WS REGISTER. Server verifies with verifyWsToken. */
export function createWsToken(userId: string): string {
  const secret = process.env.SYNCBIZ_WS_SECRET ?? process.env.WS_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("SYNCBIZ_WS_SECRET or WS_SECRET required (min 16 chars)");
  }
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    purpose: WS_TOKEN_PURPOSE,
    userId: userId.trim(),
    iat: now,
    exp: now + 60,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  const sig = createHmac("sha256", secret).update(payloadB64).digest("base64url");
  return `${payloadB64}.${sig}`;
}

/** Verify WS token. Returns userId or null. */
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
  if (payload.purpose !== WS_TOKEN_PURPOSE) return null;
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp < now) return null;
  if (typeof payload.iat !== "number" || payload.iat > now + 60) return null;
  const userId = typeof payload.userId === "string" ? payload.userId.trim() : "";
  return userId.length > 0 ? userId : null;
}
