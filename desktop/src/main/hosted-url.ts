/**
 * Production hosted web app URL baked into the packaged desktop installer.
 *
 * When the hosting URL changes (new Railway service, custom domain, etc.):
 *   1. Update SYNCBIZ_HOSTED_WEB_APP_URL below.
 *   2. Rebuild the installer (`npm run dist:win` in desktop/).
 *
 * For testing or staging without a code change, override at runtime:
 *   set SYNCBIZ_DESKTOP_WEB_APP_URL=https://your-staging-url.railway.app
 */
export const SYNCBIZ_HOSTED_WEB_APP_URL =
  "https://syncbiz-app-production.up.railway.app";

/** Allowed navigation origin — derived from the hosted URL. Used by security guards. */
export const SYNCBIZ_ALLOWED_ORIGIN = new URL(SYNCBIZ_HOSTED_WEB_APP_URL).origin;
// → "https://syncbiz-app-production.up.railway.app"
