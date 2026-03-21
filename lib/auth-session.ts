/**
 * Edge-safe auth utilities. No Node crypto or Node-only APIs.
 * Safe for middleware (Edge Runtime).
 */

/** Decode base64 session cookie to email string. */
export function parseSessionValue(value: string): string | null {
  if (!value || typeof value !== "string") return null;
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const decoded = new TextDecoder().decode(bytes);
    return decoded && decoded.trim().length > 0 ? decoded : null;
  } catch {
    return null;
  }
}

/** Encode email to base64 session cookie value. */
export function createSessionValue(email: string): string {
  const bytes = new TextEncoder().encode(email.trim().toLowerCase());
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
