/**
 * Live media identity for renderer adoption after a remount — MUST stay byte-identical to the renderer's
 * `canonicalMediaId` / `mediaKey` in `lib/live-mpv-adopt.ts`. The desktop MAIN publishes `mediaKey` of the
 * active attempt's URL in its status; the renderer compares it to `mediaKey(restored currentPlayUrl)` and
 * only ADOPTS (suppresses the initial loadfile) when they match. The key is a hash → it leaks no path/URL,
 * so it is safe to include in any status payload (local IPC or WS).
 *
 * Divergence guard: `desktop/scripts/verify-attempt-mode.ts` and `scripts/verify-live-mpv-adopt.ts` assert
 * the SAME fixed test vectors against both copies. Change one → change the other → both suites must pass.
 */

/** Trim, drop fragment, strip the volatile `mt` (media-session token) query param, lowercase. */
export function canonicalMediaId(url: string | null | undefined): string {
  const raw = (url ?? "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      u.hash = ""; // drop fragment
      u.searchParams.delete("mt"); // drop the volatile media-session token
      // URL parsing lowercases protocol + host; pathname CASE and query VALUES are preserved verbatim, so
      // case-sensitive media ids (e.g. a YouTube ?v=AbC123) keep their distinct identity.
      return `${u.protocol}//${u.host}${u.pathname}${u.search}`;
    } catch {
      /* not a parseable URL — fall through to path handling */
    }
  }
  // Local paths / non-URLs: Windows paths are case-INsensitive, so lowercasing is the intended identity.
  let s = raw;
  const hashAt = s.indexOf("#");
  if (hashAt >= 0) s = s.slice(0, hashAt);
  s = s.replace(/([?&])mt=[^&]*/i, "$1").replace(/[?&]+$/, "");
  return s.toLowerCase();
}

/** Stable 32-bit FNV-1a hash of the canonical media id → hex. Leaks no path/URL. */
export function mediaKey(url: string | null | undefined): string {
  const s = canonicalMediaId(url);
  if (!s) return "";
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}
