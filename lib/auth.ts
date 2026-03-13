/**
 * MVP auth – simple email+password validation.
 * Test user: test@syncbiz.com / test123 (hardcoded for MVP).
 */

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

export function createSessionValue(email: string): string {
  return Buffer.from(email.trim().toLowerCase(), "utf-8").toString("base64");
}

export function parseSessionValue(value: string): string | null {
  if (!value || typeof value !== "string") return null;
  try {
    const decoded = Buffer.from(value, "base64").toString("utf-8");
    return decoded && decoded.includes("@") ? decoded : null;
  } catch {
    return null;
  }
}
