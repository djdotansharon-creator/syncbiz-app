/**
 * MANAGEMENT LOCK (owner 2026-10-13, security hotfix) — the short-lived "management unlocked" proof for the VONO
 * DESKTOP app (a shared station computer). A browser (HQ / the owner's Mac) never needs it.
 *
 * Edge-safe (Web Crypto only). Cookie value:  mu1.<base64url({email, exp})>.<base64url(HMAC-SHA256)>
 *   - signed with SYNCBIZ_SESSION_SECRET, DOMAIN-SEPARATED from the session cookie ("vono-mgmt-unlock:" prefix in
 *     the signing input) so a session cookie can never be replayed as an unlock and vice versa;
 *   - bound to the signed-in email (a different account's unlock is ignored);
 *   - exp = now + 15 min, extended ONLY by real user activity (the client "touch") — background polling never extends;
 *   - set WITHOUT Max-Age / Expires (a session cookie) → closing the app drops it; the desktop also clears it on its
 *     first page of every app run (belt and braces).
 * FAIL-CLOSED: no / short secret → no unlock is ever valid.
 */

export const MGMT_UNLOCK_COOKIE = "vono-mgmt-unlock";
/** Inactivity window: management locks after this long without user activity. */
export const MGMT_IDLE_SEC = 15 * 60;
const VERSION = "mu1";
const DOMAIN = "vono-mgmt-unlock:";

/** The VONO desktop app (Electron) — the ONLY client that gets the management lock. Browsers never do. */
export function isDesktopAppUa(ua: string | null | undefined): boolean {
  return /\bElectron\//.test(ua ?? "");
}

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(str: string): Uint8Array<ArrayBuffer> {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
  const bin = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
async function getKey(): Promise<CryptoKey> {
  const secret = process.env.SYNCBIZ_SESSION_SECRET;
  if (!secret || secret.length < 16) throw new Error("SYNCBIZ_SESSION_SECRET is required (min 16 chars)");
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

/** Mint an unlock for `email`, valid for MGMT_IDLE_SEC from `nowSec`. Throws if the secret is missing. */
export async function createUnlockValue(email: string, nowSec = Math.floor(Date.now() / 1000)): Promise<{ value: string; exp: number }> {
  const exp = nowSec + MGMT_IDLE_SEC;
  const payloadB64 = b64urlEncode(new TextEncoder().encode(JSON.stringify({ email: email.trim().toLowerCase(), exp })));
  const signingInput = `${VERSION}.${payloadB64}`;
  const sig = await crypto.subtle.sign("HMAC", await getKey(), new TextEncoder().encode(DOMAIN + signingInput));
  return { value: `${signingInput}.${b64urlEncode(new Uint8Array(sig))}`, exp };
}

/** The unlock's expiry (unix seconds) if it is authentic, unexpired and belongs to `email`; otherwise null. */
export async function verifyUnlockValue(value: string | null | undefined, email: string | null | undefined, nowSec = Math.floor(Date.now() / 1000)): Promise<number | null> {
  if (!value || !email) return null;
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) return null;
  let key: CryptoKey;
  try { key = await getKey(); } catch { return null; }
  let ok = false;
  try {
    ok = await crypto.subtle.verify("HMAC", key, b64urlDecode(parts[2]), new TextEncoder().encode(`${DOMAIN}${parts[0]}.${parts[1]}`));
  } catch { return null; }
  if (!ok) return null;
  let payload: { email?: unknown; exp?: unknown };
  try { payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1]))); } catch { return null; }
  if (typeof payload.exp !== "number" || payload.exp <= nowSec) return null;
  if (typeof payload.email !== "string" || payload.email !== email.trim().toLowerCase()) return null;
  return payload.exp;
}

/** Cookie attributes: httpOnly, SameSite=Strict, NO maxAge (dies with the app). */
export function unlockCookieOptions() {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict" as const, path: "/" };
}
