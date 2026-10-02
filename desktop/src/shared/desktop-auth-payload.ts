/**
 * Pure sanitizer for the dedicated `applyDesktopAuth` bridge (no electron import, unit-testable).
 *
 * applyDesktopAuth is NARROWLY SCOPED to authentication: it carries ONLY a desktop_access token + its expiry.
 * It can NEVER alter deviceId, endpoints, branch, or any other runtime config — this sanitizer drops every field
 * except token/expiresAtIso, so the MAIN handler only ever applies those two values.
 */
export type ApplyDesktopAuthInput = { token?: unknown; expiresAtIso?: unknown };
export type SanitizedDesktopAuth =
  | { ok: true; token: string; expiresAtIso: string | undefined }
  | { ok: false; error: string };

export function sanitizeApplyDesktopAuth(payload: ApplyDesktopAuthInput | null | undefined): SanitizedDesktopAuth {
  const token = typeof payload?.token === "string" ? payload.token.trim() : "";
  if (!token) return { ok: false, error: "token required" };
  const expiresAtIso =
    typeof payload?.expiresAtIso === "string" && payload.expiresAtIso.trim() ? payload.expiresAtIso.trim() : undefined;
  return { ok: true, token, expiresAtIso };
}
