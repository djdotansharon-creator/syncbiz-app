/**
 * MVP auth – simple email+password validation.
 * Test user: test@syncbiz.com / test123 (hardcoded for MVP).
 * Edge-safe: no Node crypto. Session helpers re-exported from auth-session.
 */

import { parseSessionValue, createSessionValue } from "@/lib/auth-session";

const TEST_USERS: Record<string, string> = {
  "test@syncbiz.com": "test123",
  "djdotansharon@gmail.com": "test123",
};

export function validateCredentials(email: string, password: string): boolean {
  const normalized = email?.trim().toLowerCase();
  if (!normalized || !password) return false;
  const expected = TEST_USERS[normalized];
  return !!expected && expected === password;
}

export { parseSessionValue, createSessionValue };
