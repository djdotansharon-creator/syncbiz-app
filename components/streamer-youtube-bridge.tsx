"use client";

/**
 * StreamerYouTubeBridge — dedicated, isolated YouTube-only foreground player for the
 * VONO Android native shell (`/streamer`).
 *
 * WHY THIS EXISTS (see the YouTube-compatibility architecture):
 * The native ExoPlayer service is the sole branch_streamer_station MASTER and plays
 * URL/Radio/Music Bank natively in the background. It cannot play YouTube. When a
 * YouTube PLAY_SOURCE reaches the native MASTER while the app is in the foreground, the
 * native side forwards it — over an ORIGIN-RESTRICTED WebMessage channel (androidx
 * `WebViewCompat.addWebMessageListener`, allow-listed to the VONO origin) — to THIS
 * component, which drives its OWN YouTube IFrame player.
 *
 * HARD ISOLATION (by design — do not widen):
 *   - Activated ONLY by explicit native messages over `window.VonoBridge`.
 *   - Controls ONLY its own YouTube player. Never touches PlaybackProvider,
 *     DevicePlayerContext, AudioPlayer, MASTER election, or local-playback rules.
 *   - Cannot play URL/Radio/Music Bank. Cannot claim MASTER. Cannot trigger
 *     playing-player protection.
 *   - Completely inert in a normal browser (no `window.VonoBridge`) → renders nothing,
 *     loads no script, adds no listeners.
 *
 * The native MASTER stays authoritative: this component only REPORTS YouTube state back
 * over the same channel; the native service folds it into the branch STATE_UPDATE.
 */

import { useEffect, useRef, useState } from "react";
import { getYouTubeVideoId } from "@/lib/playlist-utils";
import {
  isYtPlayerReady,
  safeLoadVideoById,
  safePlayVideo,
  safePauseVideo,
  safeStopVideo,
  safeSeekTo,
  safeSetVolume,
  safeGetCurrentTime,
  safeGetDuration,
  safeGetVideoData,
  type YTPlayerAPI,
} from "@/lib/yt-player-utils";

/** The JS object injected by the native origin-restricted WebMessage bridge. */
interface VonoBridgeJs {
  postMessage: (message: string) => void;
  onmessage: ((event: { data: string }) => void) | null;
  addEventListener?: (type: "message", listener: (event: { data: string }) => void) => void;
  removeEventListener?: (type: "message", listener: (event: { data: string }) => void) => void;
}

function getBridge(): VonoBridgeJs | null {
  if (typeof window === "undefined") return null;
  const b = (window as unknown as { VonoBridge?: VonoBridgeJs }).VonoBridge;
  return b && typeof b.postMessage === "function" ? b : null;
}

/** Native → web command envelope. */
type NativeMsg =
  | { t: "play"; url?: string; title?: string; urls?: string[] }
  | { t: "pause" }
  | { t: "resume" }
  | { t: "stop" }
  | { t: "next" }
  | { t: "prev" }
  | { t: "seek"; position?: number }
  | { t: "volume"; volume?: number };

