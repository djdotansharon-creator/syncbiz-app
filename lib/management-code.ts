import { createHash, timingSafeEqual } from "crypto";

/**
 * The access CODE for settings and management on the player computer (the VONO desktop app) — owner 2026-10-29: "no access code for More settings — do it now, 123".
 * 123 until the owner chooses his own (storing his own code needs a place in the database — a later step); `SYNCBIZ_MANAGEMENT_CODE` (3+ characters) overrides it on a deployment.
 * The code only lifts the station lock (lib/management-unlock.ts); who may SEE what is still decided by role (a branch employee still never gets the manager pages).
 */
export const DEFAULT_MANAGEMENT_CODE = "123";

export function managementCode(env: Record<string, string | undefined> = process.env): string {
  const v = (env.SYNCBIZ_MANAGEMENT_CODE ?? "").trim();
  return v.length >= 3 ? v : DEFAULT_MANAGEMENT_CODE;
}

/** Constant-time comparison (both sides hashed first, so the length does not leak either). */
export function matchesManagementCode(input: string, env: Record<string, string | undefined> = process.env): boolean {
  const a = createHash("sha256").update(String(input ?? "").trim()).digest();
  const b = createHash("sha256").update(managementCode(env)).digest();
  return timingSafeEqual(a, b);
}
