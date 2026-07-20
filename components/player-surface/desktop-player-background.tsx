"use client";

import { useEffect, useRef, useState } from "react";
import { HydrationSafeImage } from "@/components/ui/hydration-safe-image";
import { DesktopVideoDock, type DesktopVideoState } from "@/components/player-surface/desktop-video-dock";
import { reportPlaybackIncident, hostOnly, classifySource } from "@/lib/playback-telemetry-client";
import type { DesktopBackgroundMode } from "@/lib/desktop-background-mode";

// If the clip isn't actually playing this long after MPV is already progressing,
// treat it as a failure and fall back to artwork.
const VIDEO_READY_TIMEOUT_MS = 8000;

/**
 * Desktop player background, mode-driven and DISPLAY-ONLY (audio is always MPV).
 *
 * - artwork: full-bleed blurred/dark song artwork (already-loaded cover, no extra
 *   request), subtle CSS-only drift. The default — one media stream (MPV) only.
 * - video: the muted YouTube clip, but ONLY once MPV audio is actually
 *   progressing; artwork shows first, and any error/timeout/heavy-load falls back
 *   to artwork. Capped ≤480p. Never gates Play / next / MPV.
 * - static: plain dark background, no artwork motion, no video.
 *
 * Constraints honored: touches neither MPV nor the self-heal, adds no audio
 * source, and reports background telemetry on failure.
 */
export function DesktopPlayerBackground({
  mode,
  cover,
  videoId,
  mpvStatus,
  mpvPosition,
  currentPlayUrl,
  deviceId,
  deviceMode,
}: {
  mode: DesktopBackgroundMode;
  cover: string | null;
  videoId: string | null;
  mpvStatus: "idle" | "playing" | "paused" | "stopped";
  mpvPosition: number;
  currentPlayUrl: string | null;
  deviceId: string | null;
  deviceMode: string | null;
}) {
  // ── Is MPV audio actually progressing? (never start the clip before that) ──
  const lastPosRef = useRef(-1);
  const lastAdvanceAtRef = useRef(0);
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (mpvPosition > lastPosRef.current) lastAdvanceAtRef.current = Date.now();
    lastPosRef.current = mpvPosition;
  }, [mpvPosition]);
  // In video mode, tick so `mpvAdvancing` recomputes to false when position stalls.
  useEffect(() => {
    if (mode !== "video") return;
    const id = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [mode]);
  const mpvAdvancing =
    mpvStatus === "playing" && mpvPosition > 0 && Date.now() - lastAdvanceAtRef.current < 3000;

  // ── Video state + one-way fallback to artwork ──
  const [videoState, setVideoState] = useState<DesktopVideoState>({
    loading: false,
    playing: false,
    readyState: -1,
    error: false,
  });
  const [videoFailed, setVideoFailed] = useState(false);
  const reportedRef = useRef(false);
  // Reset per track / per mode change.
  useEffect(() => {
    setVideoFailed(false);
    reportedRef.current = false;
    setVideoState({ loading: false, playing: false, readyState: -1, error: false });
  }, [videoId, mode]);

  const reportFailure = (reason: string, snapshot: DesktopVideoState) => {
    if (reportedRef.current) return;
    reportedRef.current = true;
    reportPlaybackIncident({
      kind: "background_video_fallback",
      deviceId,
      deviceMode,
      platform: "desktop",
      sourceType: classifySource(currentPlayUrl),
      urlHost: hostOnly(currentPlayUrl),
      detail: {
        backgroundMode: mode,
        backgroundVideoLoading: snapshot.loading,
        backgroundVideoPlaying: snapshot.playing,
        backgroundVideoReadyState: snapshot.readyState,
        backgroundVideoError: snapshot.error,
        mpvStartedBeforeVideo: mpvAdvancing,
        reason,
      },
    });
  };

  // Explicit player error → fall back.
  useEffect(() => {
    if (mode === "video" && videoState.error && !videoFailed) {
      setVideoFailed(true);
      reportFailure("error", videoState);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, videoState.error, videoFailed]);

  // Ready timeout: MPV is progressing but the clip never reached "playing".
  useEffect(() => {
    if (mode !== "video" || !videoId || !mpvAdvancing || videoState.playing || videoFailed) return;
    const t = setTimeout(() => {
      setVideoFailed(true);
      reportFailure("timeout", { ...videoState, playing: false });
    }, VIDEO_READY_TIMEOUT_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, videoId, mpvAdvancing, videoState.playing, videoFailed]);

  const showVideo = mode === "video" && !!videoId && mpvAdvancing && !videoFailed;
  // Artwork is the base for artwork mode AND the loading/fallback state of video mode.
  const showArtwork = mode === "artwork" || (mode === "video" && !showVideo);

  return (
    <>
      {showArtwork && cover ? (
        <style>{"@keyframes sbBgDrift{0%{transform:scale(1.03)}100%{transform:scale(1.08)}}"}</style>
      ) : null}

      {mode === "static" ? (
        <div className="pointer-events-none absolute inset-0 -z-[2] bg-[#0b0f16]" aria-hidden />
      ) : null}

      {/* ARTWORK as a crisp still in the SAME right-half slot the video uses, with
          the left fog — it reads like a paused video frame (for YouTube the cover
          IS a video frame) but costs ZERO video load. Full dark base behind so the
          left/controls stay clean. */}
      {showArtwork ? (
        <div className="pointer-events-none absolute inset-0 -z-[2] bg-[#0b0f16]" aria-hidden />
      ) : null}
      {showArtwork && cover ? (
        <div
          className="pointer-events-none absolute -z-[1] inset-y-[5px] right-[9px] left-[42%] overflow-hidden rounded-r-[14px]"
          aria-hidden
        >
          <HydrationSafeImage
            src={cover}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            style={{ animation: "sbBgDrift 40s ease-in-out infinite alternate", willChange: "transform" }}
          />
          <div className="absolute inset-y-0 left-0 z-[1] w-2/3 bg-gradient-to-r from-[#0b0f16] via-[#0b0f16]/75 to-transparent" />
        </div>
      ) : null}

      {showVideo ? (
        <div
          className="pointer-events-none absolute -z-[1] inset-y-[5px] right-[9px] left-[42%] overflow-hidden rounded-r-[14px]"
          aria-hidden
        >
          <DesktopVideoDock
            videoId={videoId}
            mpvStatus={mpvStatus}
            mpvPosition={mpvPosition}
            className="absolute inset-0"
            onState={setVideoState}
            maxQuality="large"
          />
          <div className="absolute inset-y-0 left-0 z-[1] w-2/3 bg-gradient-to-r from-[#0b0f16] via-[#0b0f16]/75 to-transparent" />
        </div>
      ) : null}
    </>
  );
}
