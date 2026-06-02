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
