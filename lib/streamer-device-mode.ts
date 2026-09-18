/**
 * Dedicated branch player mode for GOtv / Android TV / headless streamers.
 *
 * Canonical URL: `/streamer` (optionally bootstrapped via `?device=streamer&mode=player`).
 * Persists a localStorage flag so refresh/reconnect keeps dedicated-player semantics.
 */

export const STREAMER_DEVICE_STORAGE_KEY = "syncbiz-streamer-device";

export function isStreamerRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return pathname === "/streamer" || pathname.startsWith("/streamer/");
}

export function readStreamerDeviceFlag(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(STREAMER_DEVICE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function persistStreamerDeviceFlag(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STREAMER_DEVICE_STORAGE_KEY, "1");
  } catch {
    /* ignore */
  }
}

/** Returns true when query params request dedicated streamer player bootstrap. */
export function streamerQueryParamsActive(search: string | URLSearchParams): boolean {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  return params.get("device") === "streamer" && params.get("mode") === "player";
}

/**
 * Active on the dedicated `/streamer` route only (never the mobile controller shell).
 */
export function isStreamerDeviceMode(pathname: string | null | undefined): boolean {
  return isStreamerRoute(pathname);
}

/**
 * True ONLY inside the VONO Android native shell WebView on the dedicated streamer
 * bootstrap URL — all four must hold: route `/streamer`, `device=streamer`,
 * `mode=player`, AND an Android WebView user-agent (the `; wv)` token).
 *
 * In that shell the NATIVE ExoPlayer foreground service is the sole
 * `branch_streamer_station` MASTER, so this WebView must be a controller/mirror
 * only: it must NOT register as a branch_streamer_station device, must NOT own
 * local branch audio, and must NOT reclaim MASTER. Any other `/streamer` client
 * (a real browser tab, the old GOtv WebView build) is unaffected.
 *
 * Client-only (reads `navigator`/`location`); returns false during SSR.
 */
export function isNativeShellStreamerMode(pathname: string | null | undefined): boolean {
  if (typeof window === "undefined") return false;
  if (!isStreamerRoute(pathname)) return false;
  try {
    if (!streamerQueryParamsActive(window.location.search)) return false;
    const ua = navigator.userAgent || "";
    // Android System WebView UA carries the "; wv)" token; Chrome/Firefox do not.
    return /;\s*wv\)/i.test(ua);
  } catch {
    return false;
  }
}
