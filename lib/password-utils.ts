/**
 * Stage 2 – Password hashing for user-created accounts.
 * Node-only. Uses crypto.scrypt.
 */

import { scryptSync, randomBytes, timingSafeEqual } from "crypto";

const SALT_LEN = 16;
const KEY_LEN = 64;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1 };

/** Hash password for storage. Returns salt:hash as hex. */
export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LEN);
  const key = scryptSync(password, salt, KEY_LEN, SCRYPT_OPTIONS);
  return `${salt.toString("hex")}:${key.toString("hex")}`;
}

/** Verify password against stored hash. */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 2) return false;
  const salt = Buffer.from(parts[0], "hex");
  const expected = Buffer.from(parts[1], "hex");
  if (salt.length !== SALT_LEN || expected.length !== KEY_LEN) return false;
  const key = scryptSync(password, salt, KEY_LEN, SCRYPT_OPTIONS);
  return timingSafeEqual(key, expected);
}
