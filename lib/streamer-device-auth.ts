/**
 * Branch streamer device token hashing and pairing code generation.
 * Node-only (uses crypto). Device tokens are never stored in plaintext in BranchStreamerDevice.
 */

import { createHmac, randomBytes, timingSafeEqual } from "crypto";

export const STREAMER_DEVICE_PURPOSE = "branch_streamer_station";
export const DEFAULT_STREAMER_BRANCH_ID = "default";
export const PAIRING_CODE_TTL_MS = 15 * 60 * 1000;

const PAIRING_CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function getSecret(): string {
  const secret = process.env.SYNCBIZ_WS_SECRET ?? process.env.WS_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("SYNCBIZ_WS_SECRET or WS_SECRET required (min 16 chars)");
  }
  return secret;
}

export function generateDeviceToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashDeviceToken(token: string): string {
  return createHmac("sha256", getSecret()).update(token).digest("hex");
}

export function verifyDeviceToken(token: string, tokenHash: string): boolean {
  if (!token?.trim() || !tokenHash?.trim()) return false;
  try {
    const expected = hashDeviceToken(token);
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(tokenHash, "hex");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function generatePairingCode(): string {
  const bytes = randomBytes(6);
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += PAIRING_CODE_CHARS[bytes[i]! % PAIRING_CODE_CHARS.length];
  }
  return code;
}

export function normalizeDeviceId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length < 8 || trimmed.length > 128) return null;
  return trimmed;
}

export function normalizePairingCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toUpperCase();
  if (!/^[A-Z2-9]{6}$/.test(trimmed)) return null;
  return trimmed;
}
