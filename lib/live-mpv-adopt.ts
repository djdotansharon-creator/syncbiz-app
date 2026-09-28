/**
 * Live-MPV adoption decision (pure, unit-testable).
 *
 * WHY: the desktop MPV engine runs in the Electron MAIN process, independent of the renderer. If the
 * renderer React tree remounts (a full (app)-layout remount / reload) while MPV is actively playing, the
 * new renderer must RE-OWN the running stream instead of re-loading it — otherwise it either restarts the
 * track (double-load) or, worse, orphans it (currentSource lost → the track plays to EOF and then can't
 * advance because the renderer owns no queue). This decides, on the FIRST dispatch after a fresh mount,
 * whether to ADOPT the already-playing engine (suppress the initial `loadfile`, align the attempt id) vs.
 * dispatch normally.
 *
 * FAIL-SAFE: it returns true ONLY when the desktop reports a healthy, actively-PLAYING engine with a real
 * attempt id and we have a play URL to own. In every uncertain case it returns false → the caller falls
 * through to the normal `loadfile` path (the music restarts but never goes silent). Adoption never causes
 * silence; at worst it declines and re-dispatches.
 */

export type LiveMpvSnapshot = {
  engineReady: boolean;
  /** The desktop's reported playback status for the current engine ("playing" | "paused" | "idle" | …). */
  status: string | null | undefined;
  /** The orchestrator's current attempt id echoed in the snapshot (0/undefined when none). */
  attemptId: number | null | undefined;
};

/**
 * @param firstDispatch  true only for the very first MPV dispatch after this AudioPlayer mounted
 *                       (mpvLastUrl ref still null) — adoption applies only to a fresh renderer.
 * @param currentPlayUrl the URL the renderer now owns (restored from the recovery snapshot).
 * @param snap           the latest desktop MPV snapshot.
 */
export function shouldAdoptLiveMpv(
  firstDispatch: boolean,
  currentPlayUrl: string | null | undefined,
  snap: LiveMpvSnapshot | null | undefined,
): boolean {
  if (!firstDispatch) return false; // only re-own on a fresh mount, never mid-session
  const url = (currentPlayUrl ?? "").trim();
  if (!url) return false; // nothing to own
  if (!snap) return false;
  if (!snap.engineReady) return false; // engine not confirmed healthy → don't suppress a load
  if (snap.status !== "playing") return false; // paused/idle/stopped → not a live stream to adopt
  if (!(typeof snap.attemptId === "number" && snap.attemptId > 0)) return false; // no real attempt to align to
  return true;
}
