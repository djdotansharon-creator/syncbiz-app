/**
 * Client-side Media Session Token holder + URL helpers (Stage A).
 *
 * The token is MEMORY-ONLY (never persisted, never on PlaylistTrack.url, never over WS). The Music Bank
 * panel authorizes once, stores the token here, and refreshes it in the background before expiry. The
 * playback read path (getPlayUrl) appends the CURRENT token to a SyncBiz media URL synchronously — no
 * I/O, no await. Logs use redactMediaToken so a token never reaches a log line.
 */

let currentToken: string | null = null;
let currentExpEpoch = 0; // unix seconds

export function setMediaSessionToken(token: string, expEpochSeconds: number): void {
  currentToken = token || null;
  currentExpEpoch = Number.isFinite(expEpochSeconds) ? expEpochSeconds : 0;
}

export function clearMediaSessionToken(): void {
  currentToken = null;
  currentExpEpoch = 0;
}

export function getMediaSessionToken(): string | null {
  return currentToken;
}

/** Seconds of life left on the held token (0 if none/expired). Used by the client's refresh scheduler. */
export function mediaTokenRemainingSec(): number {
  if (!currentToken || !currentExpEpoch) return 0;
  return Math.max(0, currentExpEpoch - Math.floor(Date.now() / 1000));
}

/** True for a SyncBiz Music Bank media URL (`/api/media/<assetId>`), absolute or relative. */
export function isSyncBizMediaUrl(url: string | null | undefined): boolean {
  return !!url && /\/api\/media\//.test(url);
}

/**
 * Append the current media session token to a SyncBiz media URL. Pure, synchronous, no network.
 * - Non-media URLs (local/YouTube/regular HTTPS): returned UNCHANGED.
 * - Media URL with no token held: returned UNCHANGED (controlled — the endpoint 401s and the existing
 *   playback failure path handles it; never makes a network call from here).
 * - Media URL already carrying `mt=`: returned UNCHANGED (no double-append).
 */
export function appendMediaToken(url: string | null | undefined): string | null {
  if (url == null) return null;
  if (!isSyncBizMediaUrl(url)) return url;
  if (/[?&]mt=/.test(url)) return url;
  const t = currentToken;
  if (!t) return url;
  return `${url}${url.includes("?") ? "&" : "?"}mt=${encodeURIComponent(t)}`;
}

/** Redact the `mt=` media token from any URL for safe logging. */
export function redactMediaToken(url: string | null | undefined): string {
  if (url == null) return String(url);
  return String(url).replace(/([?&]mt=)[^&\s"']*/gi, "$1[REDACTED]");
}
