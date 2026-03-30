/**
 * Playback foreground / resilience helpers (wake lock + lifecycle logging).
 *
 * ## What we can vs cannot do (be explicit — do not over-promise)
 *
 * **Screen sleep / dimming (Wake Lock API)**
 * - Desktop Chromium & Firefox (secure context): `navigator.wakeLock` often works while the
 *   document is visible. The lock is typically released when the tab is hidden or the user
 *   navigates away; we re-request when visibility returns if playback should still be active.
 * - Safari (desktop): support landed in newer versions; may be missing on older macOS Safari.
 * - iOS Safari / PWA: Screen Wake Lock is limited or unavailable compared to desktop; failures
 *   are expected and must be handled gracefully (no fake success).
 *
 * **Background tab / minimized window**
 * - Browsers throttle timers and may pause or degrade media in background tabs. YouTube iframes
 *   and complex JS players are especially sensitive. This is **not** something we can fully
 *   override from app code.
 *
 * **Device lock (phone locked)**
 * - On many mobile browsers, locking the screen suspends or stops web playback (especially
 *   non-audio-element paths like embedded video). **True uninterrupted playback while locked**
 *   is generally **not** guaranteed for our embed stack.
 *
 * **Resume after return**
 * - When the tab/app becomes visible again, we can re-issue `play()` on the HTMLAudioElement,
 *   and nudge YouTube / SoundCloud widgets if state still says "playing". This improves
 *   recovery but does not guarantee autoplay policies will allow resume without user gesture.
 *
 * Separation:
 * - Wake lock ≈ resist screen dim while **visible**.
 * - Background continuation ≈ browser policy (we log, we do not fake).
 * - Resume-after-return ≈ best-effort nudge when `visibilityState` / `pageshow` indicates return.
 */

export type PlaybackLifecyclePhase =
  | "platform_hint"
  | "visibility"
  | "pagehide"
  | "pageshow"
  | "freeze"
  | "resume"
  | "focus"
  | "blur"
  | "wake_lock_acquired"
  | "wake_lock_released"
  | "wake_lock_failed"
  | "wake_lock_implicit_release"
  | "resume_media_attempt"
  | "audio_unexpected_pause";

export type WakeLockRef = { current: WakeLockSentinel | null };

let wakeLockExplicitReleaseInProgress = false;

/** High-signal lifecycle line — separate from MVP product analytics. */
export function playbackLifecycleLog(phase: PlaybackLifecyclePhase, data?: Record<string, unknown>): void {
  console.log("[SyncBiz Lifecycle]", JSON.stringify(data ? { phase, ...data } : { phase }));
}

export async function acquirePlaybackWakeLock(sentinelRef: WakeLockRef): Promise<void> {
  if (typeof navigator === "undefined" || !("wakeLock" in navigator)) {
    playbackLifecycleLog("wake_lock_failed", { reason: "unsupported" });
    return;
  }
  if (typeof document !== "undefined" && document.hidden) {
    playbackLifecycleLog("wake_lock_failed", { reason: "document_hidden" });
    return;
  }
  try {
    await sentinelRef.current?.release();
  } catch {
    /* ignore */
  }
  sentinelRef.current = null;

  try {
    const w = navigator.wakeLock;
    if (!w) {
      playbackLifecycleLog("wake_lock_failed", { reason: "unsupported" });
      return;
    }
    const sentinel = await w.request("screen");
    sentinelRef.current = sentinel;
    sentinel.addEventListener("release", () => {
      if (!wakeLockExplicitReleaseInProgress) {
        playbackLifecycleLog("wake_lock_implicit_release", {});
      }
      if (sentinelRef.current === sentinel) {
        sentinelRef.current = null;
      }
    });
    playbackLifecycleLog("wake_lock_acquired", {});
  } catch (e) {
    playbackLifecycleLog("wake_lock_failed", { reason: "request_rejected", detail: String(e) });
  }
}

export async function releasePlaybackWakeLock(sentinelRef: WakeLockRef): Promise<void> {
  const s = sentinelRef.current;
  if (!s) return;
  wakeLockExplicitReleaseInProgress = true;
  try {
    await s.release();
    playbackLifecycleLog("wake_lock_released", { explicit: true });
  } catch (e) {
    playbackLifecycleLog("wake_lock_failed", { reason: "release_error", detail: String(e) });
  } finally {
    wakeLockExplicitReleaseInProgress = false;
    sentinelRef.current = null;
  }
}
