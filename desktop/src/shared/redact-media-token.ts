/**
 * Redact a `mt=` Media Session Token from a URL before it reaches a log line (desktop main process).
 * Pure string transform — does not change what is played, only what is logged.
 * Mirror of lib/media/media-session.ts `redactMediaToken` (desktop cannot import the app's @/lib).
 */
export function redactMediaToken(s: string): string {
  return String(s).replace(/([?&]mt=)[^&\s"']*/gi, "$1[REDACTED]");
}
