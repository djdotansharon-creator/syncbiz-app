/**
 * Control Room — station activation codes (owner-approved 2026-10-10). Pure helpers, server only.
 *
 *  - Station ID = "<organization prefix>-<branch number>" (e.g. AROMA-192). The prefix is set per organization
 *    (Workspace.stationIdPrefix), never hardcoded per environment.
 *  - Activation code = RANDOM 6 digits (crypto), shown ONCE, valid 60 minutes, single use. Only an HMAC hash is stored
 *    (the system can never read a code back). Generating a new code revokes the branch's previous active code.
 *  - Redemption by a station (Step B) is NOT here yet.
 */
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

export const ACTIVATION_CODE_TTL_MS = 60 * 60 * 1000;
export const ACTIVATION_MAX_FAILED_ATTEMPTS = 5;

/** Organization prefix: 2–12 characters, A–Z / 0–9 (stored upper-case). */
export function normalizeStationIdPrefix(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toUpperCase();
  return /^[A-Z0-9]{2,12}$/.test(v) ? v : null;
}

/** Branch number (locationCode): 1–12 characters, letters / digits (stored upper-case). */
export function normalizeBranchNumber(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toUpperCase();
  return /^[A-Z0-9]{1,12}$/.test(v) ? v : null;
}

export function stationIdFor(prefix: string | null | undefined, branchNumber: string | null | undefined): string | null {
  const p = normalizeStationIdPrefix(prefix ?? "");
  const n = normalizeBranchNumber(branchNumber ?? "");
  return p && n ? `${p}-${n}` : null;
}

/** Random 6 digits (cryptographic; leading zeros kept). */
export function generateActivationCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

function activationSecret(): string {
  const s = (process.env.SYNCBIZ_ACTIVATION_SECRET ?? process.env.SYNCBIZ_SESSION_SECRET ?? "").trim();
  if (s.length < 16) throw new Error("Activation codes are not configured (server secret missing)");
  return s;
}

/** One-way hash bound to the branch: the same 6 digits for another branch never match. */
export function hashActivationCode(branchId: string, code: string): string {
  return createHmac("sha256", activationSecret()).update(`vono-activation:v1:${branchId}:${code}`).digest("hex");
}

/** Constant-time comparison of a typed code against a stored hash (used by Step B redemption). */
export function activationCodeMatches(branchId: string, code: string, storedHash: string): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const a = Buffer.from(hashActivationCode(branchId, code), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
