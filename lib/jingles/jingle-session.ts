/**
 * Client-side Jingle Access Token holder + URL helper (F3).
 *
 * The token is MEMORY-ONLY (never persisted, never stored on an Announcement / pad row, never part of
 * the saved jingle URL). A mount (`<JingleSession/>`) authorizes once via POST /api/jingles/authorize
 * and refreshes it in the background before expiry. At fire time the dispatcher appends the CURRENT
 * token to a jingle audio URL synchronously — no I/O, no await — so a fire stays instant.
 *
 * Only `/api/jingles/audio/<id>` URLs are tokenized. A pre-roll bell (`/api/jingles/bell/<style>`) is a
 * synthesized, non-tenant preset and is returned UNCHANGED (it stays unauthenticated by design).
 */

let currentToken: string | null = null;
let currentExpEpoch = 0; // unix seconds
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) { try { l(); } catch { /* ignore */ } }
}

/** Subscribe to token changes (set/clear). Returns an unsubscribe fn. */
export function subscribeJingleSession(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** Atomic replace — the previous token stays live until this single assignment completes. */
export function setJingleToken(token: string, expEpochSeconds: number): void {
  currentToken = token || null;
  currentExpEpoch = Number.isFinite(expEpochSeconds) ? expEpochSeconds : 0;
  notify();
}

export function clearJingleToken(): void {
  currentToken = null;
  currentExpEpoch = 0;
  notify();
}

export function getJingleToken(): string | null {
  return currentToken;
}

/** Seconds of life left on the held token (0 if none/expired). Used by the refresh scheduler. */
export function jingleTokenRemainingSec(): number {
  if (!currentToken || !currentExpEpoch) return 0;
  return Math.max(0, currentExpEpoch - Math.floor(Date.now() / 1000));
}

/** True for a jingle AUDIO URL (`/api/jingles/audio/<id>`), absolute or relative. Bell URLs are false. */
export function isJingleAudioUrl(url: string | null | undefined): boolean {
  return !!url && /\/api\/jingles\/audio\//.test(url);
}

/**
 * Append the current jingle token to a jingle audio URL. Pure, synchronous, no network.
 * - Non-jingle-audio URLs (bell, external, anything else): returned UNCHANGED.
 * - Jingle audio URL with no token held: returned UNCHANGED (the route then falls back to the session
 *   cookie, and 401s only if neither is present — never a network call from here).
 * - Jingle audio URL already carrying `jt=`: returned UNCHANGED (no double-append).
 */
export function appendJingleToken(url: string): string {
  if (!isJingleAudioUrl(url)) return url;
  if (/[?&]jt=/.test(url)) return url;
  const t = currentToken;
  if (!t) return url;
  return `${url}${url.includes("?") ? "&" : "?"}jt=${encodeURIComponent(t)}`;
}
