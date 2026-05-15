/**
 * Stage 6E-A — AES-256-GCM encryption for Spotify OAuth tokens at rest.
 *
 * The Spotify access/refresh token pair is serialised to JSON and encrypted
 * before it is written to `SpotifyConnection.encryptedTokenBlob`. Decryption
 * requires the server-only `SPOTIFY_TOKEN_ENCRYPTION_KEY` — the plaintext token
 * never leaves this process and is never returned to the client.
 *
 * Node `crypto` only (route handlers run on the Node runtime). Not Edge-safe;
 * never import from middleware.
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

/** Thrown when the encryption key env var is absent — callers map to a "not configured" response. */
export class SpotifyCryptoNotConfiguredError extends Error {
  constructor() {
    super("SPOTIFY_TOKEN_ENCRYPTION_KEY is not set.");
    this.name = "SpotifyCryptoNotConfiguredError";
  }
}

export function isSpotifyCryptoConfigured(): boolean {
  return (process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY ?? "").trim().length > 0;
}

/**
 * Resolve a stable 32-byte key. A 64-hex-char env value is used verbatim
 * (recommended — generate with `openssl rand -hex 32`). Any other non-empty
 * string is folded to 32 bytes via SHA-256 so a passphrase still works, while
 * keeping the key length AES-256 requires.
 */
function getKey(): Buffer {
  const raw = (process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY ?? "").trim();
  if (!raw) throw new SpotifyCryptoNotConfiguredError();
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  return createHash("sha256").update(raw, "utf8").digest();
}

/**
 * Encrypt UTF-8 plaintext. The returned `ciphertext` is `enc || authTag`
 * (16-byte GCM tag appended) and `iv` is a fresh random 12-byte nonce. Persist
 * both; the IV is not secret.
 */
export function encryptSpotifyTokenBlob(plaintext: string): { ciphertext: Buffer; iv: Buffer } {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext: Buffer.concat([enc, tag]), iv };
}

/**
 * Decrypt a blob produced by {@link encryptSpotifyTokenBlob}. Throws if the key
 * changed or the ciphertext was tampered with (GCM auth-tag mismatch) — the
 * connection store treats any throw here as "needs reconnect".
 */
export function decryptSpotifyTokenBlob(ciphertext: Buffer, iv: Buffer): string {
  const key = getKey();
  if (ciphertext.length <= 16) throw new Error("Spotify token blob too short.");
  const tag = ciphertext.subarray(ciphertext.length - 16);
  const data = ciphertext.subarray(0, ciphertext.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
