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
 * QUEUE / NAVIGATION:
 *   - A YouTube playlist/mix arriving as a single URL with a `list=` id is played via
 *     YouTube's NATIVE playlist support (playerVars.list) and navigated with
 *     nextVideo()/previousVideo() — YouTube expands and advances the list itself.
 *   - An expanded set of track URLs is played as an explicit queue (loadVideoById).
 *   - On EVERY actual track change the current video (videoId + title + playlist
 *     index/count) is read fresh from the player and reported to native — never stale.
 *
 * The native MASTER stays authoritative: this component only REPORTS state back over the
 * same channel; the native service folds it into the branch STATE_UPDATE.
 */

import { useEffect, useRef, useState } from "react";
import { getYouTubeVideoId, getYouTubePlaylistId } from "@/lib/playlist-utils";
import {
  isYtPlayerReady,
  safeLoadVideoById,
  safeNextVideo,
  safePreviousVideo,
  safePlayVideo,
  safePauseVideo,
  safeStopVideo,
  safeSeekTo,
  safeSetVolume,
  safeGetCurrentTime,
  safeGetDuration,
  safeGetVideoData,
  safeGetPlaylist,
  safeGetPlaylistIndex,
  safeDestroyYtPlayer,
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

/** A YouTube list id we can hand to the native player (mixes RD…, playlists PL…/UU…/OLAK…). */
function playableListId(id: string | null): string | null {
  if (!id) return null;
  return /^(RD|PL|UU|OLAK|LL|FL)/.test(id) ? id : null;
}

export function StreamerYouTubeBridge() {
  const [active, setActive] = useState(false); // a YouTube session is loaded/visible
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayerAPI | null>(null);
  const queueRef = useRef<string[]>([]); // explicit-mode video ids
  const indexRef = useRef(0); // explicit-mode index
  const usingListRef = useRef(false); // YouTube-native playlist mode
  const listIdRef = useRef<string | null>(null);
  const titleRef = useRef<string>("");

  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) return; // normal browser → fully inert

    const post = (obj: Record<string, unknown>) => {
      try {
        bridge.postMessage(JSON.stringify(obj));
      } catch {
        /* ignore */
      }
    };

    /** Read the REAL current video from the player and report it (never stale). */
    const reportState = (status: "playing" | "paused" | "ended" | "stopped" | "error") => {
      const p = playerRef.current;
      const ready = isYtPlayerReady(p);
      const data = ready ? safeGetVideoData(p) : null;
      let index = indexRef.current;
      let count = queueRef.current.length;
      if (ready && usingListRef.current) {
        const list = safeGetPlaylist(p);
        if (list.length > 0) {
          count = list.length;
          index = safeGetPlaylistIndex(p);
        }
      }
      post({
        t: "yt",
        status,
        title: data?.title || titleRef.current || "YouTube",
        videoId: data?.video_id || queueRef.current[indexRef.current] || "",
        position: ready ? safeGetCurrentTime(p) : 0,
        duration: ready ? safeGetDuration(p) : 0,
        index,
        count,
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

    const onStateChange = (evt: { data: number }) => {
      const YT = window.YT;
      if (!YT) return;
      if (evt.data === YT.PlayerState.PLAYING) {
        // Fires on the FIRST video and on EVERY subsequent track change → fresh metadata.
        reportState("playing");
      } else if (evt.data === YT.PlayerState.PAUSED) {
        reportState("paused");
      } else if (evt.data === YT.PlayerState.ENDED) {
        const p = playerRef.current;
        if (usingListRef.current) {
          // YouTube auto-advances within a native playlist; only the LAST item's ENDED is final.
          const list = safeGetPlaylist(p);
          const idx = safeGetPlaylistIndex(p);
          if (list.length === 0 || idx >= list.length - 1) reportState("ended");
          // else: intermediate end — YouTube will play the next item (a new PLAYING fires).
        } else if (indexRef.current < queueRef.current.length - 1) {
          playIndex(indexRef.current + 1); // explicit queue advance
        } else {
          reportState("ended");
        }
      }
    };

    /** Explicit-queue navigation (non-list mode). */
    const playIndex = (i: number) => {
      const ids = queueRef.current;
      if (i < 0 || i >= ids.length) return;
      indexRef.current = i;
      const p = playerRef.current;
      if (isYtPlayerReady(p)) {
        safeLoadVideoById(p, ids[i]!);
        safePlayVideo(p);
      }
    };

    /** (Re)create a fresh player for a NEW source. Destroys any prior instance for clean state. */
    const startSession = (firstVideoId: string) => {
      setActive(true);
      const build = () => {
        if (!window.YT?.Player || !containerRef.current) return;
        safeDestroyYtPlayer(playerRef.current);
        playerRef.current = null;
        const playerVars: Record<string, string | number> = {
          enablejsapi: 1,
          autoplay: 1,
          origin: window.location.origin,
        };
        if (usingListRef.current && listIdRef.current) {
          playerVars.list = listIdRef.current;
          playerVars.listType = "playlist";
        }
        new window.YT.Player(containerRef.current, {
          videoId: firstVideoId,
          width: "100%",
          height: "100%",
          playerVars,
          events: {
            onReady(evt: { target: unknown }) {
              const target = evt.target;
              if (!isYtPlayerReady(target)) return;
              playerRef.current = target;
              safePlayVideo(target);
            },
            onStateChange,
            onError() {
              reportState("error");
            },
          },
        });
      };
      if (window.YT?.Player) {
        build();
        return;
      }
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prev?.();
        build();
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
          const listId = playableListId(getYouTubePlaylistId(m.url ?? ""));
          const ids = idsFromMsg(m);
          if (!listId && ids.length === 0) {
            post({ t: "yt", status: "error", title: m.title || "YouTube", videoId: "", position: 0, duration: 0, index: 0, count: 0 });
            return;
          }
          titleRef.current = m.title || "YouTube";
          if (listId) {
            // YouTube-native playlist/mix: let the player expand + navigate the list itself.
            usingListRef.current = true;
            listIdRef.current = listId;
            queueRef.current = ids; // may hold the anchor video id
            indexRef.current = 0;
            startSession(ids[0] ?? "");
          } else {
            // Explicit queue of track URLs.
            usingListRef.current = false;
            listIdRef.current = null;
            queueRef.current = ids;
            indexRef.current = 0;
            startSession(ids[0]!);
          }
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
          usingListRef.current = false;
          listIdRef.current = null;
          setActive(false);
          reportState("stopped");
          break;
        case "next":
          if (usingListRef.current) safeNextVideo(playerRef.current);
          else if (indexRef.current < queueRef.current.length - 1) playIndex(indexRef.current + 1);
          break;
        case "prev":
          if (usingListRef.current) safePreviousVideo(playerRef.current);
          else if (indexRef.current > 0) playIndex(indexRef.current - 1);
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

    // LIFECYCLE RULE: announce READY on mount AND whenever the page becomes visible again
    // (resume). The native side clears its reply-proxy on pause/reload/navigate and requires a
    // fresh `ready` before it forwards any YouTube command.
    const announceReady = () => post({ t: "ready" });
    announceReady();
    const onVisible = () => {
      if (document.visibilityState === "visible") announceReady();
    };
    const onPageShow = () => announceReady();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageShow);

    // Position heartbeat (native uses this for STATE_UPDATE position). Carries videoId too so a
    // track change is never missed → native thumbnail/title stay fresh.
    const tick = window.setInterval(() => {
      const p = playerRef.current;
      if (isYtPlayerReady(p) && (queueRef.current.length > 0 || usingListRef.current)) {
        const data = safeGetVideoData(p);
        post({
          t: "yt_pos",
          position: safeGetCurrentTime(p),
          duration: safeGetDuration(p),
          videoId: data?.video_id || "",
          title: data?.title || titleRef.current || "YouTube",
        });
      }
    }, 1000);

    return () => {
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
      if (bridge.removeEventListener) bridge.removeEventListener("message", listener);
      else if (bridge.onmessage === listener) bridge.onmessage = null;
      safeDestroyYtPlayer(playerRef.current);
      playerRef.current = null;
    };
  }, []);

  // Inert in a normal browser (no native bridge) → render nothing at all.
  if (!getBridge()) return null;

  // Visible + compliant (YouTube requires the player visible and ≥200×200). Presented as an
  // intentional "video" card, shown only while a YouTube session is active.
  return (
    <div hidden={!active} className="mt-4">
      <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-slate-500">YouTube</p>
      <div className="mx-auto aspect-video w-full max-w-md overflow-hidden rounded-xl border border-slate-800/80 bg-black shadow-lg">
        <div ref={containerRef} className="h-full w-full" />
      </div>
    </div>
  );
}
