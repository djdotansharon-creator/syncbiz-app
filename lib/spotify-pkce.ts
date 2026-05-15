/**
 * Stage 6E-A — PKCE (RFC 7636, S256) + CSRF state helpers for the Spotify
 * Authorization Code flow. Pure Node `crypto`; no I/O.
 */

import { randomBytes, createHash } from "crypto";

function base64Url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 64-char high-entropy verifier (within RFC 7636's 43–128 range). */
export function generateCodeVerifier(): string {
  return base64Url(randomBytes(48));
}

/** SHA-256 → base64url challenge for `code_challenge_method=S256`. */
export function codeChallengeS256(verifier: string): string {
  return base64Url(createHash("sha256").update(verifier).digest());
}

/** Opaque CSRF state echoed back on the callback. */
export function generateOauthState(): string {
  return base64Url(randomBytes(24));
}
