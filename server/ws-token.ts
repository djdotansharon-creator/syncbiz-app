/**
 * WS token verification — keep logic aligned with `lib/auth-ws-token.ts` `verifyWsToken`.
 *
 * Returns the resolved identity plus the authoritative branch claim minted by the app layer.
 * `authorizedBranches === null` means a legacy token with no claim — callers must restrict it to
 * the default branch only (never treat a missing claim as "all branches").
 */

import { createHmac } from "crypto";

const PURPOSE_WS_REGISTER = "ws_register";
const PURPOSE_DESKTOP_ACCESS = "desktop_access";
const MAX_DESKTOP_TTL_SEC = 60 * 60 * 24 * 30;

export type WsTokenResult = {
  userId: string;
  /** Concrete authorized branch ids, or null for a legacy token without the claim. */
  authorizedBranches: string[] | null;
  workspaceId: string | null;
};

export function verifyWsToken(token: string): WsTokenResult | null {
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
    workspaceId?: string;
    authorizedBranches?: unknown;
  };
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

  // Additive claim: present → concrete authorized ids; absent → legacy (null → default-only).
  const authorizedBranches =
    Array.isArray(payload.authorizedBranches) &&
    payload.authorizedBranches.every((b) => typeof b === "string")
      ? (payload.authorizedBranches as string[])
      : null;
  const workspaceId = typeof payload.workspaceId === "string" ? payload.workspaceId : null;

  if (payload.purpose === PURPOSE_WS_REGISTER) {
    if (payload.exp > now + 120) return null;
    return { userId, authorizedBranches, workspaceId };
  }
  if (payload.purpose === PURPOSE_DESKTOP_ACCESS) {
    if (payload.exp - payload.iat > MAX_DESKTOP_TTL_SEC) return null;
    if (payload.exp > now + MAX_DESKTOP_TTL_SEC) return null;
    return { userId, authorizedBranches, workspaceId };
  }
  return null;
}
