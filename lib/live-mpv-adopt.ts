/**
 * Live-MPV adoption decision (pure, unit-testable).
 *
 * WHY: the desktop MPV engine runs in the Electron MAIN process, independent of the renderer. If the
 * renderer React tree remounts (a full (app)-layout remount / reload) while MPV is actively playing, the
 * new renderer must RE-OWN the running stream instead of re-loading it — otherwise it either restarts the
 * track (double-load) or orphans it (currentSource lost → plays to EOF then can't advance). This decides,
 * on the FIRST dispatch after a fresh mount, whether to ADOPT the already-playing engine.
 *
 * IDENTITY SAFETY (critical): adoption suppresses the initial `loadfile`, so it MUST prove the live engine
 * is playing the SAME media the renderer restored. We compare a canonical MEDIA KEY (a hash of the URL,
 * with the volatile media-session `mt` token + fragment stripped) between the renderer's restored play URL
 * and the live attempt's key reported by the desktop. If the desktop does not report a live key (older
 * build) or the keys differ, identity is UNPROVEN → DO NOT ADOPT → the caller falls through to a normal
 * `loadfile`, which converges the renderer and MPV on the restored URL (brief restart, never silence).
 *
 * FAIL-SAFE: every uncertain case returns false. Adoption never causes silence and never adopts a
 * different or stale track; at worst it declines and re-dispatches.
 */

export type LiveMpvSnapshot = {
  engineReady: boolean;
  /** The desktop's reported status for the current engine ("playing" | "paused" | "idle" | …). */
  status: string | null | undefined;
  /** The orchestrator's current attempt id echoed in the snapshot (0/undefined when none). */
  attemptId: number | null | undefined;
};

/**
 * Canonical media identity: trim, drop fragment, strip the volatile `mt` (media-session token) query
 * param, lowercase. So `/api/media/x?mt=A` and `/api/media/x?mt=B` — and a YouTube watch URL with/without
 * a fragment — resolve to the SAME identity. Pure; identical logic MUST live on the desktop side that
 * produces the live key (desktop/src/main/live-media-key.ts) — guarded by shared test vectors.
 */
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

/** Stable 32-bit FNV-1a hash of the canonical media id → hex. Leaks no path/URL (safe to expose over WS). */
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

/**
 * @param firstDispatch  true only for the very first MPV dispatch after this AudioPlayer mounted
 *                       (mpvLastUrl ref still null) — adoption applies only to a fresh renderer.
 * @param currentPlayUrl the URL the renderer now owns (restored from the recovery snapshot).
 * @param snap           the latest desktop MPV snapshot (engine health / status / attempt id).
 * @param liveMediaKey   the media key of the live attempt reported by the desktop (undefined on older
 *                       desktop builds → identity unprovable → do not adopt).
 */
export function shouldAdoptLiveMpv(
  firstDispatch: boolean,
  currentPlayUrl: string | null | undefined,
  snap: LiveMpvSnapshot | null | undefined,
  liveMediaKey: string | null | undefined,
): boolean {
  if (!firstDispatch) return false; // only re-own on a fresh mount, never mid-session
  const url = (currentPlayUrl ?? "").trim();
  if (!url) return false; // nothing to own
  if (!snap) return false;
  if (!snap.engineReady) return false; // engine not confirmed healthy → don't suppress a load
  if (snap.status !== "playing") return false; // paused/idle/stopped → not a live stream to adopt
  if (!(typeof snap.attemptId === "number" && snap.attemptId > 0)) return false; // no real attempt to align to
  const live = (liveMediaKey ?? "").trim();
  if (!live) return false; // desktop reported no live identity → cannot prove same media → do not adopt
  if (mediaKey(url) !== live) return false; // identity mismatch (live plays a DIFFERENT track) → do not adopt
  return true;
}
