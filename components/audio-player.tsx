"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { usePlayback, type PlaybackTrack, type TrackSource } from "@/lib/playback-provider";
import { getPlaylistTracks } from "@/lib/playlist-types";
import { useTranslations } from "@/lib/locale-context";
import { ShareModal } from "@/components/share-modal";
import { unifiedSourceToShareable } from "@/lib/share-utils";
import { getYouTubeVideoId, getYouTubePlaylistId, getYouTubeThumbnail, isYouTubeMixUrl, isYouTubeMultiTrackUrl } from "@/lib/playlist-utils";
import { getSoundCloudEmbedUrl, isSoundCloudUrl } from "@/lib/player-utils";
import {
  isYtPlayerReady,
  safeGetPlayerState,
  safeGetCurrentTime,
  safeGetDuration,
  safeGetVideoLoadedFraction,
  safeGetPlaylist,
  safeGetPlaylistIndex,
  safeGetVideoData,
  safeSetVolume,
  safeMute,
  safeUnMute,
  safePlayVideo,
  safePauseVideo,
  safeStopVideo,
  safeDestroyYtPlayer,
  safeSeekTo,
  type YTPlayerAPI,
} from "@/lib/yt-player-utils";
import { NeonControlButton } from "@/components/ui/neon-control-button";
import { HydrationSafeImage } from "@/components/ui/hydration-safe-image";
import { log as mvpLog } from "@/lib/mvp-logger";

/** Crossfade runtime diagnostics – key transitions only, no 500ms spam */
function xfadeLog(phase: string, data?: Record<string, unknown>) {
  console.log("[SyncBiz Xfade]", phase, data ?? "");
}

/** YouTube AutoMix diagnostics – key transitions only. States: -1=unstarted 0=ended 1=playing 2=paused 3=buffering 5=cued */
function ytXfadeLog(phase: string, data?: Record<string, unknown>) {
  console.log("[SyncBiz YT-Xfade]", phase, data ?? "");
}

/** Seconds before mix window to start preloading next YT player. YT iframe load typically takes 3–10s. */
const YT_PRELOAD_BUFFER_SEC = 12;
import { useDevicePlayer } from "@/lib/device-player-context";
import { getMixDuration, getAutoMix, setAutoMix as persistAutoMix, onMixDurationChanged, onAutoMixChanged } from "@/lib/mix-preferences";
import type { SCWidget } from "@/types/yt-sc";

function isHlsUrl(url: string | null): boolean {
  return !!url && (url.includes(".m3u8") || url.includes("m3u8?"));
}

/** Format seconds as M:SS or H:MM:SS */
function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const mm = h > 0 ? m % 60 : m;
  const ss = s % 60;
  if (h > 0) return `${h}:${mm.toString().padStart(2, "0")}:${ss.toString().padStart(2, "0")}`;
  return `${mm}:${ss.toString().padStart(2, "0")}`;
}

function getEmbedType(url: string): "youtube" | "soundcloud" | null {
  const u = url.toLowerCase();
  if (u.includes("youtube") || u.includes("youtu.be")) return "youtube";
  if (u.includes("soundcloud")) return "soundcloud";
  return null;
}

type CrossfadeCallbacks = {
  onComplete: () => void;
  onError: () => void;
  isAborted: () => boolean;
  getStatus: () => string;
};

/** Crossfade for direct audio: fade out current, fade in next, then advance state.
 * Returns abort function. On error/abort: cleanup only, call onError (do NOT advance). */
