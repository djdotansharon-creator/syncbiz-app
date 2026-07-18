"use client";

import { useEffect, useRef } from "react";

/**
 * DESKTOP video dock — display-only, audio-safe.
 *
 * The desktop app plays audio through MPV (native). MPV runs `--no-video`, so
 * there is no picture. This mounts a MUTED YouTube iframe that shows ONLY the
 * video, kept roughly in sync with MPV's reported position. It NEVER produces
 * audio (mute() + volume 0, re-asserted every tick) so there is zero risk of
 * double audio, and it lives in its own component so a failure here cannot take
 * down the audio player. Enabled only on desktop + YouTube tracks.
 */

type YTPlayerLike = {
  loadVideoById?: (id: string, start?: number) => void;
  playVideo?: () => void;
  pauseVideo?: () => void;
  mute?: () => void;
  setVolume?: (v: number) => void;
  seekTo?: (s: number, allow: boolean) => void;
  getCurrentTime?: () => number;
  getIframe?: () => HTMLIFrameElement | null;
  destroy?: () => void;
};

type YTGlobal = { Player: new (el: HTMLElement, opts: Record<string, unknown>) => YTPlayerLike };

/** Read window.YT without fighting the app's existing (stricter) global type. */
function getYT(): YTGlobal | null {
  if (typeof window === "undefined") return null;
  const yt = (window as unknown as { YT?: unknown }).YT as { Player?: unknown } | undefined;
  return yt && typeof yt.Player === "function" ? (yt as unknown as YTGlobal) : null;
}

/** Load the IFrame API once (idempotent) and resolve when window.YT is ready. */
function ensureYouTubeApi(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") return resolve();
    if (getYT()) return resolve();
    const w = window as unknown as { onYouTubeIframeAPIReady?: () => void };
    const existing = document.querySelector<HTMLScriptElement>("script[data-syncbiz-yt-api]");
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      try {
        prev?.();
      } catch {
        /* ignore other listeners */
      }
      resolve();
    };
    if (!existing) {
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      s.async = true;
      s.setAttribute("data-syncbiz-yt-api", "1");
      document.head.appendChild(s);
    }
    // Safety: resolve after a poll even if the callback never fires.
    let tries = 0;
    const iv = setInterval(() => {
      if (getYT()) {
        clearInterval(iv);
        resolve();
      } else if (++tries > 100) {
        clearInterval(iv);
        resolve();
      }
    }, 100);
  });
}

/** Drift beyond this (seconds) triggers a re-seek to MPV position. */
const SYNC_DRIFT_SECONDS = 2;

export function DesktopVideoDock({
  videoId,
  mpvStatus,
  mpvPosition,
  className,
}: {
  videoId: string | null;
  mpvStatus: "idle" | "playing" | "paused" | "stopped";
  mpvPosition: number;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPlayerLike | null>(null);
  const currentVidRef = useRef<string | null>(null);
  const mpvPosRef = useRef(mpvPosition);
  const mpvStatusRef = useRef(mpvStatus);
  useEffect(() => {
    mpvPosRef.current = mpvPosition;
    mpvStatusRef.current = mpvStatus;
  }, [mpvPosition, mpvStatus]);

  // Create the player once.
  useEffect(() => {
    let cancelled = false;
    void ensureYouTubeApi().then(() => {
      const YT = getYT();
      if (cancelled || !hostRef.current || playerRef.current || !YT) return;
      try {
        playerRef.current = new YT.Player(hostRef.current, {
          width: 320,
          height: 180,
          videoId: currentVidRef.current ?? undefined,
          playerVars: {
            autoplay: 1,
            controls: 0,
            disablekb: 1,
            fs: 0,
            iv_load_policy: 3,
            rel: 0,
            modestbranding: 1,
            mute: 1,
            playsinline: 1,
          },
          events: {
            onReady: (e: { target: YTPlayerLike }) => {
              try {
                e.target.mute?.();
                e.target.setVolume?.(0);
                const f = e.target.getIframe?.();
                if (f) {
                  const s = f.style;
                  s.position = "absolute";
                  s.left = "-10%";
                  s.top = "50%";
                  s.width = "120%";
                  s.height = "auto";
                  s.aspectRatio = "16 / 9";
                  s.transform = "translateY(-50%)";
                  s.border = "0";
                  s.pointerEvents = "none";
                }
              } catch {
                /* display-only */
              }
            },
          },
        });
      } catch {
        /* never break the player */
      }
    });
    return () => {
      cancelled = true;
      try {
        playerRef.current?.destroy?.();
      } catch {
        /* ignore */
      }
      playerRef.current = null;
    };
  }, []);

  // Load a new video when the track changes.
  useEffect(() => {
    if (videoId === currentVidRef.current) return;
    currentVidRef.current = videoId;
    const p = playerRef.current;
    if (!p || !videoId) return;
    try {
      p.loadVideoById?.(videoId, Math.max(0, mpvPosRef.current));
      p.mute?.();
      p.setVolume?.(0);
    } catch {
      /* ignore */
    }
  }, [videoId]);

  // Keep muted + in rough sync with MPV; follow play/pause.
  useEffect(() => {
    const iv = setInterval(() => {
      const p = playerRef.current;
      if (!p) return;
      try {
        p.mute?.(); // re-assert every tick — audio must NEVER come from here
        p.setVolume?.(0);
        const st = mpvStatusRef.current;
        if (st === "playing") {
          p.playVideo?.();
          const cur = p.getCurrentTime?.() ?? 0;
          const target = mpvPosRef.current;
          if (target > 0 && Math.abs(cur - target) > SYNC_DRIFT_SECONDS) {
            p.seekTo?.(target, true);
          }
        } else if (st === "paused" || st === "stopped" || st === "idle") {
          p.pauseVideo?.();
        }
      } catch {
        /* display-only */
      }
    }, 1500);
    return () => clearInterval(iv);
  }, []);

  return <div className={className} aria-hidden><div ref={hostRef} className="h-full w-full" /></div>;
}
