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

/**
 * Production WebSocket endpoint baked for packaged installs. MAIN's runtime config `wsUrl` defaults to this in
 * packaged builds (and legacy localhost values self-heal to it) so a fresh production install needs no manual
 * endpoint config. Dev/non-packaged keeps ws://localhost:3001.
 */
export const SYNCBIZ_PROD_WS_URL = "wss://syncbiz-ws-production.up.railway.app";