function runCrossfade(
  currentAudio: HTMLAudioElement,
  nextUrl: string,
  targetVolume: number,
  mixDurationSec: number,
  callbacks: CrossfadeCallbacks
): () => void {
  const { onComplete, onError, isAborted, getStatus } = callbacks;
  xfadeLog("run_start", { nextUrl: nextUrl.slice(0, 60), mixSec: mixDurationSec });
  const temp = document.createElement("audio");
  temp.volume = 0;
  temp.preload = "auto";
  temp.src = nextUrl;

  const startMs = Date.now();
  const durationMs = mixDurationSec * 1000;
  let completed = false;
  let rafId: number | null = null;
  let loadTimeoutId: ReturnType<typeof setTimeout> | null = null;

  const cleanup = () => {
    if (loadTimeoutId != null) {
      clearTimeout(loadTimeoutId);
      loadTimeoutId = null;
    }
    if (rafId != null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    temp.removeEventListener("canplay", onTempCanPlay);
    temp.removeEventListener("error", onTempError);
    temp.pause();
    temp.removeAttribute("src");
    temp.load();
  };

  const finish = (success: boolean) => {
    if (completed) return;
    completed = true;
    xfadeLog("finish", { success });
    if (!success) {
      currentAudio.volume = targetVolume;
    }
    cleanup();
    if (success) onComplete();
    else onError();
  };

  const onTempError = () => {
    xfadeLog("temp_error", { nextUrl: nextUrl.slice(0, 50) });
    finish(false);
  };

  const onTempCanPlay = () => {
    temp.removeEventListener("canplay", onTempCanPlay);
    xfadeLog("temp_canplay");
    temp.play().then(
      () => xfadeLog("temp_play_ok"),
      () => {
        xfadeLog("temp_play_fail");
        finish(false);
      }
    );

    let tickCount = 0;
    const tick = () => {
      if (isAborted()) {
        xfadeLog("abort", { tickCount });
        finish(false);
        return;
      }
      const elapsed = Date.now() - startMs;
      const frac = Math.min(1, elapsed / durationMs);

      currentAudio.volume = Math.max(0, targetVolume * (1 - frac));
      temp.volume = targetVolume * frac;

      if (tickCount === 0) xfadeLog("tick_first", { currentVol: currentAudio.volume, tempVol: temp.volume });
      tickCount++;

      if (frac >= 1) {
        xfadeLog("handoff_start", { tickCount, tempTime: temp.currentTime });
        currentAudio.pause();
        currentAudio.currentTime = 0;
        currentAudio.volume = targetVolume;
        const main = currentAudio;
        main.src = nextUrl;
        main.load();
        main.volume = 0;
        const onMainCanPlay = () => {
          main.removeEventListener("canplay", onMainCanPlay);
          if (completed) return;
          main.currentTime = temp.currentTime;
          main.volume = targetVolume;
          const st = getStatus();
          xfadeLog("main_canplay", { status: st, willPlay: st === "playing" });
          if (st === "playing") main.play().catch(() => {});
          finish(true);
        };
        main.addEventListener("canplay", onMainCanPlay);
        return;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  };

  temp.addEventListener("canplay", onTempCanPlay);
  temp.addEventListener("error", onTempError);

  loadTimeoutId = setTimeout(() => {
    if (!completed) {
      xfadeLog("load_timeout");
      finish(false);
    }
  }, 10000);

  return () => finish(false);
}

function SourceIcon({ type, origin, size = "md" }: { type: TrackSource; origin?: "playlist" | "source" | "radio"; size?: "sm" | "md" | "lg" }) {
  const cls = size === "lg" ? "h-7 w-7 shrink-0" : size === "sm" ? "h-4 w-4 shrink-0" : "h-5 w-5 shrink-0";
  const color =
    type === "youtube" ? "text-[#ff0000]" : type === "soundcloud" ? "text-[#ff5500]" : type === "spotify" ? "text-[#1db954]" : "text-slate-400";
  if (type === "youtube") {
    return (
      <svg className={`${cls} ${color}`} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
      </svg>
    );
  }
  if (type === "soundcloud") {
    return (
      <svg className={`${cls} ${color}`} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M1.175 12.225c-.051 0-.094.046-.101.1l-.233 2.154.233 2.105c.007.058.05.098.101.098.05 0 .09-.04.099-.098l.255-2.105-.255-2.154c-.009-.058-.049-.1-.099-.1zm-.899 1.105c-.06 0-.107.049-.107.11l-.161 1.479.161 1.417c0 .061.047.11.107.11.059 0 .107-.049.107-.11l.177-1.417-.177-1.479c0-.061-.048-.11-.107-.11zm1.899-2.21c-.06 0-.107.048-.107.107l-.161 1.479.161 1.417c0 .059.048.107.107.107.06 0 .107-.048.107-.107l.177-1.417-.177-1.479c0-.059-.047-.107-.107-.107zm.899-1.058c-.06 0-.107.049-.107.11l-.161 1.479.161 1.417c0 .061.047.11.107.11.059 0 .107-.049.107-.11l.177-1.417-.177-1.479c0-.061-.048-.11-.107-.11zm.899-1.058c-.06 0-.107.049-.107.11l-.161 1.479.161 1.417c0 .061.047.11.107.11.059 0 .107-.049.107-.11l.177-1.417-.177-1.479c0-.061-.048-.11-.107-.11zm.899-1.058c-.06 0-.107.049-.107.11l-.161 1.479.161 1.417c0 .061.047.11.107.11.059 0 .107-.049.107-.11l.177-1.417-.177-1.479c0-.061-.048-.11-.107-.11zm.899-1.058c-.06 0-.107.049-.107.11l-.161 1.479.161 1.417c0 .061.047.11.107.11.059 0 .107-.049.107-.11l.177-1.417-.177-1.479c0-.061-.048-.11-.107-.11zm.899-1.058c-.06 0-.107.049-.107.11l-.161 1.479.161 1.417c0 .061.047.11.107.11.059 0 .107-.049.107-.11l.177-1.417-.177-1.479c0-.061-.048-.11-.107-.11zm.899-1.058c-.06 0-.107.049-.107.11l-.161 1.479.161 1.417c0 .061.047.11.107.11.059 0 .107-.049.107-.11l.177-1.417-.177-1.479c0-.061-.048-.11-.107-.11zm.899-1.058c-.06 0-.107.049-.107.11l-.161 1.479.161 1.417c0 .061.047.11.107.11.059 0 .107-.049.107-.11l.177-1.417-.177-1.479c0-.061-.048-.11-.107-.11zm.899-1.058c-.06 0-.107.049-.107.11l-.161 1.479.161 1.417c0 .061.047.11.107.11.059 0 .107-.049.107-.11l.177-1.417-.177-1.479c0-.061-.048-.11-.107-.11zm.899-1.058c-.06 0-.107.049-.107.11l-.161 1.479.161 1.417c0 .061.047.11.107.11.059 0 .107-.049.107-.11l.177-1.417-.177-1.479c0-.061-.048-.11-.107-.11zm.899-1.058c-.06 0-.107.049-.107.11l-.161 1.479.161 1.417c0 .061.047.11.107.11.059 0 .107-.049.107-.11l.177-1.417-.177-1.479c0-.061-.048-.11-.107-.11zm.899-1.058c-.06 0-.107.049-.107.11l-.161 1.479.161 1.417c0 .061.047.11.107.11.059 0 .107-.049.107-.11l.177-1.417-.177-1.479c0-.061-.048-.11-.107-.11zm.899-1.058c-.06 0-.107.049-.107.11l-.161 1.479.161 1.417c0 .061.047.11.107.11.059 0 .107-.049.107-.11l.177-1.417-.177-1.479c0-.061-.048-.11-.107-.11zm.899-1.058c-.06 0-.107.049-.107.11l-.161 1.479.161 1.417c0 .061.047.11.107.11.059 0 .107-.049.107-.11l.177-1.417-.177-1.479c0-.061-.048-.11-.107-.11z" />
      </svg>
    );
  }
  if (type === "spotify") {
    return (
      <svg className={`${cls} ${color}`} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
      </svg>
    );
  }
  if (type === "stream-url" || origin === "radio") {
    return (
      <svg className={`${cls} text-rose-400`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M4 9a5 5 0 0 1 5 5v1h6v-1a5 5 0 0 1 5-5" />
        <path d="M4 14h16" />
        <circle cx="12" cy="18" r="2" />
      </svg>
    );
  }
  if (type === "winamp") {
    return (
      <svg className={`${cls} text-amber-400`} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M4 18h2V6H4v12zm4-12v12h2V6H8zm4 12h2V6h-2v12zm4 0h2V6h-2v12z" />
      </svg>
    );
  }
  return (
    <svg className={`${cls} ${color}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}

export function AudioPlayer() {
  const { t } = useTranslations();
  const [shareOpen, setShareOpen] = useState(false);
  const deviceCtx = useDevicePlayer();
  const isControlMirror = deviceCtx?.isBranchConnected && deviceCtx.deviceMode === "CONTROL";
  const {
    currentTrack,
    currentSource,
    currentTrackIndex,
    currentPlaylist,
    queue,
    queueIndex,
    status,
    volume,
    shuffle,
    repeat,
    play,
    pause,
    stop,
    prev,
    next,
    setVolume,
    setShuffle,
    toggleShuffle,
    toggleRepeat,
    playSource,
    setLastMessage,
    registerStopAllPlayers,
    registerSeekCallback,
    currentPlayUrl,
    isEmbedded,
    getNextStreamUrl,
    getNextEmbeddedSource,
  } = usePlayback();

  const ytContainerRef = useRef<HTMLDivElement>(null);
  const ytContainerNextRef = useRef<HTMLDivElement>(null);
  const scIframeRef = useRef<HTMLIFrameElement>(null);
  const ytPlayerRef = useRef<YTPlayerAPI | null>(null);
  const ytPlayerNextRef = useRef<YTPlayerAPI | null>(null);
  const scWidgetRef = useRef<SCWidget | null>(null);
  const currentVidRef = useRef<string | null>(null);
  const lastYtVidRef = useRef<string | null>(null);

  const embedType = currentPlayUrl ? getEmbedType(currentPlayUrl) : null;
  const isYouTube = embedType === "youtube";
  const isSoundCloud = embedType === "soundcloud" && currentPlayUrl && isSoundCloudUrl(currentPlayUrl);
  const isStreamUrl = currentPlayUrl && !isYouTube && !isSoundCloud && (currentTrack?.type === "stream-url" || currentSource?.origin === "radio");
  const vid = isYouTube && currentPlayUrl ? getYouTubeVideoId(currentPlayUrl) : null;
  const ytPlaylistId = isYouTube && currentPlayUrl ? getYouTubePlaylistId(currentPlayUrl) : null;
  const isYouTubeMix = isYouTube && currentPlayUrl ? isYouTubeMixUrl(currentPlayUrl) : false;
  const isYouTubeMultiTrack = isYouTube && currentPlayUrl ? isYouTubeMultiTrackUrl(currentPlayUrl) : false;
  const scEmbedUrl = isSoundCloud && currentPlayUrl ? getSoundCloudEmbedUrl(currentPlayUrl) : null;

  /** Internal state for multi-track YouTube sources (playlist/radio/mix) – synced from YT embed */
  type YtMultiTrackState = {
    currentTitle: string;
    currentThumbnail: string | null;
    currentIndex: number;
    total: number;
    nextTitle: string | null;
    nextThumbnail: string | null;
  };
  const [ytMultiTrackState, setYtMultiTrackState] = useState<YtMultiTrackState | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hlsRef = useRef<import("hls.js").default | null>(null);
  const lastStreamUrlRef = useRef<string | null>(null);
  const lastKnownDurationRef = useRef<number>(0);

  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedPercent, setBufferedPercent] = useState(0);
  const [isHoveringTimeline, setIsHoveringTimeline] = useState(false);
  const [hoverPercent, setHoverPercent] = useState(0);
  const [titleOverflows, setTitleOverflows] = useState(false);
  const [autoMix, setAutoMixState] = useState(false);
  const [mixDurationDisplay, setMixDurationDisplay] = useState(6);
  const [embedReady, setEmbedReady] = useState(false);
  const isSeekingRef = useRef(false);
  const isDraggingRef = useRef(false);
  const timelineRef = useRef<HTMLDivElement>(null);
  const titleMeasureRef = useRef<HTMLSpanElement>(null);
  const titleContainerRef = useRef<HTMLDivElement>(null);
  const volumeRef = useRef(volume);
  const statusRef = useRef(status);
  const volumeBeforeMuteRef = useRef(80);
  const autoMixRef = useRef(autoMix);
  const nextRef = useRef(next);
  autoMixRef.current = autoMix;
  const lastScEmbedUrlRef = useRef<string | null>(null);
  const endedHandledRef = useRef(false);
  const crossfadeStartedRef = useRef(false);
  const crossfadeAbortRef = useRef(false);
  const crossfadeCleanupRef = useRef<(() => void) | null>(null);
  const crossfadeInMixWindowRef = useRef(false);
  const crossfadeDurNonFiniteLoggedRef = useRef(false);
  const ytCrossfadeStartedRef = useRef(false);
  const ytCrossfadeAbortRef = useRef(false);
  const ytCrossfadeCleanupRef = useRef<(() => void) | null>(null);
  const ytOverlapActiveRef = useRef(false);
  const ytNextVideoIdRef = useRef<string | null>(null);
  const ytCurrentInNextSlotRef = useRef(false);
  volumeRef.current = volume;
  statusRef.current = status;
  nextRef.current = next;

  /** Load YouTube player – deps exclude volume/status so volume changes never recreate the player */
  const loadYouTube = useCallback(() => {
    if (!vid || !ytContainerRef.current) return;
    if (lastYtVidRef.current === vid) {
      lastYtVidRef.current = null;
      return;
    }
    ytCurrentInNextSlotRef.current = false;
    const oldPlayer = ytPlayerRef.current;
    if (isYtPlayerReady(oldPlayer)) safeStopVideo(oldPlayer);
    ytPlayerRef.current = null;
    currentVidRef.current = vid;
    const playerVars: Record<string, string | number> = {
      enablejsapi: 1,
      origin: typeof window !== "undefined" ? window.location.origin : "",
    };
    if (ytPlaylistId && (ytPlaylistId.startsWith("RD") || ytPlaylistId.startsWith("PL"))) {
      playerVars.list = ytPlaylistId;
      playerVars.listType = "playlist";
    }
    const loadYT = () => {
      if (!window.YT?.Player || !ytContainerRef.current || currentVidRef.current !== vid) return;
      new window.YT.Player(ytContainerRef.current, {
        videoId: vid,
        width: 320,
        height: 180,
        playerVars,
        events: {
          onReady(evt) {
            if (currentVidRef.current !== vid) return;
            const target = evt.target;
            if (!isYtPlayerReady(target)) return;
            ytPlayerRef.current = target;
            safeSetVolume(target, volumeRef.current);
            setEmbedReady(true);
            if (statusRef.current === "playing") safePlayVideo(target);
          },
        },
      });
    };
    if (window.YT?.Player) {
      loadYT();
      return;
    }
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    const first = document.getElementsByTagName("script")[0];
    first?.parentNode?.insertBefore(tag, first);
    window.onYouTubeIframeAPIReady = () => loadYT();
  }, [vid, ytPlaylistId]);

  /** YouTube AutoMix Phase 1: preload next in hidden player. No volume fade. At mix point, start next; on current ENDED, handoff. */
  const runYtPreload = useCallback(
    (nextVideoId: string, callbacks: { onError: () => void; isAborted: () => boolean }): (() => void) => {
      const currentPlayer = ytPlayerRef.current;
      if (!isYtPlayerReady(currentPlayer)) {
        ytXfadeLog("no_current");
        callbacks.onError();
        return () => {};
      }
      const preloadContainer = ytCurrentInNextSlotRef.current ? ytContainerRef.current : ytContainerNextRef.current;
      if (!preloadContainer || !window.YT?.Player) {
        ytXfadeLog("no_container");
        callbacks.onError();
        return () => {};
      }
      const oldNext = ytPlayerNextRef.current;
      if (isYtPlayerReady(oldNext)) {
        safeStopVideo(oldNext);
        safeDestroyYtPlayer(oldNext);
      }
      ytPlayerNextRef.current = null;
      const triggerTime = Date.now();
      ytXfadeLog("preload_triggered", { nextVideoId, triggerTime });
      let completed = false;
      let loadTimeoutId: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        if (loadTimeoutId != null) {
          clearTimeout(loadTimeoutId);
          loadTimeoutId = null;
        }
      };

      const abort = () => {
        if (completed) return;
        completed = true;
        ytXfadeLog("preload_abort");
        cleanup();
        if (isYtPlayerReady(ytPlayerNextRef.current)) {
          safeStopVideo(ytPlayerNextRef.current);
          safeDestroyYtPlayer(ytPlayerNextRef.current);
          ytPlayerNextRef.current = null;
        }
        callbacks.onError();
      };

      try {
        ytXfadeLog("next_hidden_yt_player_creating", { videoId: nextVideoId });
        new window.YT.Player(preloadContainer, {
          videoId: nextVideoId,
          width: 320,
          height: 180,
          playerVars: { enablejsapi: 1, origin: typeof window !== "undefined" ? window.location.origin : "" },
          events: {
            onReady(evt: { target: YTPlayerAPI }) {
              if (completed || callbacks.isAborted()) return;
              const target = evt.target;
              if (!isYtPlayerReady(target)) {
                ytXfadeLog("next_not_ready");
                abort();
                return;
              }
              const readyLatencyMs = Date.now() - triggerTime;
              ytXfadeLog("next_hidden_yt_player_ready", { readyLatencyMs });
              ytPlayerNextRef.current = target;
              safeSetVolume(target, 0);
              safeMute(target);
            },
          },
        });
      } catch (e) {
        ytXfadeLog("error", { err: String(e) });
        abort();
        return () => {};
      }

      loadTimeoutId = setTimeout(() => {
        if (!completed) {
          ytXfadeLog("preload_timeout");
          abort();
        }
      }, 12000);

      return () => abort();
    },
    []
  );

  /** Handoff: promote next to current when overlap ends (current track ended). */
  const doYtHandoff = useCallback((nextVideoId: string) => {
    const np = ytPlayerNextRef.current;
    if (!isYtPlayerReady(np)) {
      ytXfadeLog("handoff_abort", { reason: "next_not_ready" });
      return;
    }
    const npStateBefore = safeGetPlayerState(np);
    ytXfadeLog("handoff_started", { nextPlayerStateBefore: npStateBefore });
    const oldCurrent = ytPlayerRef.current;
    if (isYtPlayerReady(oldCurrent)) {
      safeStopVideo(oldCurrent);
      safeDestroyYtPlayer(oldCurrent);
    }
    safeUnMute(np);
    ytPlayerRef.current = np;
    ytPlayerNextRef.current = null;
    currentVidRef.current = nextVideoId;
    lastYtVidRef.current = nextVideoId;
    ytCurrentInNextSlotRef.current = !ytCurrentInNextSlotRef.current;
    safeSetVolume(np, volumeRef.current);
    safePlayVideo(np);
    const npStateAfter = safeGetPlayerState(np);
    ytXfadeLog("handoff_promoted", { nextPlayerStateAfter: npStateAfter });
    nextRef.current({ skipPlay: true });
    endedHandledRef.current = true;
    ytOverlapActiveRef.current = false;
    ytCrossfadeStartedRef.current = false;
    ytXfadeLog("handoff_completed");
    setTimeout(() => {
      const finalState = safeGetPlayerState(ytPlayerRef.current);
      ytXfadeLog("handoff_500ms_later", { playerState: finalState });
    }, 500);
    setTimeout(() => {
      const finalState = safeGetPlayerState(ytPlayerRef.current);
      ytXfadeLog("handoff_1500ms_later", { playerState: finalState });
    }, 1500);
  }, []);

  /** Load SoundCloud widget – deps exclude next/volume/status to avoid recreation loops and jitter */
  const loadSoundCloud = useCallback(() => {
    if (!scEmbedUrl || !scIframeRef.current) return;
    if (lastScEmbedUrlRef.current === scEmbedUrl) return;
    lastScEmbedUrlRef.current = scEmbedUrl;
    const oldWidget = scWidgetRef.current;
    if (oldWidget) {
      try {
        oldWidget.unbind?.("finish");
        oldWidget.pause();
        oldWidget.seekTo(0);
      } catch {
        /* ignore */
      }
      scWidgetRef.current = null;
    }
    const loadSC = () => {
      if (!scIframeRef.current || !window.SC || lastScEmbedUrlRef.current !== scEmbedUrl) return;
      const widget = window.SC.Widget(scIframeRef.current);
      scWidgetRef.current = widget;
      widget.setVolume(volumeRef.current);
      widget.bind("ready", () => {
        if (lastScEmbedUrlRef.current !== scEmbedUrl) return;
        setEmbedReady(true);
        if (statusRef.current === "playing") widget.play();
      });
      widget.bind("finish", () => {
        if (endedHandledRef.current) return;
        endedHandledRef.current = true;
        nextRef.current();
      });
    };
    if (window.SC) {
      loadSC();
      return;
    }
    const tag = document.createElement("script");
    tag.src = "https://w.soundcloud.com/player/api.js";
    tag.onload = loadSC;
    document.body.appendChild(tag);
  }, [scEmbedUrl]);

  useEffect(() => {
    if (isYouTube) loadYouTube();
    else if (isSoundCloud) loadSoundCloud();
  }, [isYouTube, isSoundCloud, loadYouTube, loadSoundCloud]);

  useEffect(() => {
    const vidFromUrl = isYouTube && currentPlayUrl ? getYouTubeVideoId(currentPlayUrl) : null;
    if (isYouTube && vidFromUrl && lastYtVidRef.current === vidFromUrl) return;
    setEmbedReady(false);
    setPosition(0);
    setDuration(0);
    setBufferedPercent(0);
  }, [currentPlayUrl, isYouTube]);

  const handlePlaybackError = useCallback(
    (err: unknown, context?: string) => {
      mvpLog("playback_error", { error: String(err), context });
      setLastMessage("Playback failed. Please try again.");
    },
    [setLastMessage]
  );

  // HTML5 audio play/pause – only call play() when paused to avoid redundant calls that can cause jumps
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !isStreamUrl) return;
    if (status === "playing") {
      if (audio.paused) audio.play().catch((e) => handlePlaybackError(e, "audio.play"));
    } else {
      audio.pause();
      if (status === "stopped") audio.currentTime = 0;
    }
  }, [status, isStreamUrl, handlePlaybackError]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !isStreamUrl) return;
    audio.volume = volume / 100;
  }, [volume, isStreamUrl]);

  const stopAllEmbedded = useCallback(() => {
    if (ytPlayerRef.current && isYtPlayerReady(ytPlayerRef.current)) {
      safeStopVideo(ytPlayerRef.current);
      safeDestroyYtPlayer(ytPlayerRef.current);
      ytPlayerRef.current = null;
    }
    if (ytPlayerNextRef.current && isYtPlayerReady(ytPlayerNextRef.current)) {
      safeStopVideo(ytPlayerNextRef.current);
      safeDestroyYtPlayer(ytPlayerNextRef.current);
      ytPlayerNextRef.current = null;
    }
    lastYtVidRef.current = null;
    if (scWidgetRef.current) {
      try {
        scWidgetRef.current.pause();
        scWidgetRef.current.seekTo(0);
      } catch {
        /* ignore */
      }
      scWidgetRef.current = null;
    }
    lastScEmbedUrlRef.current = null;
    const audio = audioRef.current;
    if (hlsRef.current) {
      try {
        hlsRef.current.destroy();
      } catch {
        /* ignore */
      }
      hlsRef.current = null;
    }
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      audio.removeAttribute("src");
      audio.load();
    }
  }, []);

  useEffect(() => {
    const unregister = registerStopAllPlayers(stopAllEmbedded);
    return unregister;
  }, [registerStopAllPlayers, stopAllEmbedded]);

  useEffect(() => {
    const seekToLocal = (seconds: number) => {
      const sec = Math.max(0, seconds);
      if (isYouTube) {
        const p = ytPlayerRef.current;
        if (isYtPlayerReady(p)) {
          safeSeekTo(p, sec, true);
          setPosition(sec);
        }
      } else if (isSoundCloud && scWidgetRef.current) {
        scWidgetRef.current.seekTo(sec * 1000);
        setPosition(sec);
      } else if (isStreamUrl && audioRef.current) {
        audioRef.current.currentTime = sec;
        setPosition(sec);
      }
    };
    return registerSeekCallback(seekToLocal);
  }, [registerSeekCallback, isYouTube, isSoundCloud, isStreamUrl]);

  /** Stop/destroy previous embed when switching source or track – ensures clean transition before loading new media.
   * Skip when lastYtVidRef is set (YT crossfade handoff) – promoted player is already in place. */
  useEffect(() => {
    if (!isYouTube && !isSoundCloud) {
      lastScEmbedUrlRef.current = null;
      return;
    }
    return () => {
      if (isYouTube && lastYtVidRef.current) return;
      stopAllEmbedded();
      lastScEmbedUrlRef.current = null;
    };
  }, [isYouTube, isSoundCloud, stopAllEmbedded, currentPlayUrl]);

  useEffect(() => {
    const p = ytPlayerRef.current;
    if (status === "playing") {
      if (isYtPlayerReady(p) && isYouTube) safePlayVideo(p);
      else if (scWidgetRef.current && isSoundCloud) scWidgetRef.current.play();
    } else if (status === "paused" || status === "stopped") {
      if (isYtPlayerReady(p) && isYouTube) {
        if (status === "stopped") safeStopVideo(p);
        else safePauseVideo(p);
      } else if (scWidgetRef.current && isSoundCloud) {
        scWidgetRef.current.pause();
        if (status === "stopped") scWidgetRef.current.seekTo(0);
      }
    }
  }, [status, isYouTube, isSoundCloud, embedReady]);

  // Set audio src when stream URL changes (with HLS.js for .m3u8).
  // IMPORTANT: Do NOT include status in deps – re-running on status change causes src reset and playback jumps.
  // Play/pause is handled by the separate effect below.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!isStreamUrl || !currentPlayUrl) {
      lastStreamUrlRef.current = null;
      if (hlsRef.current) {
        try {
          hlsRef.current.destroy();
        } catch {
          /* ignore */
        }
        hlsRef.current = null;
      }
      audio.removeAttribute("src");
      audio.load();
      return;
    }

    // Skip if URL unchanged – setting src again causes reload and playback restart
    if (lastStreamUrlRef.current === currentPlayUrl) return;
    lastStreamUrlRef.current = currentPlayUrl;

    const useHls = isHlsUrl(currentPlayUrl);

    if (useHls) {
      let cancelled = false;
      import("hls.js").then(({ default: Hls }) => {
        if (cancelled) return;
        if (Hls.isSupported()) {
          if (hlsRef.current) {
            try {
              hlsRef.current.destroy();
            } catch {
              /* ignore */
            }
            hlsRef.current = null;
          }
          const hls = new Hls();
          hlsRef.current = hls;
          hls.on(Hls.Events.ERROR, (_e, data) => {
            if (data.fatal) {
              mvpLog("playback_error", { error: data.type, context: "hls" });
              setLastMessage("Stream failed to load.");
            }
          });
          hls.loadSource(currentPlayUrl);
          hls.attachMedia(audio);
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (cancelled) return;
            if (statusRef.current === "playing") audio.play().catch((e) => handlePlaybackError(e, "audio.play"));
          });
        } else if (audio.canPlayType("application/vnd.apple.mpegurl")) {
          audio.src = currentPlayUrl;
          if (statusRef.current === "playing") audio.play().catch((e) => handlePlaybackError(e, "audio.play"));
        } else {
          audio.src = currentPlayUrl;
          if (statusRef.current === "playing") audio.play().catch((e) => handlePlaybackError(e, "audio.play"));
        }
      });
      return () => {
        cancelled = true;
        if (hlsRef.current) {
          try {
            hlsRef.current.destroy();
          } catch {
            /* ignore */
          }
          hlsRef.current = null;
        };
      };
    }

    // Non-HLS path
    if (hlsRef.current) {
      try {
        hlsRef.current.destroy();
      } catch {
        /* ignore */
      }
      hlsRef.current = null;
    }
    const onError = () => handlePlaybackError("audio load failed", "audio.error");
    audio.addEventListener("error", onError);
    audio.src = currentPlayUrl;
    if (statusRef.current === "playing") audio.play().catch((e) => handlePlaybackError(e, "audio.play"));
    return () => audio.removeEventListener("error", onError);
  }, [isStreamUrl, currentPlayUrl, handlePlaybackError]);

  useEffect(() => {
    const p = ytPlayerRef.current;
    if (isYtPlayerReady(p) && isYouTube) safeSetVolume(p, volume);
    else if (scWidgetRef.current && isSoundCloud) scWidgetRef.current.setVolume(volume);
  }, [volume, isYouTube, isSoundCloud]);

  useEffect(() => {
    endedHandledRef.current = false;
    crossfadeStartedRef.current = false;
    crossfadeAbortRef.current = false;
    crossfadeInMixWindowRef.current = false;
    crossfadeDurNonFiniteLoggedRef.current = false;
    crossfadeCleanupRef.current?.();
    crossfadeCleanupRef.current = null;
    ytCrossfadeStartedRef.current = false;
    ytCrossfadeAbortRef.current = false;
    ytOverlapActiveRef.current = false;
    ytNextVideoIdRef.current = null;
    ytCrossfadeCleanupRef.current?.();
    ytCrossfadeCleanupRef.current = null;
  }, [currentPlayUrl]);

  useEffect(() => {
    return () => {
      crossfadeCleanupRef.current?.();
      crossfadeCleanupRef.current = null;
      ytCrossfadeCleanupRef.current?.();
      ytCrossfadeCleanupRef.current = null;
    };
  }, []);

  useEffect(() => {
    setMixDurationDisplay(getMixDuration());
    return onMixDurationChanged((s) => setMixDurationDisplay(s));
  }, []);

  useEffect(() => {
    setAutoMixState(getAutoMix());
    return onAutoMixChanged((v) => setAutoMixState(v));
  }, []);

  const setAutoMix = useCallback((value: boolean | ((prev: boolean) => boolean)) => {
    setAutoMixState((prev) => {
      const next = typeof value === "function" ? value(prev) : value;
      persistAutoMix(next);
      return next;
    });
  }, []);

  /** Clear multi-track state when switching away from multi-track YT source */
  useEffect(() => {
    if (!isYouTubeMultiTrack) setYtMultiTrackState(null);
  }, [isYouTubeMultiTrack]);

  /** Poll YT player for multi-track state – current item, next item, index, total */
  useEffect(() => {
    if (!isYouTubeMultiTrack || !isYouTube) return;
    const poll = () => {
      const p = ytPlayerRef.current;
      if (!isYtPlayerReady(p)) return;
      const playlist = safeGetPlaylist(p);
      const idx = safeGetPlaylistIndex(p);
      const data = safeGetVideoData(p);
      if (!data) return;
      const total = playlist.length || 1;
      const nextVid = playlist[idx + 1] ?? null;
      const nextThumb = nextVid ? `https://img.youtube.com/vi/${nextVid}/hqdefault.jpg` : null;
      setYtMultiTrackState((prev) => {
        if (prev && prev.currentIndex === idx && prev.currentTitle === data.title) return prev;
        return {
          currentTitle: data.title || "YouTube",
          currentThumbnail: data.video_id ? `https://img.youtube.com/vi/${data.video_id}/hqdefault.jpg` : null,
          currentIndex: idx,
          total,
          nextTitle: nextVid ? null : null,
          nextThumbnail: nextThumb,
        };
      });
    };
    poll();
    const id = setInterval(poll, 800);
    return () => clearInterval(id);
  }, [isYouTubeMultiTrack, isYouTube]);

  useEffect(() => {
    if (status !== "playing" && status !== "paused") return;
    const tick = () => {
      const p = ytPlayerRef.current;
      if (isYtPlayerReady(p) && isYouTube) {
        const playerState = safeGetPlayerState(p);
        if (playerState === window.YT!.PlayerState.ENDED) {
          if (!isYouTubeMix && !endedHandledRef.current) {
            const overlapActive = !!ytOverlapActiveRef.current;
            const nextVid = ytNextVideoIdRef.current;
            ytXfadeLog("current_ended", { overlapActive, nextVid: nextVid ?? null });
            if (overlapActive && nextVid) {
              ytXfadeLog("handoff_path_taken");
              doYtHandoff(nextVid);
            } else {
              endedHandledRef.current = true;
              if (ytCrossfadeStartedRef.current) {
                ytCrossfadeCleanupRef.current?.();
                ytCrossfadeStartedRef.current = false;
                ytNextVideoIdRef.current = null;
              }
              nextRef.current();
            }
          }
        } else {
          endedHandledRef.current = false;
        }
      }
    };
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [status, isYouTube, isYouTubeMix, doYtHandoff]);

  useEffect(() => {
    if (!currentSource || isSeekingRef.current) return;
    const poll = () => {
      if (isSeekingRef.current) return;
      if (isYouTube) {
        const p = ytPlayerRef.current;
        if (isYtPlayerReady(p)) {
          const pos = safeGetCurrentTime(p);
          const dur = safeGetDuration(p);
          setPosition(pos);
          setDuration(dur);
          const frac = safeGetVideoLoadedFraction(p);
          setBufferedPercent(frac * 100);
          if (deviceCtx?.isBranchConnected && deviceCtx.deviceMode === "MASTER" && Number.isFinite(pos) && Number.isFinite(dur)) {
            deviceCtx.reportPosition(pos, dur);
          }
          if (
            autoMixRef.current &&
            statusRef.current === "playing" &&
            !isYouTubeMix &&
            !isYouTubeMultiTrack &&
            !ytCrossfadeStartedRef.current &&
            Number.isFinite(dur) &&
            dur > 0
          ) {
            const mixSec = getMixDuration();
            const preloadThreshold = Math.max(0, dur - mixSec - YT_PRELOAD_BUFFER_SEC);
            const mixPointThreshold = Math.max(0, dur - mixSec);
            const nextEmbed = getNextEmbeddedSource();
            const nextUrl = nextEmbed?.type === "youtube" ? nextEmbed.url : null;
            const nextIsMix = nextUrl ? isYouTubeMixUrl(nextUrl) : false;
            const nextIsMultiTrack = nextUrl ? isYouTubeMultiTrackUrl(nextUrl) : false;
            const nextIsSingleVideo = nextUrl && !nextIsMix && !nextIsMultiTrack;
            const nextVid = nextEmbed?.type === "youtube" && nextIsSingleVideo ? nextEmbed.videoId : null;
            if (pos >= preloadThreshold && (nextEmbed || nextUrl)) {
              ytXfadeLog("automix_source_check", {
                currentUrl: currentPlayUrl?.slice(0, 60),
                nextUrl: nextUrl?.slice(0, 60),
                currentVid: vid ?? null,
                nextVid: nextEmbed?.type === "youtube" ? nextEmbed.videoId : null,
                isYouTubeMix,
                isYouTubeMultiTrack,
                nextIsMix,
                nextIsMultiTrack,
                nextIsSingleVideo,
                automixAllowed: !!nextVid,
              });
            }
            if (pos >= preloadThreshold && nextVid && !ytCrossfadeStartedRef.current) {
              const currState = safeGetPlayerState(p);
              const secLeft = dur - pos;
              ytXfadeLog("preload_trigger_reached", { pos, dur, mixSec, secLeft, nextVid, currentPlayerState: currState });
              ytCrossfadeStartedRef.current = true;
              ytNextVideoIdRef.current = nextVid;
              ytCrossfadeAbortRef.current = false;
              ytCrossfadeCleanupRef.current?.();
              const abort = runYtPreload(nextVid, {
                onError: () => {
                  ytXfadeLog("preload_error");
                  ytCrossfadeStartedRef.current = false;
                  ytNextVideoIdRef.current = null;
                },
                isAborted: () => ytCrossfadeAbortRef.current || statusRef.current !== "playing",
              });
              ytCrossfadeCleanupRef.current = abort;
            }

            if (pos >= mixPointThreshold && nextVid && !ytOverlapActiveRef.current && isYtPlayerReady(ytPlayerNextRef.current) && ytNextVideoIdRef.current === nextVid) {
              const np = ytPlayerNextRef.current;
              const currState = safeGetPlayerState(p);
              ytXfadeLog("mix_point_reached_starting_next", { pos, dur, mixSec, currentPlayerState: currState });
              safeUnMute(np);
              safeSetVolume(np, volumeRef.current);
              safePlayVideo(np);
              ytOverlapActiveRef.current = true;
            }
          }
        }
      } else if (isSoundCloud && scWidgetRef.current) {
        scWidgetRef.current.getPosition((pos) => {
          const p = pos / 1000;
          setPosition(p);
          scWidgetRef.current?.getDuration((dur) => {
            const d = dur / 1000;
            setDuration(d);
            if (deviceCtx?.isBranchConnected && deviceCtx.deviceMode === "MASTER" && Number.isFinite(p) && Number.isFinite(d)) {
              deviceCtx.reportPosition(p, d);
            }
          });
        });
      } else if (isStreamUrl && audioRef.current) {
        const a = audioRef.current;
        const t = a.currentTime;
        const d = a.duration;
        lastKnownDurationRef.current = d;
        setPosition(t);
        if (!Number.isFinite(d) || d <= 0) {
          if (!crossfadeDurNonFiniteLoggedRef.current) {
            xfadeLog("duration_not_finite", { d, url: currentPlayUrl?.slice(0, 50), type: currentTrack?.type, origin: currentSource?.origin });
            crossfadeDurNonFiniteLoggedRef.current = true;
          }
        }
        if (Number.isFinite(d) && d > 0) {
          setDuration(d);
          if (a.buffered.length > 0) {
            const end = a.buffered.end(a.buffered.length - 1);
            setBufferedPercent((end / d) * 100);
          }
          if (deviceCtx?.isBranchConnected && deviceCtx.deviceMode === "MASTER" && Number.isFinite(t) && Number.isFinite(d)) {
            deviceCtx.reportPosition(t, d);
          }
          // Crossfade for direct audio URL only (no HLS): AutoMix ON + within mix window
          const mixSec = getMixDuration();
          const threshold = Math.max(0, d - mixSec);
          const inMixWindow = t >= threshold;
          if (inMixWindow && !crossfadeInMixWindowRef.current) {
            crossfadeInMixWindowRef.current = true;
            const nextUrl = getNextStreamUrl();
            const ok = !!(autoMixRef.current && statusRef.current === "playing" && currentPlayUrl && !isHlsUrl(currentPlayUrl) && !crossfadeStartedRef.current && nextUrl);
            xfadeLog("mix_window_entered", { t, d, mixSec, threshold, nextUrl: nextUrl ? "yes" : "no", autoMix: autoMixRef.current, status: statusRef.current, hls: isHlsUrl(currentPlayUrl ?? ""), willTrigger: ok });
          }
          if (
            autoMixRef.current &&
            statusRef.current === "playing" &&
            currentPlayUrl &&
            !isHlsUrl(currentPlayUrl) &&
            !crossfadeStartedRef.current
          ) {
            const nextUrl = getNextStreamUrl();
            if (nextUrl && t >= Math.max(0, d - mixSec)) {
              xfadeLog("trigger", { t, d, mixSec, nextUrl: nextUrl.slice(0, 60) });
              crossfadeStartedRef.current = true;
              crossfadeAbortRef.current = false;
              crossfadeCleanupRef.current?.();
              const abort = runCrossfade(a, nextUrl, volumeRef.current / 100, mixSec, {
                onComplete: () => {
                  xfadeLog("onComplete");
                  lastStreamUrlRef.current = nextUrl;
                  (nextRef.current as ((opts?: { skipPlay?: boolean }) => void) | undefined)?.({ skipPlay: true });
                  endedHandledRef.current = true;
                },
                onError: () => {
                  xfadeLog("onError");
                  crossfadeStartedRef.current = false;
                },
                isAborted: () => crossfadeAbortRef.current || statusRef.current !== "playing",
                getStatus: () => statusRef.current,
              });
              crossfadeCleanupRef.current = abort;
            }
          }
        }
      }
    };
    poll();
    const id = setInterval(poll, 500);
    return () => clearInterval(id);
  }, [currentSource, isYouTube, isSoundCloud, isStreamUrl, isYouTubeMix, isYouTubeMultiTrack, getNextEmbeddedSource, runYtPreload, deviceCtx?.isBranchConnected, deviceCtx?.deviceMode]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !isStreamUrl) return;
    const onEnded = () => {
      const d = lastKnownDurationRef.current;
      if (!Number.isFinite(d) || d <= 0) return;
      if (endedHandledRef.current || crossfadeStartedRef.current) {
        xfadeLog("ended_skipped", { endedHandled: endedHandledRef.current, crossfadeStarted: crossfadeStartedRef.current });
        return;
      }
      xfadeLog("ended_advance");
      endedHandledRef.current = true;
      nextRef.current();
    };
    audio.addEventListener("ended", onEnded);
    return () => audio.removeEventListener("ended", onEnded);
  }, [isStreamUrl]);

  const hasPrevNext = (currentSource && queue.length > 1) || (currentSource?.playlist && (currentSource.playlist.tracks?.length ?? 0) > 1);
  const thumbnailCover = ytMultiTrackState?.currentThumbnail ?? currentTrack?.cover ?? currentSource?.cover ?? null;

  /** Unified display values: MASTER uses local state, CONTROL uses masterState – exact parity. */
  const ms = deviceCtx?.masterState;
  const displayStatus = isControlMirror ? (ms?.status ?? "idle") : status;
  const displayTrack = isControlMirror ? ms?.currentTrack : currentTrack;
  const displaySource = isControlMirror ? ms?.currentSource : currentSource;
  const displayPosition = isControlMirror
    ? (typeof ms?.position === "number" && Number.isFinite(ms.position) ? ms.position : 0)
    : position;
  const displayDuration = isControlMirror
    ? (typeof ms?.duration === "number" && Number.isFinite(ms.duration) ? ms.duration : 0)
    : duration;
  const displayVolume = isControlMirror
    ? (typeof ms?.volume === "number" && Number.isFinite(ms.volume) ? ms.volume : 80)
    : volume;
  const displayShuffle =
    isControlMirror ? (typeof ms?.shuffle === "boolean" ? ms?.shuffle : shuffle) : shuffle;
  const displayAutoMix =
    isControlMirror ? (typeof ms?.autoMix === "boolean" ? ms?.autoMix : autoMix) : autoMix;
  const displayThumbnailCover =
    isControlMirror
      ? (ms?.currentTrack?.cover ?? ms?.currentSource?.cover ?? null)
      : (ytMultiTrackState?.currentThumbnail ?? currentTrack?.cover ?? currentSource?.cover ?? null);
  const displayTitle = isControlMirror
    ? (ms?.currentTrack?.title ?? ms?.currentSource?.title ?? "No track selected")
    : (ytMultiTrackState?.currentTitle ?? currentTrack?.title ?? "No track selected");
  const displayNextLabel = isControlMirror
    ? (ms?.queue?.[(ms?.queueIndex ?? 0) + 1]?.title ?? null)
    : (() => {
        const tracks = currentPlaylist ? getPlaylistTracks(currentPlaylist) : [];
        const hasMore = tracks.length > 1 && currentTrackIndex < tracks.length - 1;
        const nextTrack = hasMore ? tracks[currentTrackIndex + 1] : null;
        const safeQueue = Array.isArray(queue) ? queue : [];
        const nextSrc = queueIndex >= 0 && queueIndex < safeQueue.length - 1 ? safeQueue[queueIndex + 1] : null;
        return ytMultiTrackState?.nextTitle ?? nextTrack?.name ?? nextSrc?.title ?? null;
      })();
  const displayHasContent = isControlMirror ? !!(ms?.currentSource || ms?.currentTrack) : !!currentSource;
  const displayHasPrevNext = isControlMirror
    ? ((ms?.queue?.length ?? 0) > 1)
    : (currentSource && queue.length > 1) || (currentSource?.playlist && (currentSource.playlist.tracks?.length ?? 0) > 1);
  const displayCanSeek = isControlMirror
    ? (displayDuration > 0)
    : (!!currentSource &&
        ((isYouTube && isYtPlayerReady(ytPlayerRef.current)) ||
          (!!scWidgetRef.current && isSoundCloud) ||
          (isStreamUrl && Number.isFinite(duration) && duration > 0)));
  const displayBufferedPercent = isControlMirror ? 0 : bufferedPercent;
  const displayProgressPercent = displayDuration > 0 ? Math.min(100, (displayPosition / displayDuration) * 100) : 0;

  const onPrev = isControlMirror ? () => { endedHandledRef.current = true; deviceCtx!.prevOrSend(); } : () => { endedHandledRef.current = true; prev(); };
  const onNext = isControlMirror ? () => { crossfadeAbortRef.current = true; crossfadeCleanupRef.current?.(); ytCrossfadeAbortRef.current = true; ytCrossfadeCleanupRef.current?.(); endedHandledRef.current = true; deviceCtx!.nextOrSend(); } : () => { crossfadeAbortRef.current = true; crossfadeCleanupRef.current?.(); ytCrossfadeAbortRef.current = true; ytCrossfadeCleanupRef.current?.(); endedHandledRef.current = true; next(); };
  const onStop = isControlMirror ? () => { crossfadeAbortRef.current = true; crossfadeCleanupRef.current?.(); ytCrossfadeAbortRef.current = true; ytCrossfadeCleanupRef.current?.(); deviceCtx!.stopOrSend(); } : () => { crossfadeAbortRef.current = true; crossfadeCleanupRef.current?.(); ytCrossfadeAbortRef.current = true; ytCrossfadeCleanupRef.current?.(); stop(); };
  const onPlayPause = isControlMirror
    ? (displayStatus === "playing" ? deviceCtx!.pauseOrSend : deviceCtx!.playOrSend)
    : (status === "playing" ? pause : () => { if (status === "paused" && currentSource) play(); else if (currentSource) playSource(currentSource); });
  const onVolumeChange = isControlMirror ? deviceCtx!.setVolumeOrSend : setVolume;

  const canSeek =
    currentSource &&
    ((isYouTube && isYtPlayerReady(ytPlayerRef.current)) ||
      (isSoundCloud && !!scWidgetRef.current) ||
      (isStreamUrl && Number.isFinite(duration) && duration > 0));

  const seekTo = useCallback(
    (seconds: number) => {
      const sec = Math.max(0, seconds);
      if (isYouTube) {
        const p = ytPlayerRef.current;
        if (isYtPlayerReady(p)) {
          safeSeekTo(p, sec, true);
          setPosition(sec);
        }
      } else if (isSoundCloud && scWidgetRef.current) {
        scWidgetRef.current.seekTo(sec * 1000);
        setPosition(sec);
      } else if (isStreamUrl && audioRef.current) {
        audioRef.current.currentTime = sec;
        setPosition(sec);
      }
    },
    [isYouTube, isSoundCloud, isStreamUrl]
  );

  const onSeekChange = useCallback(
    (pct: number) => {
      if (isControlMirror) {
        if (displayDuration <= 0) return;
        deviceCtx!.seekOrSend((pct / 100) * displayDuration);
      } else {
        if (!canSeek || duration <= 0) return;
        seekTo((pct / 100) * duration);
      }
    },
    [isControlMirror, deviceCtx, displayDuration, canSeek, duration, seekTo]
  );

  const getPercentFromClientX = useCallback((clientX: number): number => {
    const el = timelineRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left;
    return Math.max(0, Math.min(100, (x / rect.width) * 100));
  }, []);

  const handleTimelineMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const percent = getPercentFromClientX(e.clientX);
      setHoverPercent(percent);
      if (isDraggingRef.current && displayCanSeek && displayDuration > 0) {
        onSeekChange(percent);
      }
    },
    [displayCanSeek, displayDuration, onSeekChange, getPercentFromClientX]
  );

  const handleTimelineMouseEnter = useCallback(() => {
    setIsHoveringTimeline(true);
  }, []);

  const handleTimelineMouseLeave = useCallback(() => {
    setIsHoveringTimeline(false);
    setHoverPercent(0);
  }, []);

  const handleSeekStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (!displayCanSeek || displayDuration <= 0) return;
      isDraggingRef.current = true;
      isSeekingRef.current = true;
      const percent = getPercentFromClientX(e.clientX);
      onSeekChange(percent);
    },
    [displayCanSeek, displayDuration, onSeekChange, getPercentFromClientX]
  );

  const handleSeekEnd = useCallback(() => {
    isDraggingRef.current = false;
    isSeekingRef.current = false;
  }, []);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (!displayCanSeek || displayDuration <= 0) return;
      const touch = e.touches[0];
      if (touch) {
        isDraggingRef.current = true;
        isSeekingRef.current = true;
        const percent = getPercentFromClientX(touch.clientX);
        onSeekChange(percent);
      }
    },
    [displayCanSeek, displayDuration, onSeekChange, getPercentFromClientX]
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      if (!displayCanSeek || displayDuration <= 0) return;
      const percent = getPercentFromClientX(e.clientX);
      onSeekChange(percent);
    };
    const onUp = () => handleSeekEnd();
    const onTouchMove = (e: TouchEvent) => {
      if (!isDraggingRef.current) return;
      if (!displayCanSeek || displayDuration <= 0) return;
      const touch = e.touches[0];
      if (touch) {
        const percent = getPercentFromClientX(touch.clientX);
        onSeekChange(percent);
      }
    };
    const onTouchEnd = () => handleSeekEnd();
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [displayCanSeek, displayDuration, onSeekChange, getPercentFromClientX, handleSeekEnd]);

  const progressPercent = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;
  const hoverTime = duration > 0 ? (hoverPercent / 100) * duration : 0;

  useEffect(() => {
    const measure = titleMeasureRef.current;
    const container = titleContainerRef.current;
    if (!measure || !container) return;
    const check = () => setTitleOverflows(measure.scrollWidth > container.clientWidth);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(container);
    return () => ro.disconnect();
  }, [currentTrack?.title, ytMultiTrackState?.currentTitle]);

  return (
    <header
      className="sticky top-0 z-50 border-b border-slate-800/80 bg-slate-950/98 px-3 py-3 shadow-[0_4px_24px_rgba(0,0,0,0.4),0_0_0_1px_rgba(30,215,96,0.08)] backdrop-blur-md overflow-hidden sm:px-4"
      role="region"
      aria-label="Player controller"
    >
      <div className="mx-auto max-w-6xl flex min-w-0 justify-center">
        {/* Player unit: [ Circular artwork ] [ Control + Track panel ] */}
        <div className="flex min-w-0 items-center gap-3 sm:gap-5 sm:gap-6">
          {/* LEFT: Circular artwork – static cover, playback motion on outer ring only */}
          <div className="relative flex shrink-0 items-center justify-center">
            {/* Outer ring – playback-active pulse when playing; ring animates, cover stays static */}
            <div
              className={`relative flex shrink-0 items-center justify-center rounded-full border-2 p-[6px] bg-slate-800/80 ${
                displayStatus === "playing"
                  ? "playing-active-ring"
                  : "border-slate-600/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_0_0_1px_rgba(0,0,0,0.2),0_2px_12px_rgba(0,0,0,0.3)]"
              }`}
            >
              <div className="relative h-28 w-28 sm:h-32 sm:w-32 flex-shrink-0 rounded-full overflow-hidden bg-slate-800/90 shadow-[inset_0_0_8px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.04)]">
                <div className="h-full w-full overflow-hidden rounded-full">
                {displayThumbnailCover ? (
                  <HydrationSafeImage src={displayThumbnailCover} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900" aria-hidden />
                )}
                </div>
              </div>
            </div>
          </div>

          {/* Control row | Track title | Timeline – unified width */}
          <div className="flex min-w-0 flex-1 flex-col gap-2.5 w-full max-w-2xl">
            {/* Control row: full width, Prev at left edge, Volume at right edge; wraps on narrow screens */}
            <div className="flex flex-wrap items-center w-full gap-2 gap-y-2 sm:gap-3">
              <NeonControlButton
                size="md"
                onClick={onPrev}
                disabled={!displayHasPrevNext}
                aria-label="Previous"
                title="Previous"
              >
                <svg className="h-5 w-5 scale-x-[-1] sm:h-6 sm:w-6" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6 18V6h2v12H6zm11-6l-7 6V6l7 6z" />
                </svg>
              </NeonControlButton>
              <NeonControlButton size="md" onClick={onStop} disabled={!displayHasContent} aria-label="Stop" title="Stop">
                <svg className="h-5 w-5 sm:h-6 sm:w-6" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6 6h12v12H6z" />
                </svg>
              </NeonControlButton>
              <NeonControlButton
                size="xl"
                onClick={onPlayPause}
                disabled={!displayHasContent}
                active={displayStatus === "playing"}
                aria-label={displayStatus === "playing" ? "Pause" : "Play"}
                title={displayStatus === "playing" ? "Pause" : "Play"}
                className="!h-11 !min-w-[90px] !w-auto !px-4 !rounded-2xl sm:!h-12 sm:!min-w-[110px] sm:!px-6"
              >
                <span className="relative flex h-8 w-8 items-center justify-center sm:h-9 sm:w-9" aria-hidden>
                  <svg className={`absolute ${displayStatus === "playing" ? "opacity-100" : "pointer-events-none opacity-0"}`} viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                  </svg>
                  <svg className={`absolute ml-0.5 sm:ml-1 ${displayStatus === "playing" ? "pointer-events-none opacity-0" : "opacity-100"}`} viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7L8 5z" />
                  </svg>
                </span>
              </NeonControlButton>
              <NeonControlButton
                size="md"
                onClick={onNext}
                disabled={!displayHasPrevNext}
                aria-label="Next"
                title="Next"
              >
                <svg className="h-5 w-5 sm:h-6 sm:w-6" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6 18V6h2v12H6zm11-6l-7 6V6l7 6z" />
                </svg>
              </NeonControlButton>
              <div className="h-5 w-px shrink-0 bg-slate-700/80" aria-hidden />
              <NeonControlButton
                size="2xs"
                variant="cyan"
                className="!rounded-lg"
                onClick={() => {
                  if (!isControlMirror) setAutoMix((a) => !a);
                  else deviceCtx?.setAutoMixOrSend?.(!displayAutoMix);
                }}
                active={displayAutoMix}
                disabled={!displayHasContent}
                aria-label="AutoMix"
                title="AutoMix"
              >
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
                </svg>
              </NeonControlButton>
              <NeonControlButton
                size="2xs"
                variant="cyan"
                className="!rounded-lg"
                onClick={() => {
                  if (!isControlMirror) toggleShuffle();
                  else deviceCtx?.setShuffleOrSend?.(!displayShuffle);
                }}
                active={displayShuffle}
                disabled={!displayHasContent}
                aria-label="Random"
                title="Random"
              >
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 4l5 5-5 5M20 4l-5 5 5 5M20 20l-5-5 5-5M4 20l5-5-5-5" />
                </svg>
              </NeonControlButton>
              <div className="h-5 w-px shrink-0 bg-slate-700/80" aria-hidden />
              <div className="flex min-w-[52px] shrink items-center gap-1 rounded-lg border border-cyan-500/50 bg-slate-900/80 px-1.5 py-1 sm:min-w-[70px] sm:gap-1.5 sm:px-2 md:min-w-[90px] md:gap-2 md:px-2.5 lg:min-w-[120px]">
                <button
                  type="button"
                  onClick={() => {
                    if (displayVolume > 0) {
                      volumeBeforeMuteRef.current = displayVolume;
                      onVolumeChange(0);
                    } else {
                      onVolumeChange(volumeBeforeMuteRef.current);
                    }
                  }}
                  className="flex shrink-0 items-center justify-center text-cyan-500 hover:text-cyan-400 transition-colors"
                  aria-label={displayVolume === 0 ? "Unmute" : "Mute"}
                  title={displayVolume === 0 ? "Unmute" : "Mute"}
                >
                  {displayVolume === 0 ? (
                    <svg className="h-4 w-4 sm:h-5 sm:w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                      <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
                    </svg>
                  ) : (
                    <svg className="h-4 w-4 sm:h-5 sm:w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
                    </svg>
                  )}
                </button>
                <div className="relative flex flex-1 min-w-0 items-center py-2">
                  {/* Track background – 3px */}
                  <div className="absolute inset-x-0 top-1/2 h-[3px] w-full -translate-y-1/2 rounded-full bg-slate-700/80" aria-hidden />
                  {/* Fill – 3px, solid strong blue */}
                  <div
                    className="absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-cyan-500 transition-all duration-100"
                    style={{ width: `${displayVolume}%` }}
                    aria-hidden
                  />
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={displayVolume}
                    onChange={(e) => onVolumeChange(Number(e.target.value))}
                    className="player-volume-slider relative z-10 h-[3px] w-full cursor-pointer"
                    aria-label="Volume"
                  />
                </div>
                <span className="w-5 shrink-0 text-end text-[10px] font-bold tabular-nums text-cyan-500 sm:w-6 sm:text-xs" style={{ color: "#06b6d4" }}>{displayVolume}</span>
              </div>
              <NeonControlButton size="2xs" variant="white" className="!rounded-lg" onClick={() => setShareOpen(true)} disabled={!displayHasContent || isControlMirror} aria-label={t.share} title={t.share}>
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="18" cy="5" r="3" />
                  <circle cx="6" cy="12" r="3" />
                  <circle cx="18" cy="19" r="3" />
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                  <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                </svg>
              </NeonControlButton>
            </div>

            {/* ROW 2: Track display panel – source icon + status + title + next (unified deck display) */}
            {(() => {
              return (
                <div className="flex w-full">
                  <div className="relative flex min-w-0 w-full flex-col rounded-lg border border-slate-700/60 bg-slate-900/40 py-2.5 pl-4 pr-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_1px_3px_rgba(0,0,0,0.2)] ring-1 ring-slate-700/40">
                    {/* Main row: left = icon + status (original compact structure), center = inner display frame */}
                    <div className="flex min-w-0 flex-1 items-stretch gap-4">
                      <div className="flex w-9 shrink-0 flex-col items-center justify-center gap-[15px] border-r border-slate-700/50 pr-4 sm:w-10">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-800/80 ring-1 ring-slate-700/60 sm:h-10 sm:w-10" title={displaySource?.title ? (isControlMirror ? "Remote" : (currentSource?.origin === "radio" ? "Radio" : currentTrack?.type ?? "Local")) : "Local"}>
                          <SourceIcon type={(isControlMirror ? "local" : currentTrack?.type) ?? "local"} origin={isControlMirror ? undefined : currentSource?.origin} size="lg" />
                        </div>
                        <div className="flex flex-col items-center gap-[15px]">
                          <span
                            className={`inline-flex w-full items-center justify-center gap-0.5 rounded-full px-1 py-px text-[7px] font-semibold uppercase tracking-wider ${
                              displayStatus === "playing"
                                ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/40"
                                : displayStatus === "paused"
                                  ? "bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/40"
                                  : "bg-slate-800/80 text-slate-500 ring-1 ring-slate-600/30"
                            }`}
                          >
                            <span className={`h-1 w-1 shrink-0 rounded-full ${displayStatus === "playing" ? "bg-emerald-400 playing-led-pulse" : displayStatus === "paused" ? "bg-amber-400" : "bg-slate-500"}`} />
                            {displayStatus}
                          </span>
                          <span className="inline-flex w-full items-center justify-center gap-0.5 rounded-full bg-slate-700/50 px-1 py-px text-[7px] font-semibold uppercase tracking-wider text-slate-400 ring-1 ring-slate-600/40">
                            <span className="h-1 w-1 shrink-0 rounded-full bg-slate-400" />
                            Live
                          </span>
                        </div>
                      </div>
                      <div className="relative flex min-w-0 flex-1 flex-col gap-1 rounded border border-slate-700/50 bg-slate-800/30 px-2.5 py-1.5">
                        {/* Row 1: PLAY NOW : current track */}
                        <div ref={titleContainerRef} className="relative flex min-w-0 flex-1 items-center overflow-hidden gap-1.5">
                          <span ref={titleMeasureRef} className="invisible absolute whitespace-nowrap pointer-events-none" aria-hidden>
                            {displayTitle as string}
                          </span>
                          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-slate-500 sm:text-xs">{t?.playNow ?? "Play now"}:</span>
                          {titleOverflows ? (
                            <div className="min-w-0 flex-1 overflow-hidden">
                              <div className="track-title-marquee flex w-max gap-12 whitespace-nowrap">
                                <span className="text-xs font-medium text-slate-100 sm:text-sm">{displayTitle}</span>
                                <span className="text-xs font-medium text-slate-100 sm:text-sm">{displayTitle}</span>
                              </div>
                            </div>
                          ) : (
                            <p className="min-w-0 flex-1 truncate text-xs font-medium text-slate-100 sm:text-sm" title={displayTitle}>
                              {displayTitle}
                            </p>
                          )}
                        </div>
                        {/* Row 2: NEXT TRACK : next track */}
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-slate-500 sm:text-xs">{t?.next ?? "Next"} track:</span>
                          <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-400" title={displayNextLabel ?? undefined}>{displayNextLabel ?? "—"}</span>
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-stretch gap-2 border-l border-slate-700/50 pl-2">
                        {/* AutoMix status: two-part module [ ● AUTOMIX ] [ 9S ] */}
                        <div className="flex items-center gap-1" role="status" aria-label={displayAutoMix ? `AutoMix ${mixDurationDisplay}s` : "AutoMix off"} title={displayAutoMix ? `AutoMix on, ${mixDurationDisplay}s crossfade` : "AutoMix off"}>
                          <div className={`inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 ${
                            displayAutoMix ? "border-cyan-500/30 bg-slate-800/50" : "border-slate-600/30 bg-slate-800/20"
                          }`}>
                            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                              displayAutoMix ? "bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.5)]" : "bg-slate-500/50"
                            }`} aria-hidden />
                            <span className={`text-[9px] font-semibold uppercase tracking-wider ${displayAutoMix ? "text-cyan-400" : "text-slate-500"}`}>
                              {(t?.autoMix ?? "AUTOMIX").toUpperCase()}
                            </span>
                          </div>
                          <div className={`inline-flex min-w-[28px] items-center justify-center rounded border px-1 py-0.5 tabular-nums ${
                            displayAutoMix ? "border-cyan-500/30 bg-slate-800/50 text-cyan-400 text-[10px] font-bold" : "border-slate-600/30 bg-slate-800/20 text-slate-500 text-[10px] font-bold"
                          }`}>
                            {mixDurationDisplay}S
                          </div>
                        </div>
                        {/* Random status: same modular language [ ● RANDOM ] */}
                        <div className={`inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 w-fit ${
                          displayShuffle ? "border-cyan-500/30 bg-slate-800/50" : "border-slate-600/30 bg-slate-800/20"
                        }`} role="status" aria-label={displayShuffle ? "Random on" : "Random off"} title="Random">
                          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                            displayShuffle ? "bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.5)]" : "bg-slate-500/50"
                          }`} aria-hidden />
                          <span className={`text-[9px] font-semibold uppercase tracking-wider ${displayShuffle ? "text-cyan-400" : "text-slate-500"}`}>
                            {(t?.random ?? "RANDOM").toUpperCase()}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* ROW 3: Timeline – [current time] [progress bar] [total duration] */}
            <div className="flex w-full items-center gap-3">
              <span className="w-10 shrink-0 text-right text-xs font-semibold tabular-nums text-slate-400 sm:w-12" aria-live="polite">
                {formatTime(displayPosition)}
              </span>
            <div
              ref={timelineRef}
              role="slider"
              aria-label="Track progress"
              aria-valuemin={0}
              aria-valuemax={displayDuration}
              aria-valuenow={displayPosition}
              aria-disabled={!displayCanSeek}
              tabIndex={displayCanSeek ? 0 : undefined}
              className={`relative flex flex-1 min-w-0 select-none py-1.5 ${displayCanSeek ? "cursor-pointer" : "cursor-default opacity-80"}`}
            onMouseMove={handleTimelineMouseMove}
            onMouseEnter={handleTimelineMouseEnter}
            onMouseLeave={handleTimelineMouseLeave}
            onMouseDown={handleSeekStart}
            onTouchStart={handleTouchStart}
          >
            {/* Track background */}
            <div className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-slate-700/80" />
            {/* Buffered layer */}
            {displayBufferedPercent > 0 && (
              <div
                className="absolute left-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-slate-500/60 transition-all duration-150"
                style={{ width: `${Math.min(displayBufferedPercent, 100)}%` }}
              />
            )}
            {/* Played layer */}
            <div
              className="absolute left-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-[#1ed760] shadow-[0_0_6px_rgba(30,215,96,0.4)] transition-all duration-100"
              style={{ width: `${displayProgressPercent}%` }}
            />
            {/* Draggable thumb – clamped so it stays visible */}
            <div
              className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#1ed760] shadow-[0_0_0_2px_rgba(30,215,96,0.3),0_0_8px_var(--neon-green-glow)] transition-all duration-100 hover:scale-110"
              style={{ left: `${Math.max(0, Math.min(100, displayProgressPercent))}%` }}
            />
            {/* Hover time preview tooltip – centered above hover position */}
            {isHoveringTimeline && displayDuration > 0 && (
              <div
                className="pointer-events-none absolute bottom-full z-10 mb-1 rounded-full bg-slate-800 px-2 py-1 text-xs font-semibold tabular-nums text-slate-200 shadow-lg ring-1 ring-slate-600/80"
                style={{ left: `${hoverPercent}%`, transform: "translate(-50%, -100%)" }}
              >
                {formatTime(hoverTime)}
              </div>
            )}
          </div>
              <span className="w-10 shrink-0 text-left text-xs font-semibold tabular-nums text-slate-400 sm:w-12" aria-live="polite">
                {formatTime(displayDuration)}
              </span>
            </div>
          </div>

        </div>
      </div>

      {/* Off-screen embeds for YouTube/SoundCloud – always mount both to avoid React removeChild conflict */}
      {/* key by embedType so YT→YT switches don't remount (needed for crossfade handoff) */}
      {isEmbedded && (
        <div key={embedType ?? "none"} className="pointer-events-none absolute -left-[9999px] h-[180px] w-[320px] overflow-hidden opacity-0" aria-hidden>
          {/* Wrapper div prevents YT API DOM manipulation from conflicting with React unmount */}
          <div style={{ display: isYouTube ? "block" : "none" }} className="h-full w-full">
            <div ref={ytContainerRef} className="h-full w-full" />
            <div ref={ytContainerNextRef} className="absolute left-0 top-0 h-full w-full" aria-hidden />
          </div>
          <div style={{ display: isSoundCloud ? "block" : "none" }} className="h-full w-full">
            <iframe
              ref={scIframeRef}
              src={isSoundCloud && scEmbedUrl ? scEmbedUrl : "about:blank"}
              title="SoundCloud"
              className="h-[166px] w-full border-0"
              allow="autoplay"
            />
          </div>
        </div>
      )}
      {/* HTML5 audio for stream URLs (radio, m3u, etc.) – always mounted so ref stays valid */}
      <audio ref={audioRef} className="hidden" playsInline />

      {shareOpen && currentSource && (
        <ShareModal
          item={unifiedSourceToShareable(currentSource)}
          fallbackPlaylistId={currentSource.origin === "playlist" ? currentSource.id : undefined}
          fallbackRadioId={currentSource.origin === "radio" && currentSource.radio ? currentSource.radio.id : undefined}
          onClose={() => setShareOpen(false)}
        />
      )}
    </header>
  );
}