export function StreamerYouTubeBridge() {
  const [active, setActive] = useState(false); // a YouTube session is loaded/visible
  const bridgeRef = useRef<VonoBridgeJs | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayerAPI | null>(null);
  const queueRef = useRef<string[]>([]); // video ids
  const indexRef = useRef(0);
  const titleRef = useRef<string>("");
  const pendingPlayRef = useRef(false); // play requested before the player was ready

  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) return; // normal browser → fully inert
    bridgeRef.current = bridge;

    const post = (obj: Record<string, unknown>) => {
      try {
        bridge.postMessage(JSON.stringify(obj));
      } catch {
        /* ignore */
      }
    };

    const reportState = (status: "playing" | "paused" | "ended" | "stopped" | "error") => {
      const p = playerRef.current;
      const data = isYtPlayerReady(p) ? safeGetVideoData(p) : null;
      post({
        t: "yt",
        status,
        title: data?.title || titleRef.current || "YouTube",
        videoId: data?.video_id || queueRef.current[indexRef.current] || "",
        position: isYtPlayerReady(p) ? safeGetCurrentTime(p) : 0,
        duration: isYtPlayerReady(p) ? safeGetDuration(p) : 0,
        index: indexRef.current,
        count: queueRef.current.length,
      });
    };

    const idsFromMsg = (m: Extract<NativeMsg, { t: "play" }>): string[] => {
      const raw = Array.isArray(m.urls) && m.urls.length > 0 ? m.urls : m.url ? [m.url] : [];
      const ids: string[] = [];
      for (const u of raw) {
        const id = getYouTubeVideoId(u);
        if (id) ids.push(id);
      }
      return ids;
    };

    const playIndex = (i: number) => {
      const ids = queueRef.current;
      if (i < 0 || i >= ids.length) return;
      indexRef.current = i;
      const p = playerRef.current;
      if (isYtPlayerReady(p)) {
        safeLoadVideoById(p, ids[i]!);
        safePlayVideo(p);
      } else {
        pendingPlayRef.current = true;
        ensurePlayer();
      }
    };

    // ── the dedicated YouTube player (own instance; never AudioPlayer's) ──
    const buildPlayer = () => {
      if (!window.YT?.Player || !containerRef.current) return;
      if (playerRef.current) return;
      const first = queueRef.current[indexRef.current] ?? "";
      new window.YT.Player(containerRef.current, {
        videoId: first,
        width: 640,
        height: 360,
        playerVars: {
          enablejsapi: 1,
          autoplay: pendingPlayRef.current ? 1 : 0,
          origin: window.location.origin,
        },
        events: {
          onReady(evt: { target: unknown }) {
            const target = evt.target;
            if (!isYtPlayerReady(target)) return;
            playerRef.current = target;
            if (pendingPlayRef.current) {
              pendingPlayRef.current = false;
              safePlayVideo(target);
            }
          },
          onStateChange(evt: { data: number }) {
            const YT = window.YT;
            if (!YT) return;
            if (evt.data === YT.PlayerState.PLAYING) reportState("playing");
            else if (evt.data === YT.PlayerState.PAUSED) reportState("paused");
            else if (evt.data === YT.PlayerState.ENDED) {
              if (indexRef.current < queueRef.current.length - 1) playIndex(indexRef.current + 1);
              else reportState("ended");
            }
          },
          onError() {
            reportState("error");
          },
        },
      });
    };

    const ensurePlayer = () => {
      setActive(true);
      if (window.YT?.Player) {
        buildPlayer();
        return;
      }
      // Load the IFrame API once; chain any existing ready hook.
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prev?.();
        buildPlayer();
      };
      if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
        const tag = document.createElement("script");
        tag.src = "https://www.youtube.com/iframe_api";
        const firstScript = document.getElementsByTagName("script")[0];
        firstScript?.parentNode?.insertBefore(tag, firstScript);
      }
    };

    const handle = (raw: string) => {
      let m: NativeMsg;
      try {
        m = JSON.parse(raw) as NativeMsg;
      } catch {
        return;
      }
      switch (m.t) {
        case "play": {
          const ids = idsFromMsg(m);
          if (ids.length === 0) {
            post({ t: "yt", status: "error", title: m.title || "YouTube", videoId: "", position: 0, duration: 0, index: 0, count: 0 });
            return;
          }
          queueRef.current = ids;
          indexRef.current = 0;
          titleRef.current = m.title || "YouTube";
          playIndex(0);
          break;
        }
        case "resume":
          if (isYtPlayerReady(playerRef.current)) safePlayVideo(playerRef.current);
          break;
        case "pause":
          if (isYtPlayerReady(playerRef.current)) safePauseVideo(playerRef.current);
          break;
        case "stop":
          if (isYtPlayerReady(playerRef.current)) safeStopVideo(playerRef.current);
          queueRef.current = [];
          indexRef.current = 0;
          setActive(false);
          reportState("stopped");
          break;
        case "next":
          if (indexRef.current < queueRef.current.length - 1) playIndex(indexRef.current + 1);
          break;
        case "prev":
          if (indexRef.current > 0) playIndex(indexRef.current - 1);
          break;
        case "seek":
          if (typeof m.position === "number" && isYtPlayerReady(playerRef.current)) safeSeekTo(playerRef.current, m.position, true);
          break;
        case "volume":
          if (typeof m.volume === "number" && isYtPlayerReady(playerRef.current)) safeSetVolume(playerRef.current, Math.max(0, Math.min(100, m.volume)));
          break;
      }
    };

    // Wire the channel. WebMessageListener exposes onmessage + addEventListener.
    const listener = (event: { data: string }) => handle(event.data);
    if (bridge.addEventListener) bridge.addEventListener("message", listener);
    else bridge.onmessage = listener;

    // LIFECYCLE RULE: announce READY on mount AND whenever the page becomes visible
    // again (resume). The native side clears its reply-proxy on pause/reload/navigate and
    // requires a fresh `ready` before it will forward any YouTube command.
    const announceReady = () => post({ t: "ready" });
    announceReady();
    const onVisible = () => {
      if (document.visibilityState === "visible") announceReady();
    };
    const onPageShow = () => announceReady();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageShow);

    // Position heartbeat while a session is loaded (native uses this for STATE_UPDATE position).
    const tick = window.setInterval(() => {
      const p = playerRef.current;
      if (isYtPlayerReady(p) && queueRef.current.length > 0) {
        post({ t: "yt_pos", position: safeGetCurrentTime(p), duration: safeGetDuration(p) });
      }
    }, 1000);

    return () => {
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
      if (bridge.removeEventListener) bridge.removeEventListener("message", listener);
      else if (bridge.onmessage === listener) bridge.onmessage = null;
      const p = playerRef.current;
      if (isYtPlayerReady(p)) safeStopVideo(p);
    };
  }, []);

  // Inert in a normal browser (no native bridge) → render nothing at all.
  if (!getBridge()) return null;

  return (
    <div
      aria-hidden={!active}
      style={{
        // Kept mounted so the YT.Player node is stable; visible only while a YouTube
        // session is active (YouTube throttles playback in hidden/zero-size frames).
        position: active ? "static" : "absolute",
        width: active ? "100%" : 1,
        height: active ? "auto" : 1,
        overflow: "hidden",
        opacity: active ? 1 : 0,
        pointerEvents: active ? "auto" : "none",
      }}
    >
      <div ref={containerRef} className="aspect-video w-full max-w-3xl overflow-hidden rounded-xl bg-black" />
    </div>
  );
}
