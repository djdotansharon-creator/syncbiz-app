/**
 * MVP auth – email+password validation.
 * Legacy: TEST_USERS for demo accounts.
 * New: API-created users verified via user-store passwordHash.
 */

import { parseSessionValue, createSessionValue } from "@/lib/auth-session";
import { getUserByEmail } from "@/lib/user-store";
import { verifyPassword } from "@/lib/password-utils";

const TEST_USERS: Record<string, string> = {
  "test@syncbiz.com": "test123",
  "djdotansharon@gmail.com": "test123",
};

/**
 * The legacy TEST_USERS shortcut is DEVELOPMENT-ONLY. In production the fallback is never
 * accepted — real accounts must authenticate via their bcrypt passwordHash. Centralized so
 * both validateCredentials and validateCredentialsAsync stay guarded (no drift).
 */
function devTestUserMatches(email: string, password: string): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return !!email && TEST_USERS[email] === password;
}

export function validateCredentials(email: string, password: string): boolean {
  const normalized = email?.trim().toLowerCase();
  if (!normalized || !password) return false;
  return devTestUserMatches(normalized, password);
}

/**
 * Async validation: checks TEST_USERS first, then user-store for API-created users.
 *
 * Disabled users are blocked here as a defense in depth. `getUserByEmail`
 * already filters them out, but the legacy TEST_USERS fallback below would
 * otherwise allow a disabled email if it ever appeared in that map. Cheap
 * extra check, no behavior change for active users.
 */
export async function validateCredentialsAsync(email: string, password: string): Promise<boolean> {
  const normalized = email?.trim().toLowerCase();
  if (!normalized || !password) return false;
  const user = await getUserByEmail(normalized);
  if (user?.status === "DISABLED") return false;
  if (user?.passwordHash) {
    return verifyPassword(password, user.passwordHash);
  }
  // Legacy demo fallback — development only (production returns false here).
  return devTestUserMatches(normalized, password);
}

export { parseSessionValue, createSessionValue };
