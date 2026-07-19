/**
 * Feature flag for the mobile "Import from Shazam" flow.
 *
 * Off by default in production; enable with `SYNCBIZ_SHAZAM_IMPORT_ENABLED=1`.
 * Follows the same hand-rolled `process.env.SYNCBIZ_* === "1"` convention as
 * `lib/entitlement-limits.ts` / `lib/recommendations/catalog-eligibility-flag.ts`.
 *
 * NOTE: gates the mobile UI entry point only. The underlying resolver
 * (`/api/sources/parse-url` + the YouTube search) is shared with existing paste
 * flows and is intentionally NOT gated.
 */

const ENV_KEY = "SYNCBIZ_SHAZAM_IMPORT_ENABLED";

export const SHAZAM_IMPORT_ENV_KEY = ENV_KEY;

/** Server-side check. Read in a server component and pass to client children. */
export function isShazamImportEnabled(): boolean {
  return process.env[ENV_KEY] === "1";
}
