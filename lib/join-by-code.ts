/**
 * Join a business by a one-time code (docs/ACCOUNTS_JOIN_DESIGN.md) — the PURE rules (no database, no network), so they can be tested alone.
 * A workspace admin makes a code; the person joining types it once and sends a request; an admin approves it and chooses the role.
 * Dormant unless the env flag SYNCBIZ_JOIN_BY_CODE=1.
 */

import { createHash, randomInt } from "crypto";

/** A one-time code lives 90 seconds (owner 2026-10-31: "renews every minute" — the window shows each code for 60 s, the extra 30 s is for the person still typing it). A photo of an old QR is useless. */
export const JOIN_CODE_TTL_MS = 90_000;
/** A person who OPENED the join link (the QR) is given this long to fill in his details before sending; only that code is kept alive, and it still works once. */
export const JOIN_CLAIM_TTL_MS = 10 * 60_000;
/** How often the "add a person" window asks for a fresh code while it is open. */
export const JOIN_CODE_RENEW_MS = 60_000;
/** An unanswered request stays open this many days. */
export const JOIN_REQUEST_TTL_DAYS = 7;
/** Most unused, unexpired codes one workspace can hold at a time (stops a runaway loop from filling the table). */
export const MAX_ACTIVE_CODES = 10;
export const MIN_PASSWORD_LENGTH = 6;

/** No I / O / 0 / 1 — a code read aloud or typed by hand is never mistaken. 32 symbols × 8 places ≈ 10^12 combinations. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

export function isJoinEnvEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const v = (env.SYNCBIZ_JOIN_BY_CODE ?? "").trim().toLowerCase();
  return v === "1" || v === "true";
}

export function generateJoinCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

/** "abcd-efgh" / "ABCD EFGH" → "ABCDEFGH" (what is hashed and compared). */
export function normalizeJoinCode(input: string): string {
  return String(input ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function isWellFormedJoinCode(normalized: string): boolean {
  return normalized.length === CODE_LENGTH && [...normalized].every((c) => ALPHABET.includes(c));
}

/** "ABCDEFGH" → "ABCD-EFGH" (how the admin sees and reads it out). */
export function formatJoinCode(normalized: string): string {
  return normalized.length === CODE_LENGTH ? `${normalized.slice(0, 4)}-${normalized.slice(4)}` : normalized;
}

export function hashJoinCode(normalized: string): string {
  return createHash("sha256").update(`vono-join:${normalized}`).digest("hex");
}

export function joinCodeExpiresAt(now = Date.now()): Date {
  return new Date(now + JOIN_CODE_TTL_MS);
}

export function joinClaimExpiresAt(now = Date.now()): Date {
  return new Date(now + JOIN_CLAIM_TTL_MS);
}

export function joinRequestExpiresAt(now = Date.now()): Date {
  return new Date(now + JOIN_REQUEST_TTL_DAYS * 24 * 60 * 60_000);
}

export type JoinRole = "MANAGER" | "MEMBER";

export function parseJoinRole(v: unknown): JoinRole | null {
  return v === "MANAGER" || v === "MEMBER" ? v : null;
}

/** The existing tenant role each choice maps to (custom roles with switches come later; today these are the two the platform already knows). */
export function tenantRoleForJoinRole(role: JoinRole): "TENANT_ADMIN" | "TENANT_MEMBER" {
  return role === "MANAGER" ? "TENANT_ADMIN" : "TENANT_MEMBER";
}

export type JoinInput = {
  code: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone: string;
};

export type JoinInputError = "code" | "email" | "password" | "first_name" | "last_name" | "phone";

/** What the person must give. Names are required; the phone is optional but must look like one when given. The password minimum matches sign-up. */
export function validateJoinInput(i: JoinInput): JoinInputError | null {
  if (!isWellFormedJoinCode(normalizeJoinCode(i.code))) return "code";
  const email = i.email.trim();
  if (!email.includes("@") || email.length > 254) return "email";
  if (i.password.length < MIN_PASSWORD_LENGTH || i.password.length > 200) return "password";
  if (i.firstName.trim().length < 1 || i.firstName.trim().length > 60) return "first_name";
  if (i.lastName.trim().length < 1 || i.lastName.trim().length > 60) return "last_name";
  const phone = i.phone.trim();
  if (phone && !/^[+()\d][\d\s\-().]{5,24}$/.test(phone)) return "phone";
  return null;
}

export type JoinRequestStatus = "pending" | "approved" | "rejected" | "expired";

/** A pending request past its date is shown (and treated) as expired without a write. */
export function effectiveJoinStatus(row: { status: string; expiresAt: Date }, now = Date.now()): JoinRequestStatus {
  if (row.status === "pending" && row.expiresAt.getTime() <= now) return "expired";
  return row.status as JoinRequestStatus;
}
