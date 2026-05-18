/**
 * User-agent detection helpers.
 *
 * Tablets (iPad, Android tablets) are explicitly separated from phones so
 * they receive the large-screen desktop UI and register as web-class devices
 * on the WebSocket server — not as mobile/phone devices.
 *
 * Usable in both the Next.js Edge runtime (middleware.ts) and browser code
 * (ws-client.ts) because this module contains only pure string operations.
 */

/**
 * Returns true when the UA string indicates a tablet.
 *
 * Detection rules:
 *  - iPad: UA contains "iPad" (covers iPadOS up to v12; v13+ in default mode
 *    also sends iPad in UA unless "Request Desktop Website" is enabled by the user —
 *    in that case it mimics macOS and falls through to the desktop path, which is correct).
 *  - Android tablet: has "Android" but NOT the "Mobile" token.
 *    Android phones always include "Mobile"; Android tablets omit it.
 */
export function isTabletUa(ua: string): boolean {
  if (/iPad/i.test(ua)) return true;
  if (/Android/i.test(ua) && !/Mobile/i.test(ua)) return true;
  return false;
}

/**
 * Returns true for phone-class mobile devices only. Tablets are excluded.
 *
 * Use this function (not a raw UA regex) wherever routing or role assignment
 * decisions must distinguish phones from large-screen clients.
 */
export function isPhoneUa(ua: string): boolean {
  if (isTabletUa(ua)) return false;
  return /webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini|Opera Mobi|Silk|Mobile/i.test(ua);
}
