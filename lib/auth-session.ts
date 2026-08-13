/**
 * Edge-safe session cookie: versioned + HMAC-SHA256 signed.
 * Uses Web Crypto (crypto.subtle) ONLY — safe for middleware (Edge Runtime) and Node.
 *
 * Format:  v1.<base64url(payload)>.<base64url(HMAC-SHA256("v1.<payload>", secret))>
 *   payload = { email, exp }   (exp = unix seconds; matches the 7-day cookie lifetime)
 *
 * Secret: SYNCBIZ_SESSION_SECRET (min 16 chars). FAIL-CLOSED — if it is missing/short,
 * signing throws and verification returns null (no session is accepted). There is NO
 * hardcoded fallback secret.
 *
 * The legacy plain `base64(email)` format is REJECTED (it has no signature) — those
 * sessions require a one-time re-login.
 */

const VERSION = "v1";
const SESSION_TTL_SEC = 60 * 60 * 24 * 7; // 7 days — matches the cookie maxAge

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

/** Import the HMAC key. Throws (fail-closed) if the secret is missing/short. */
async function getKey(): Promise<CryptoKey> {
  const secret = process.env.SYNCBIZ_SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("SYNCBIZ_SESSION_SECRET is required (min 16 chars)");
  }
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** Mint a signed session cookie value for the given email. Throws if the secret is missing. */
export async function createSessionValue(email: string): Promise<string> {
  const payload = {
    email: email.trim().toLowerCase(),
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SEC,
  };
  const payloadB64 = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signingInput = `${VERSION}.${payloadB64}`;
  const key = await getKey();
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${b64urlEncode(new Uint8Array(sig))}`;
}

/**
 * Verify a signed session cookie and return the email, or null if it is malformed,
 * unsigned/legacy, tampered, expired, or the secret is unavailable (fail-closed).
 */
export async function parseSessionValue(value: string): Promise<string | null> {
  if (!value || typeof value !== "string") return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null; // rejects legacy base64(email) (single segment)
  const [version, payloadB64, sigB64] = parts;
  if (version !== VERSION) return null;

  let key: CryptoKey;
  try {
    key = await getKey();
  } catch {
    return null; // no secret → fail closed
  }

  let ok = false;
  try {
    ok = await crypto.subtle.verify(
      "HMAC",
      key,
      b64urlDecode(sigB64),
      new TextEncoder().encode(`${version}.${payloadB64}`),
    );
  } catch {
    return null;
  }
  if (!ok) return null;

  let payload: { email?: string; exp?: number };
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(payloadB64)));
  } catch {
    return null;
  }
  if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
  const email = typeof payload.email === "string" ? payload.email.trim() : "";
  return email.length > 0 ? email : null;
}
