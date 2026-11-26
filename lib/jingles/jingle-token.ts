/**
 * Jingle Access Token — Node-only signed token authorizing a read of ONE workspace's jingle audio
 * (`/api/jingles/audio/<id>`).
 *
 * Why a token at all: only the designated station's MPV ever fetches the jingle bytes, and MPV cannot
 * send a session cookie. So workspace enforcement must ride on the URL — the renderer appends this
 * token at dispatch, and the audio route verifies it and matches it to the jingle's owning workspace.
 *
 * Signed with SYNCBIZ_MEDIA_SECRET (the same already-provisioned secret as the media token) but with a
 * DISTINCT purpose ("jingle_access"), so a media token can never be replayed as a jingle token or vice
 * versa. Scope is workspace-only (no genres / device) — a jingle grant is simply "this business's
 * jingles". Fail-closed: a missing / short secret → verify returns null, mint throws.
 *
 * TTL default 30 min / hard cap 1 h — far longer than any jingle clip (seconds), so a fire can never
 * expire mid-clip; the client refreshes in the background well before expiry.
 */

import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";

const PURPOSE = "jingle_access" as const;
const DEFAULT_TTL_SEC = 30 * 60; // 30 min
const MAX_TTL_SEC = 60 * 60; // 1 h hard cap

function getJingleSecret(): string {
  const s = process.env.SYNCBIZ_MEDIA_SECRET;
  if (!s || s.length < 16) throw new Error("SYNCBIZ_MEDIA_SECRET required (min 16 chars)");
  return s;
}

export type JingleTokenPayload = {
  purpose: typeof PURPOSE;
  workspaceId: string;
  iat: number;
  exp: number;
  /** Per-mint nonce — lets a token be distinguished / rotated; not a secret. */
  sid: string;
};

export function jingleTokenDefaultTtlSec(): number {
  const raw = Number(process.env.SYNCBIZ_JINGLE_TOKEN_TTL_SEC);
  return Number.isFinite(raw) && raw >= 60 && raw <= MAX_TTL_SEC ? Math.floor(raw) : DEFAULT_TTL_SEC;
}

/** Mint a workspace-scoped jingle access token. Server only. Throws if the secret is missing. */
export function mintJingleToken(workspaceId: string, ttlSec = jingleTokenDefaultTtlSec()): { token: string; exp: number } {
  if (!workspaceId || typeof workspaceId !== "string") throw new Error("workspaceId required");
  const now = Math.floor(Date.now() / 1000);
  const ttl = Math.min(Math.max(60, Math.floor(ttlSec)), MAX_TTL_SEC);
  const payload: JingleTokenPayload = {
    purpose: PURPOSE,
    workspaceId,
    iat: now,
    exp: now + ttl,
    sid: randomBytes(9).toString("base64url"),
  };
  const b64 = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  const sig = createHmac("sha256", getJingleSecret()).update(b64).digest("base64url");
  return { token: `${b64}.${sig}`, exp: payload.exp };
}

/** Verify a jingle access token. Returns the payload, or null (fail-closed). No DB, no I/O. */
export function verifyJingleToken(token: string): JingleTokenPayload | null {
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
  let p: JingleTokenPayload;
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
  if (typeof p.workspaceId !== "string" || !p.workspaceId) return null;
  return p;
}
