/**
 * Media Session Token — Node-only signed token authorizing SyncBiz Music Bank media reads.
 *
 * Separate key material from the WS token: signed with SYNCBIZ_MEDIA_SECRET (NOT SYNCBIZ_WS_SECRET).
 * Fail-closed: missing/short secret → verify returns null, mint throws.
 *
 * Scoped (Stage A = PREVIEW only): a token is NOT a blanket "any asset" grant. It carries the exact
 * genres it may read; the media endpoint checks the requested asset's genre ∈ allowedGenres, using an
 * in-memory asset map — NO DB lookup per request.
 *
 * TTL is deliberately modest (default 30 min, hard cap 1 h) — long enough that a single preview track
 * (~2–6 min) started while the token is valid can never expire mid-playback, but not a multi-hour
 * blanket credential. Long playlists work via automatic background refresh on the client, not a long TTL.
 */

import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";

const PURPOSE = "media_access" as const;
const DEFAULT_TTL_SEC = 30 * 60; // 30 min
const MAX_TTL_SEC = 60 * 60; // 1 h hard cap

function getMediaSecret(): string {
  const s = process.env.SYNCBIZ_MEDIA_SECRET;
  if (!s || s.length < 16) throw new Error("SYNCBIZ_MEDIA_SECRET required (min 16 chars)");
  return s;
}

export type MediaTokenScope = {
  workspaceId: string;
  deviceId: string;
  accessMode: "preview";
  /** Asset.genreId must be one of these. Server-authoritative (never taken from the client). */
  allowedGenres: string[];
};

export type MediaTokenPayload = MediaTokenScope & {
  purpose: typeof PURPOSE;
  iat: number;
  exp: number;
  /** Per-session nonce — lets a token be distinguished/rotated; not a secret. */
  sid: string;
};

export function mediaTokenDefaultTtlSec(): number {
  const raw = Number(process.env.SYNCBIZ_MEDIA_TOKEN_TTL_SEC);
  return Number.isFinite(raw) && raw >= 60 && raw <= MAX_TTL_SEC ? Math.floor(raw) : DEFAULT_TTL_SEC;
}

/** Mint a scoped media session token. Server only. Throws if the secret is missing. */
export function mintMediaSessionToken(scope: MediaTokenScope, ttlSec = mediaTokenDefaultTtlSec()): { token: string; exp: number } {
  const now = Math.floor(Date.now() / 1000);
  const ttl = Math.min(Math.max(60, Math.floor(ttlSec)), MAX_TTL_SEC);
  const payload: MediaTokenPayload = {
    purpose: PURPOSE,
    workspaceId: scope.workspaceId,
    deviceId: scope.deviceId,
    accessMode: "preview",
    allowedGenres: [...scope.allowedGenres],
    iat: now,
    exp: now + ttl,
    sid: randomBytes(9).toString("base64url"),
  };
  const b64 = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  const sig = createHmac("sha256", getMediaSecret()).update(b64).digest("base64url");
  return { token: `${b64}.${sig}`, exp: payload.exp };
}

/** Verify a media session token. Returns the scoped payload, or null (fail-closed). No DB, no I/O. */
export function verifyMediaSessionToken(token: string): MediaTokenPayload | null {
  const secret = process.env.SYNCBIZ_MEDIA_SECRET;
  if (!secret || secret.length < 16) return null; // fail closed
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [b64, sig] = parts;
  const expected = createHmac("sha256", secret).update(b64).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let p: MediaTokenPayload;
  try {
    p = JSON.parse(Buffer.from(b64, "base64url").toString("utf-8"));
  } catch {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  if (p.purpose !== PURPOSE) return null;
  if (typeof p.exp !== "number" || p.exp < now) return null;
  if (typeof p.iat !== "number" || p.iat > now + 300) return null;
  if (p.exp - p.iat > MAX_TTL_SEC) return null;
  if (p.accessMode !== "preview") return null;
  if (!Array.isArray(p.allowedGenres) || typeof p.workspaceId !== "string" || typeof p.deviceId !== "string") return null;
  return p;
}
