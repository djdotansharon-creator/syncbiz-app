/**
 * Redact secrets from a URL before it reaches a log line (desktop main process): the SyncBiz media
 * token (`mt=`) AND the R2/S3 presigned signature material (`X-Amz-Signature` / `X-Amz-Credential`).
 * MPV follows the /api/media 302 to a signed storage URL; if that URL ever surfaces in mpv stderr,
 * masking the signature neutralizes it. Pure string transform — changes only what is logged.
 * Mirror of lib/media/media-session.ts `redactMediaToken` (desktop cannot import the app's @/lib).
 */
export function redactMediaToken(s: string): string {
  return String(s)
    .replace(/([?&]mt=)[^&\s"']*/gi, "$1[REDACTED]")
    .replace(/([?&]X-Amz-Signature=)[^&\s"']*/gi, "$1[REDACTED]")
    .replace(/([?&]X-Amz-Credential=)[^&\s"']*/gi, "$1[REDACTED]");
}
