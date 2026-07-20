"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { usePlayback, type PlaybackTrack, type TrackSource } from "@/lib/playback-provider";
import { getPlaylistTracks } from "@/lib/playlist-types";
import { isPlayNextSourceId } from "@/lib/play-next";
import { useLocale, useTranslations, labels } from "@/lib/locale-context";
import { TrackMetaChips } from "@/components/track-meta-chips";
import { getCachedAiPlaylistTracksMeta } from "@/lib/ai-playlist-track-meta-cache";
import { getTranslations } from "@/lib/translations";
import { ShareModal } from "@/components/share-modal";
import { unifiedSourceToShareable } from "@/lib/share-utils";
import { editHrefForLibrarySource } from "@/components/library-source-item-actions";
import { useCenterModule } from "@/lib/center-module-context";
import {
  effectivePlaybackPlaylistAttachment,
  getYouTubeVideoId,
  getYouTubePlaylistId,
  isYouTubeMixUrl,
  isYouTubeMultiTrackUrl,
  resolvePlaybackHeroCoverArt,
} from "@/lib/playlist-utils";
import { getSoundCloudEmbedUrl, isSoundCloudUrl } from "@/lib/player-utils";
import { urlTimingActive, urlTimingMark, urlTimingSummary } from "@/lib/url-startup-timing";
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
  safeLoadVideoById,
  waitForYtVideoLoaded,
  waitForYtStandbyStable,
  type YTPlayerAPI,
} from "@/lib/yt-player-utils";
import { PlayerDeckTransportSurface } from "@/components/player-surface/player-deck-transport-surface";
import { PlayerVerticalVolume } from "@/components/player-surface/player-vertical-volume";
import { DesktopVideoDock } from "@/components/player-surface/desktop-video-dock";
import { DesktopPlayerBackground } from "@/components/player-surface/desktop-player-background";
import { DesktopBackgroundModeToggle } from "@/components/player-surface/desktop-background-mode-toggle";
import { useDesktopBackgroundMode } from "@/lib/desktop-background-mode";
import { DesktopPlaybackDiagnostic } from "@/components/desktop-playback-diagnostic";
import { reportPlaybackIncident, hostOnly, classifySource } from "@/lib/playback-telemetry-client";
import { HydrationSafeImage } from "@/components/ui/hydration-safe-image";
import { log as mvpLog } from "@/lib/mvp-logger";
import { masterPlaybackDiag } from "@/lib/master-playback-diag";
import {
  acquirePlaybackWakeLock,
  playbackLifecycleLog,
  releasePlaybackWakeLock,
} from "@/lib/playback-resilience";
import { resolveDeckSourceBadge, labelForPlaylistOriginBadge } from "@/lib/deck-source-badge";
import { syncbizAuditPlayerCreationTarget, syncbizAuditTransportTransitionStart } from "@/lib/syncbiz-transport-audit";
import {
  isIOSAutoplayBlock,
  registerIOSAudioElement,
  setIOSNeedsTapToResume,
} from "@/lib/ios-audio-unlock";
import { isValidLocalFilePlaybackPath } from "@/lib/url-validation";

/** Crossfade runtime diagnostics – key transitions only, no 500ms spam */
function xfadeLog(phase: string, data?: Record<string, unknown>) {
  console.log("[SyncBiz Xfade]", phase, data ?? "");
}

/** Temporary P0 QA instrumentation — remove after manual crossfade QA passes. */
function p0XfadeDebug(phase: string, data?: Record<string, unknown>) {
  console.log("[P0_XFADE_DEBUG]", phase, data ?? "");
}

/** YouTube AutoMix diagnostics – key transitions only. States: -1=unstarted 0=ended 1=playing 2=paused 3=buffering 5=cued */
function ytXfadeLog(phase: string, data?: Record<string, unknown>) {
  console.log("[SyncBiz YT-Xfade]", phase, data ?? "");
}

/** YT preload uses the same lead window as direct audio (Settings mix duration defines crossfade length). */
const YT_PRELOAD_BUFFER_SEC = PRELOAD_LEAD_SEC;
/** Hidden YT iframe preload may take longer than HTML audio standby — 20s before fallback. */
const YT_PRELOAD_READY_TIMEOUT_MS = 20_000;
/**
 * Manual track switches crossfade between the A/B YouTube decks (DJ mix on
 * every switch). Keep ENABLED — this is core product behavior.
 * NOTE: a headless-browser test once flagged the handoff as "frozen deck";
 * that was a false positive caused by autoplay policy blocking the standby
 * deck's programmatic play. Verify crossfade issues in a real browser (or
 * headless with --autoplay-policy=no-user-gesture-required) before touching this.
 */
const YT_MANUAL_DECK_CROSSFADE_ENABLED = true;
import { useDevicePlayer } from "@/lib/device-player-context";
import {
  setLocalPlaybackPosition,
  setLocalPlaybackDuration,
  resetLocalPlaybackTime,
} from "@/lib/playback-time-store";
import { getMixDuration, getAutoMix, setAutoMix as persistAutoMix, onMixDurationChanged, onAutoMixChanged } from "@/lib/mix-preferences";
import {
  PRELOAD_LEAD_SEC,
  STANDBY_READY_TIMEOUT_MS,
  createDeckTransitionLock,
  runDeckVolumeCrossfade,
  preloadThresholdSec,
  mixPointThresholdSec,
  runDualVolumeCrossfade,
  runVolumeFade,
  type DeckId,
} from "@/lib/playback-transition";
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

/** Human-readable YouTube IFrame API player state for audit logs. */
function ytStateLabel(state: number): string {
  if (state === -1) return "unstarted";
  if (state === 0) return "ended";
  if (state === 1) return "playing";
  if (state === 2) return "paused";
  if (state === 3) return "buffering";
  if (state === 5) return "cued";
  return `unknown_${state}`;
}

type CrossfadeCallbacks = {
  onComplete: () => void;
  onError: () => void;
  isAborted: () => boolean;
  getStatus: () => string;
};

/** A/B deck crossfade: fade out active deck, fade in standby deck, then swap. */
function runAbDeckCrossfade(
  activeAudio: HTMLAudioElement,
  standbyAudio: HTMLAudioElement,
  nextUrl: string,
  targetVolume: number,
  mixDurationSec: number,
  callbacks: CrossfadeCallbacks,
): () => void {
  const { onComplete, onError, isAborted, getStatus } = callbacks;
  xfadeLog("run_start", { nextUrl: nextUrl.slice(0, 60), mixSec: mixDurationSec });

  let completed = false;
  let loadTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let crossfadeAbort: (() => void) | null = null;

  const cleanup = () => {
    if (loadTimeoutId != null) {
      clearTimeout(loadTimeoutId);
      loadTimeoutId = null;
    }
    standbyAudio.removeEventListener("canplay", onStandbyCanPlay);
    standbyAudio.removeEventListener("error", onStandbyError);
  };

  const finish = (success: boolean) => {
    if (completed) return;
    completed = true;
    xfadeLog("finish", { success });
    crossfadeAbort?.();
    crossfadeAbort = null;
    if (!success) {
      activeAudio.volume = targetVolume;
      standbyAudio.pause();
      standbyAudio.removeAttribute("src");
      standbyAudio.load();
    }
    cleanup();
    if (success) onComplete();
    else onError();
  };

  const onStandbyError = () => {
    xfadeLog("standby_error", { nextUrl: nextUrl.slice(0, 50) });
    finish(false);
  };

  const startCrossfade = () => {
    standbyAudio.removeEventListener("canplay", onStandbyCanPlay);
    xfadeLog("standby_canplay");
    standbyAudio.play().then(
      () => xfadeLog("standby_play_ok"),
      () => {
        xfadeLog("standby_play_fail");
        finish(false);
      },
    );
    crossfadeAbort = runDeckVolumeCrossfade(activeAudio, standbyAudio, targetVolume, mixDurationSec, {
      onComplete: () => finish(true),
      onError: () => finish(false),
      isAborted,
      getStatus,
      onFadeTick: (outVol, inVol, frac) => {
        p0XfadeDebug("deck_fade_tick", { outVol, inVol, frac, mixDurationSec });
      },
    });
  };

  let fadeStarted = false;
  const startCrossfadeOnce = () => {
    if (fadeStarted || completed) return;
    fadeStarted = true;
    standbyAudio.removeEventListener("canplay", onStandbyCanPlay);
    startCrossfade();
  };

  const onStandbyCanPlay = () => startCrossfadeOnce();

  standbyAudio.volume = 0;
  standbyAudio.preload = "auto";
  if (standbyAudio.src !== nextUrl) {
    standbyAudio.src = nextUrl;
    standbyAudio.load();
  }
  standbyAudio.addEventListener("canplay", onStandbyCanPlay);
  standbyAudio.addEventListener("error", onStandbyError);
  if (standbyAudio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
    queueMicrotask(() => startCrossfadeOnce());
  }

  loadTimeoutId = setTimeout(() => {
    if (!completed) {
      xfadeLog("load_timeout_start_fade");
      startCrossfadeOnce();
    }
  }, STANDBY_READY_TIMEOUT_MS);

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
  const pathname = usePathname();
  /**
   * Unified visual deck mode: every desktop route gets the library-theme
   * treatment — spinning-record artwork ring + cyan neon transport buttons +
   * library-theme surface tokens — so the player looks identical on
   * /library, /sources, /radio, /favorites, /remote, /owner, /schedules,
   * /logs, etc. `pathname` is still tracked for any future per-route
   * tweaks. No playback behavior changes.
   */
  const isSourcesLibraryDeck = true;
  /**
   * `setActive` is provided by `CenterModuleContext` when the current
   * route mounts a center workspace panel (library / sources). On routes
   * without a panel host, the default no-op is returned and the Edit
   * action gracefully falls back to URL navigation.
   */
  const { setActive: setCenterModule } = useCenterModule();
  const isLibraryRoute = pathname?.startsWith("/sources") ?? false;

  const { locale } = useLocale();
  const { t } = useTranslations();
  const [shareOpen, setShareOpen] = useState(false);
  const deviceCtx = useDevicePlayer();
  const isControlMirror = Boolean(
    deviceCtx?.isBranchConnected &&
      deviceCtx.deviceMode === "CONTROL" &&
      !deviceCtx.isMobileLocalPlayback,
  );

  // ─── Diagnostic: log isControlMirror / isBranchConnected changes ────────
  useEffect(() => {
    console.warn("[SyncBiz DIAG] AudioPlayer isControlMirror →", isControlMirror, {
      isBranchConnected: deviceCtx?.isBranchConnected,
      deviceMode: deviceCtx?.deviceMode,
      wsStatus: deviceCtx?.status,
      ts: new Date().toISOString(),
    });
  }, [isControlMirror]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    console.warn("[SyncBiz DIAG] AudioPlayer isBranchConnected →", deviceCtx?.isBranchConnected, {
      deviceMode: deviceCtx?.deviceMode,
      wsStatus: deviceCtx?.status,
      isActive: deviceCtx?.isActive,
      ts: new Date().toISOString(),
    });
  }, [deviceCtx?.isBranchConnected]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    return () => { console.warn("[SyncBiz DIAG] AudioPlayer UNMOUNTED", { ts: new Date().toISOString() }); };
  }, []);
  // ────────────────────────────────────────────────────────────────────────
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
    reportRecoveryProgress,
    currentPlayUrl,
    isEmbedded,
    getNextStreamUrl,
    getNextEmbeddedSource,
    playNextQueue,
    playNextBaseline,
    lastPlayCommandVia,
    playCommandEpoch,
    urlPrepareActive,
  } = usePlayback();

  // YouTube A/B decks. Both iframes stay mounted and their refs NEVER swap:
  //   deck A → ytContainerRef / ytPlayerRef
  //   deck B → ytContainerNextRef / ytPlayerNextRef
  // ytActiveDeckRef is the only thing that moves — it points at the audible deck.
  const ytContainerRef = useRef<HTMLDivElement>(null);
  const ytContainerNextRef = useRef<HTMLDivElement>(null);
  const scIframeRef = useRef<HTMLIFrameElement>(null);
  const ytPlayerRef = useRef<YTPlayerAPI | null>(null);
  const ytPlayerNextRef = useRef<YTPlayerAPI | null>(null);
  const ytActiveDeckRef = useRef<DeckId>("A");
  const scWidgetRef = useRef<SCWidget | null>(null);
  const currentVidRef = useRef<string | null>(null);
  const lastYtVidRef = useRef<string | null>(null);

  const embedType = currentPlayUrl ? getEmbedType(currentPlayUrl) : null;
  const isYouTube = embedType === "youtube";
  const isSoundCloud = embedType === "soundcloud" && currentPlayUrl && isSoundCloudUrl(currentPlayUrl);
  /** All non-embed browser playback: direct http(s), local paths, HLS, radio, etc. */
  const isHtmlAudio = Boolean(currentPlayUrl && !isYouTube && !isSoundCloud);
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

  const audioDeckARef = useRef<HTMLAudioElement | null>(null);
  const audioDeckBRef = useRef<HTMLAudioElement | null>(null);
  /** Points at the currently audible deck element (A or B). */
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeDeckRef = useRef<DeckId>("A");
  const deckTransitionLock = useRef(createDeckTransitionLock()).current;
  const hlsRef = useRef<import("hls.js").default | null>(null);
  const hlsDeckRef = useRef<DeckId | null>(null);
  const lastStreamUrlRef = useRef<string | null>(null);
  const standbyPreloadedUrlRef = useRef<string | null>(null);
  const streamTransitionAbortRef = useRef<(() => void) | null>(null);
  const lastKnownDurationRef = useRef<number>(0);

  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);

  // ── Desktop mode: MPV Orchestrator is the single source of truth for display ──
  // The React playback state drives commands (intent). MPV state drives what the UI shows (truth).
  type DesktopMpvSnap = { status: "idle" | "playing" | "paused" | "stopped"; volume: number; position: number; duration: number; catalogCount: number; engineReady: boolean; lastError: string | null };
  const [desktopMpvSnap, setDesktopMpvSnap] = useState<DesktopMpvSnap | null>(null);
  // Ref always holds the latest snap so timeout callbacks (stall detection) can read it
  // without stale-closure issues and without being in the effect dependency array.
  const desktopMpvSnapRef = useRef<DesktopMpvSnap | null>(null);
  /** Wall-clock when desktop snap position last changed — for interpolation + stale-playing guard. */
  const desktopSnapPositionAtRef = useRef(0);
  const desktopSnapLastPosRef = useRef<number | null>(null);
  useEffect(() => { desktopMpvSnapRef.current = desktopMpvSnap; }, [desktopMpvSnap]);
  useEffect(() => {
    if (typeof window === "undefined" || !("syncbizDesktop" in window)) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const desktop = (window as any).syncbizDesktop;
    let cancelled = false;
    const applySnap = (s: any) => {
      if (cancelled) return;
      const nextPos = typeof s.mpvPosition === "number" ? s.mpvPosition : 0;
      if (desktopSnapLastPosRef.current === null || nextPos !== desktopSnapLastPosRef.current) {
        desktopSnapLastPosRef.current = nextPos;
        desktopSnapPositionAtRef.current = Date.now();
      }
      const snap: DesktopMpvSnap = {
        status: (s.mockPlaybackStatus as DesktopMpvSnap["status"]) ?? "idle",
        volume: typeof s.mockVolume === "number" ? s.mockVolume : 80,
        position: nextPos,
        duration: typeof s.mpvDuration === "number" ? s.mpvDuration : 0,
        catalogCount: typeof s.branchCatalogCount === "number" ? s.branchCatalogCount : 0,
        engineReady: Boolean(s.mpvEngineReady),
        lastError: typeof s.mpvLastError === "string" ? s.mpvLastError : null,
      };
      desktopMpvSnapRef.current = snap;
      setDesktopMpvSnap(snap);
    };
    const unsub = desktop.onStatus((s: any) => applySnap(s));
    return () => { cancelled = true; if (typeof unsub === "function") unsub(); };
  }, []);
  // ── End desktop source-of-truth sync ─────────────────────────────────────
  // True once the first live MPV status push arrives — do not seed from getStatus()
  // (stale playing+position:0 snapshots caused fake PLAYING with frozen 0:00).
  const isDesktopMode = desktopMpvSnap !== null;
  // Per-device desktop player background preference (artwork default / video / static).
  const desktopBgMode = useDesktopBackgroundMode();
  /** Browser MASTER only — prewarm hidden YT containers + IFrame API; never on desktop MPV or CONTROL mirror. */
  const canPrewarmYoutubeEmbed = !isDesktopMode && !isControlMirror;
  /* ── Video dock (Spotify-style) — DISPLAY-ONLY, always on while YT plays.
     The audio engine IS the YT iframe pair; the dock merely repositions their
     existing hidden wrapper into the deck. Zero playback-logic involvement;
     clicks never reach the iframes (pointer-events-none) so YouTube's own UI
     can't pause the business. */
  const [videoActiveDeck, setVideoActiveDeck] = useState<DeckId>("A");
  useEffect(() => {
    /* Display sync for the video background. The YT IFrame API REPLACES our
       container divs with the iframes, so React classNames never reach them —
       style the iframes directly through the official getIframe() handle:
       cover-crop (120% width, 16:9, centered → no YT chrome) + active-deck
       opacity crossfade. Pure style writes; playback is never touched. */
    const styleDeckIframe = (player: unknown, active: boolean) => {
      /* getIframe is a public YT.Player API not present on our minimal YTPlayerAPI type. */
      const f = (player as { getIframe?: () => HTMLIFrameElement | null } | null)?.getIframe?.();
      if (!f) return;
      const s = f.style;
      s.position = "absolute";
      s.left = "-10%";
      s.top = "50%";
      s.width = "120%";
      s.height = "auto";
      s.aspectRatio = "16 / 9";
      s.transform = "translateY(-50%)";
      s.transition = "opacity 500ms ease";
      s.opacity = active ? "1" : "0";
      s.pointerEvents = "none";
      s.border = "0";
      /* Slight lift — the translucent deck surface dims the video; this keeps
         the right (un-faded) side vivid. Display-only. */
      s.filter = "brightness(1.12)";
    };
    const id = setInterval(() => {
      setVideoActiveDeck((prev) => (prev === ytActiveDeckRef.current ? prev : ytActiveDeckRef.current));
      try {
        const activeIsA = ytActiveDeckRef.current === "A";
        styleDeckIframe(ytPlayerRef.current, activeIsA);
        styleDeckIframe(ytPlayerNextRef.current, !activeIsA);
      } catch {
        /* display-only — never interfere with playback */
      }
    }, 500);
    return () => clearInterval(id);
  }, []);
  const [bufferedPercent, setBufferedPercent] = useState(0);
  const [isHoveringTimeline, setIsHoveringTimeline] = useState(false);
  const [hoverPercent, setHoverPercent] = useState(0);
  const [titleOverflows, setTitleOverflows] = useState(false);
  const [autoMix, setAutoMixState] = useState(false);
  const [mixDurationDisplay, setMixDurationDisplay] = useState(6);
  const [embedReady, setEmbedReady] = useState(false);
  /** Browser YouTube: true only after IFrame API reports PLAYING/BUFFERING or time advances. */
  const [ytEngineConfirmed, setYtEngineConfirmed] = useState(false);
  const ytEngineConfirmedRef = useRef(false);
  const ytStallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSeekingRef = useRef(false);
  const isDraggingRef = useRef(false);
  const timelineRef = useRef<HTMLDivElement>(null);
  const titleMeasureRef = useRef<HTMLSpanElement>(null);
  const titleContainerRef = useRef<HTMLDivElement>(null);
  const volumeRef = useRef(volume);
  const statusRef = useRef(status);
  const currentPlayUrlRef = useRef<string | null>(null);
  const currentSourceIdRef = useRef<string | null>(null);
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
  const ytCrossfadeDismissRef = useRef<(() => void) | null>(null);
  const ytOverlapActiveRef = useRef(false);
  const ytOverlapFadeAbortRef = useRef<(() => void) | null>(null);
  const ytNextVideoIdRef = useRef<string | null>(null);
  const ytCurrentInNextSlotRef = useRef(false);
  const lastUiPositionRef = useRef(0);
  const lastUiDurationRef = useRef(0);
  const lastUiBufferedRef = useRef(0);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  /** AUDIT: provider vs engine truth snapshot (background / silent playback). */
  const truthAuditPollTickRef = useRef(0);
  const truthAuditLastPollWallMsRef = useRef(0);
  const truthAuditLastEngineTimeRef = useRef<number | null>(null);
  const truthAuditSnapshotDedupeMsRef = useRef(0);
  const isYouTubeRef = useRef(false);
  const isSoundCloudRef = useRef(false);
  const isHtmlAudioRef = useRef(false);
  const ytManualTransitionRef = useRef(false);
  const ytManualFadeActiveRef = useRef(false);
  const ytSequentialActiveRef = useRef(false);
  const ytNaturalSequentialStartedRef = useRef(false);
  const scManualTransitionRef = useRef(false);
  const beginYtSequentialTransitionRef = useRef<
    (nextVideoId: string, opts?: { natural?: boolean; onProviderAdvance?: () => void }) => void
  >(() => {});
  const beginYtDeckCrossfadeRef = useRef<
    (nextVideoId: string, opts?: { natural?: boolean; onProviderAdvance?: () => void }) => void
  >(() => {});
  const beginScEmbedTransitionRef = useRef<(nextEmbedUrl: string) => void>(() => {});
  const loadYouTubeRef = useRef<() => void>(() => {});
  const ytForceColdLoadRef = useRef(false);
  /** After handoff/promote, block loadYouTube cold reload of the same video id. */
  const ytSuppressColdLoadVidRef = useRef<string | null>(null);
  /** Canonical audible YT video after promote — cleared only on stop or a new target vid. */
  const ytCanonicalActiveVidRef = useRef<string | null>(null);
  /** Ignore late ENDED / spurious reload until this timestamp (ms). */
  const ytHandoffGraceUntilRef = useRef(0);
  /** Outgoing player destroyed during handoff — ignore its late ENDED. */
  const ytOutgoingPlayerRef = useRef<YTPlayerAPI | null>(null);
  const ytHandoffEpochRef = useRef(0);
  const ytHandoffWatchdogClearRef = useRef<(() => void) | null>(null);
  const playCommandEpochRef = useRef(0);
  const lastPlayCommandViaRef = useRef<import("@/lib/playback-provider").PlayCommandVia>("unknown");
  const isControlMirrorRef = useRef(false);
  const embedReadyRef = useRef(false);
  volumeRef.current = volume;
  statusRef.current = status;
  lastPlayCommandViaRef.current = lastPlayCommandVia;
  playCommandEpochRef.current = playCommandEpoch;
  currentPlayUrlRef.current = currentPlayUrl ?? null;
  currentSourceIdRef.current = currentSource?.id ?? null;
  nextRef.current = next;
  isYouTubeRef.current = isYouTube;
  isSoundCloudRef.current = Boolean(isSoundCloud);
  isHtmlAudioRef.current = isHtmlAudio;
  isControlMirrorRef.current = Boolean(isControlMirror);
  embedReadyRef.current = embedReady;
  ytEngineConfirmedRef.current = ytEngineConfirmed;

  const markYtEngineConfirmed = useCallback((reason: string, player?: unknown) => {
    if (ytEngineConfirmedRef.current) return;
    ytEngineConfirmedRef.current = true;
    setYtEngineConfirmed(true);
    if (ytStallTimerRef.current) {
      clearTimeout(ytStallTimerRef.current);
      ytStallTimerRef.current = null;
    }
    p0XfadeDebug("yt_engine_confirmed", {
      reason,
      state: player != null ? safeGetPlayerState(player) : null,
      currentTime: player != null ? safeGetCurrentTime(player) : null,
    });
    console.log("[SyncBiz Audit] url_prepare yt_engine_confirmed", {
      reason,
      stateLabel:
        player != null ? ytStateLabel(safeGetPlayerState(player) ?? -1) : null,
    });
    urlTimingMark("now_playing_displayed", { reason });
    if (urlTimingActive()) {
      urlTimingSummary({ outcome: "engine_confirmed", reason });
    }
  }, []);

  const clearYtEngineConfirmed = useCallback((reason: string) => {
    ytEngineConfirmedRef.current = false;
    setYtEngineConfirmed(false);
    if (ytStallTimerRef.current) {
      clearTimeout(ytStallTimerRef.current);
      ytStallTimerRef.current = null;
    }
    p0XfadeDebug("yt_engine_confirmed_cleared", { reason });
  }, []);

  const handleYtPlayerStateChange = useCallback(
    (player: unknown, state: number, via: string) => {
      const YT = typeof window !== "undefined" ? window.YT : undefined;
      console.log("[SyncBiz Audit] YT state_change", {
        via,
        state,
        stateLabel: ytStateLabel(state),
        currentUrl: currentPlayUrlRef.current?.slice(0, 120) ?? null,
        videoId: currentVidRef.current,
        playlistId: ytPlaylistId,
        statusRef: statusRef.current,
        currentTime: isYtPlayerReady(player) ? safeGetCurrentTime(player) : null,
        duration: isYtPlayerReady(player) ? safeGetDuration(player) : null,
      });
      if (YT && (state === YT.PlayerState.PLAYING || state === YT.PlayerState.BUFFERING)) {
        urlTimingMark("yt_buffering_or_playing", {
          via,
          stateLabel: ytStateLabel(state),
        });
        markYtEngineConfirmed(`state_${via}`, player);
      }
      if (isYtPlayerReady(player)) {
        const pos = safeGetCurrentTime(player);
        if (Number.isFinite(pos) && pos > 0) {
          urlTimingMark("first_nonzero_current_time", { via, currentTime: pos });
        }
      }
    },
    [markYtEngineConfirmed, ytPlaylistId],
  );

  const handleYtPlayerError = useCallback(
    (code: number, via: string) => {
      console.warn("[SyncBiz Audit] YT onError", {
        via,
        code,
        currentUrl: currentPlayUrlRef.current?.slice(0, 120) ?? null,
        videoId: currentVidRef.current,
        playlistId: ytPlaylistId,
      });
      clearYtEngineConfirmed("player_error");
      setLastMessage(getTranslations(locale).playbackFailed);
      stop();
    },
    [clearYtEngineConfirmed, setLastMessage, stop, locale, ytPlaylistId],
  );

  const markYtCanonicalActive = useCallback((videoId: string, reason: string) => {
    ytCanonicalActiveVidRef.current = videoId;
    ytSuppressColdLoadVidRef.current = videoId;
    lastYtVidRef.current = videoId;
    currentVidRef.current = videoId;
    ytHandoffGraceUntilRef.current = Date.now() + 5000;
    p0XfadeDebug("yt_canonical_active", { videoId, reason, graceMs: 5000, epoch: ytHandoffEpochRef.current });
  }, []);

  const clearYtCanonicalActive = useCallback((reason: string) => {
    if (!ytCanonicalActiveVidRef.current && !ytSuppressColdLoadVidRef.current) return;
    p0XfadeDebug("yt_canonical_cleared", {
      reason,
      was: ytCanonicalActiveVidRef.current,
    });
    ytCanonicalActiveVidRef.current = null;
    ytSuppressColdLoadVidRef.current = null;
    ytHandoffGraceUntilRef.current = 0;
    ytOutgoingPlayerRef.current = null;
    ytHandoffWatchdogClearRef.current?.();
    ytHandoffWatchdogClearRef.current = null;
  }, []);

  const logYtHandoffState = useCallback((phase: string, extra?: Record<string, unknown>) => {
    const activeIsA = ytActiveDeckRef.current === "A";
    const active = activeIsA ? ytPlayerRef.current : ytPlayerNextRef.current;
    const standby = activeIsA ? ytPlayerNextRef.current : ytPlayerRef.current;
    const activeSt = isYtPlayerReady(active) ? safeGetPlayerState(active) : -1;
    const standbySt = isYtPlayerReady(standby) ? safeGetPlayerState(standby) : -1;
    p0XfadeDebug(phase, {
      activeReady: isYtPlayerReady(active),
      standbyReady: isYtPlayerReady(standby),
      activeTime: isYtPlayerReady(active) ? safeGetCurrentTime(active) : null,
      standbyTime: isYtPlayerReady(standby) ? safeGetCurrentTime(standby) : null,
      activeState: activeSt,
      standbyState: standbySt,
      activeInNextSlot: ytCurrentInNextSlotRef.current,
      activeSlot: ytCurrentInNextSlotRef.current ? "next_container" : "main_container",
      canonical: ytCanonicalActiveVidRef.current,
      currentVidRef: currentVidRef.current,
      currentPlayUrl: currentPlayUrlRef.current?.slice(0, 120) ?? null,
      currentSourceId: currentSourceIdRef.current,
      status: statusRef.current,
      embedReady: embedReadyRef.current,
      handoffEpoch: ytHandoffEpochRef.current,
      playCommandEpoch: playCommandEpochRef.current,
      inHandoffGrace: Date.now() < ytHandoffGraceUntilRef.current,
      ...extra,
    });
  }, []);

  const destroyYtStandbyPlayer = useCallback(() => {
    const standbyRef = ytActiveDeckRef.current === "A" ? ytPlayerNextRef : ytPlayerRef;
    const np = standbyRef.current;
    if (isYtPlayerReady(np)) {
      safeDestroyYtPlayer(np);
    }
    standbyRef.current = null;
    ytCurrentInNextSlotRef.current = false;
  }, []);

  const isYtHandoffGuardActive = useCallback(
    (videoId?: string | null) =>
      !!(
        ytCanonicalActiveVidRef.current &&
        Date.now() < ytHandoffGraceUntilRef.current &&
        playCommandEpochRef.current === ytHandoffEpochRef.current &&
        (!videoId || ytCanonicalActiveVidRef.current === videoId)
      ),
    [],
  );

  const guardedYtPlay = useCallback((player: unknown, reason: string) => {
    const YT = typeof window !== "undefined" ? window.YT : undefined;
    const st = safeGetPlayerState(player);
    const canonical = ytCanonicalActiveVidRef.current;
    const inGrace = Date.now() < ytHandoffGraceUntilRef.current;
    if (
      canonical &&
      inGrace &&
      YT != null &&
      (st === YT.PlayerState.PLAYING || st === YT.PlayerState.BUFFERING)
    ) {
      p0XfadeDebug("safePlayVideo_skipped_post_handoff", { reason, canonical, st });
      return;
    }
    p0XfadeDebug("safePlayVideo_called", { reason, canonical, st });
    safePlayVideo(player);
  }, []);

  const getDeckAudio = useCallback((deck: DeckId) => (deck === "A" ? audioDeckARef.current : audioDeckBRef.current), []);
  const getActiveDeck = useCallback((): DeckId => activeDeckRef.current, []);
  const getStandbyDeck = useCallback((): DeckId => (activeDeckRef.current === "A" ? "B" : "A"), []);
  const syncAudioRefToActiveDeck = useCallback(() => {
    audioRef.current = getDeckAudio(activeDeckRef.current);
  }, [getDeckAudio]);
  const swapActiveDeck = useCallback(() => {
    activeDeckRef.current = activeDeckRef.current === "A" ? "B" : "A";
    syncAudioRefToActiveDeck();
    hlsDeckRef.current = activeDeckRef.current;
  }, [syncAudioRefToActiveDeck]);

  // ── YouTube A/B deck accessors — refs are fixed to a deck; only the pointer moves ──
  const getYtActiveDeck = useCallback((): DeckId => ytActiveDeckRef.current, []);
  const getYtStandbyDeck = useCallback(
    (): DeckId => (ytActiveDeckRef.current === "A" ? "B" : "A"),
    [],
  );
  const getYtPlayerRefForDeck = useCallback(
    (deck: DeckId) => (deck === "A" ? ytPlayerRef : ytPlayerNextRef),
    [],
  );
  const getYtContainerRefForDeck = useCallback(
    (deck: DeckId) => (deck === "A" ? ytContainerRef : ytContainerNextRef),
    [],
  );
  /** The currently audible/authoritative YouTube player (active deck). */
  const getYtActivePlayer = useCallback(
    () => getYtPlayerRefForDeck(ytActiveDeckRef.current).current,
    [getYtPlayerRefForDeck],
  );

  const logProviderEngineTruthSnapshot = useCallback((reason: string) => {
    if (typeof document === "undefined") return;
    const now = Date.now();
    if (now - truthAuditSnapshotDedupeMsRef.current < 400) return;
    truthAuditSnapshotDedupeMsRef.current = now;

    const providerSaysPlaying = statusRef.current === "playing";
    const tabHidden = document.hidden;
    const visibilityState = document.visibilityState;
    const msSinceLastPollTick =
      truthAuditLastPollWallMsRef.current > 0 ? now - truthAuditLastPollWallMsRef.current : null;
    const pollTick = truthAuditPollTickRef.current;
    const lastSampledEngineTime = truthAuditLastEngineTimeRef.current;

    let engineSuggestsPlaying: boolean | null = null;
    let ytPlayerState: number | null = null;
    let ytCurrentTime: number | null = null;
    let audioPaused: boolean | null = null;
    let audioCurrentTime: number | null = null;
    let audioReadyState: number | null = null;
    let soundCloudWidgetPresent: boolean | null = null;

    if (isYouTubeRef.current) {
      const p = getYtActivePlayer();
      if (isYtPlayerReady(p)) {
        ytPlayerState = safeGetPlayerState(p);
        ytCurrentTime = safeGetCurrentTime(p);
        const YT = window.YT;
        engineSuggestsPlaying =
          YT != null &&
          (ytPlayerState === YT.PlayerState.PLAYING || ytPlayerState === YT.PlayerState.BUFFERING);
      } else {
        engineSuggestsPlaying = false;
      }
    } else if (isHtmlAudioRef.current) {
      const a = audioRef.current;
      if (a) {
        audioPaused = a.paused;
        audioCurrentTime = a.currentTime;
        audioReadyState = a.readyState;
        engineSuggestsPlaying = !a.paused && !a.ended;
      } else {
        engineSuggestsPlaying = false;
      }
    } else if (isSoundCloudRef.current) {
      soundCloudWidgetPresent = !!scWidgetRef.current;
      engineSuggestsPlaying = null;
    }

    const timeDeltaSinceLastPollSample =
      Number.isFinite(ytCurrentTime as number) && Number.isFinite(lastSampledEngineTime as number)
        ? (ytCurrentTime as number) - (lastSampledEngineTime as number)
        : Number.isFinite(audioCurrentTime as number) && Number.isFinite(lastSampledEngineTime as number)
          ? (audioCurrentTime as number) - (lastSampledEngineTime as number)
          : null;

    const divergent =
      providerSaysPlaying && engineSuggestsPlaying === false;

    console.log("[SyncBiz Audit] provider_engine_truth_snapshot", {
      reason,
      tabHidden,
      visibilityState,
      pollTick,
      msSinceLastPollTick,
      providerSaysPlaying,
      engineSuggestsPlaying,
      divergent,
      isControlMirror: isControlMirrorRef.current,
      deckUiNote: isControlMirrorRef.current
        ? "CONTROL: visible PLAYING badge uses masterState in this component tree"
        : "LOCAL: displayStatus uses PlaybackProvider status",
      sourceYouTube: isYouTubeRef.current,
      sourceSoundCloud: isSoundCloudRef.current,
      sourceStreamUrl: isHtmlAudioRef.current,
      currentSourceId: currentSourceIdRef.current,
      currentPlayUrlPreview: currentPlayUrlRef.current?.slice(0, 120) ?? null,
      embedReady: embedReadyRef.current,
      ytPlayerState,
      ytCurrentTime,
      lastSampledEngineTime,
      timeDeltaSinceLastPollSample,
      audioPaused,
      audioCurrentTime,
      audioReadyState,
      soundCloudWidgetPresent,
    });
  }, []);

  const updatePositionIfChanged = useCallback((next: number) => {
    if (!Number.isFinite(next)) return;
    if (Math.abs(next - lastUiPositionRef.current) < 0.2) return;
    lastUiPositionRef.current = next;
    setPosition(next);
    // Mirror to the local playback time store so mobile mini-player /
    // Now Playing surfaces can subscribe without coupling to AudioPlayer.
    setLocalPlaybackPosition(next);
  }, []);

  const updateDurationIfChanged = useCallback((next: number) => {
    if (!Number.isFinite(next)) return;
    if (Math.abs(next - lastUiDurationRef.current) < 0.2) return;
    lastUiDurationRef.current = next;
    setDuration(next);
    setLocalPlaybackDuration(next);
  }, []);

  const updateBufferedIfChanged = useCallback((next: number) => {
    if (!Number.isFinite(next)) return;
    const clamped = Math.max(0, Math.min(100, next));
    if (Math.abs(clamped - lastUiBufferedRef.current) < 1) return;
    lastUiBufferedRef.current = clamped;
    setBufferedPercent(clamped);
  }, []);

  /** Load YouTube player – deps exclude volume/status so volume changes never recreate the player */
  const loadYouTube = useCallback(() => {
    p0XfadeDebug("loadYouTube_called", {
      vid: vid ?? null,
      playlistId: ytPlaylistId,
      isEmbedded,
      isYouTube,
      canonical: ytCanonicalActiveVidRef.current,
      suppress: ytSuppressColdLoadVidRef.current,
      manual: ytManualTransitionRef.current,
      currentVidRef: currentVidRef.current,
      via: lastPlayCommandViaRef.current,
    });
    if (isYouTube && !isEmbedded) {
      console.warn("[SyncBiz Audit] YT embed mismatch — isYouTube true but isEmbedded false", {
        currentUrl: currentPlayUrl?.slice(0, 120) ?? null,
        videoId: vid,
        playlistId: ytPlaylistId,
      });
    }
    // Cold load always targets the ACTIVE deck — refs never swap, only the pointer.
    const coldDeck = getYtActiveDeck();
    const coldContainerRef = getYtContainerRefForDeck(coldDeck);
    const coldPlayerRef = getYtPlayerRefForDeck(coldDeck);
    // Allow playlist-only URLs (ytPlaylistId set but vid=null) to proceed.
    // The IFrame API initialises from playerVars.list when videoId is absent.
    if ((!vid && !ytPlaylistId) || !coldContainerRef.current) return;
    urlTimingMark("iframe_container_available", {
      hasContainer: !!coldContainerRef.current,
      ytApiReady: !!window.YT?.Player,
    });
    clearYtEngineConfirmed("load_youtube_start");
    if (ytManualTransitionRef.current || ytSequentialActiveRef.current) {
      p0XfadeDebug("loadYouTube_skipped_manual_active", { vid });
      return;
    }
    if (vid && (ytCanonicalActiveVidRef.current === vid || ytSuppressColdLoadVidRef.current === vid)) {
      p0XfadeDebug("suppress_duplicate_reload", {
        vid,
        via: lastPlayCommandViaRef.current,
        canonical: ytCanonicalActiveVidRef.current,
      });
      return;
    }
    if (vid && lastYtVidRef.current === vid && currentVidRef.current === vid) {
      p0XfadeDebug("yt_load_suppressed_promoted", { vid, via: lastPlayCommandViaRef.current });
      return;
    }
    if (vid && ytCanonicalActiveVidRef.current && vid !== ytCanonicalActiveVidRef.current) {
      clearYtCanonicalActive("new_target_vid");
    } else if (vid && ytSuppressColdLoadVidRef.current && vid !== ytSuppressColdLoadVidRef.current) {
      ytSuppressColdLoadVidRef.current = null;
    }
    const oldPlayer = coldPlayerRef.current;
    const oldVid = currentVidRef.current;
    const midPlayback =
      statusRef.current === "playing" || statusRef.current === "paused";
    const canManualHandoff =
      YT_MANUAL_DECK_CROSSFADE_ENABLED &&
      !ytForceColdLoadRef.current &&
      midPlayback &&
      vid &&
      oldVid &&
      oldVid !== vid &&
      !isYouTubeMix &&
      !isYouTubeMultiTrack &&
      !ytManualTransitionRef.current;
    if (canManualHandoff && vid && isYtPlayerReady(oldPlayer)) {
      ytXfadeLog("manual_transition_delegated", { from: oldVid, to: vid });
      p0XfadeDebug("transition_start", {
        via: lastPlayCommandViaRef.current,
        engine: "yt_deck_crossfade",
        fromVid: oldVid,
        toVid: vid,
      });
      beginYtDeckCrossfadeRef.current(vid);
      return;
    }
    if (canManualHandoff && !isYtPlayerReady(oldPlayer)) {
      p0XfadeDebug("yt_manual_deferred_retry", { vid, oldVid, via: lastPlayCommandViaRef.current });
      queueMicrotask(() => {
        if (
          currentVidRef.current === oldVid &&
          vid &&
          currentVidRef.current !== vid &&
          isYtPlayerReady(coldPlayerRef.current) &&
          !ytManualTransitionRef.current &&
          !ytSequentialActiveRef.current
        ) {
          beginYtDeckCrossfadeRef.current(vid);
        }
      });
      return;
    }
    p0XfadeDebug("yt_cold_load", {
      vid,
      oldVid,
      midPlayback,
      ytForceCold: ytForceColdLoadRef.current,
      playerReady: isYtPlayerReady(oldPlayer),
      isMix: isYouTubeMix,
      isMultiTrack: isYouTubeMultiTrack,
      via: lastPlayCommandViaRef.current,
    });
    ytForceColdLoadRef.current = false;
    ytCurrentInNextSlotRef.current = false;
    if (isYtPlayerReady(oldPlayer)) {
      console.log("[SyncBiz Audit] YT destroy/reset", {
        reason: "loadYouTube_old_player",
        currentUrl: currentPlayUrl,
        currentSourceId: currentSource?.id ?? null,
        currentTrackIndex,
      });
      safeStopVideo(oldPlayer);
      safeDestroyYtPlayer(oldPlayer);
    }
    coldPlayerRef.current = null;
    currentVidRef.current = vid;
    const playerVars: Record<string, string | number> = {
      enablejsapi: 1,
      origin: typeof window !== "undefined" ? window.location.origin : "",
      /* Display-only: the deck video is a BACKGROUND — no YT chrome/annotations.
         Zero effect on playback (API control is via enablejsapi). */
      controls: 0,
      disablekb: 1,
      iv_load_policy: 3,
      rel: 0,
    };
    if (ytPlaylistId && (ytPlaylistId.startsWith("RD") || ytPlaylistId.startsWith("PL"))) {
      playerVars.list = ytPlaylistId;
      playerVars.listType = "playlist";
    }
    const loadYT = () => {
      if (vid && ytCanonicalActiveVidRef.current === vid) {
        p0XfadeDebug("cold_loadYT_aborted_canonical", { vid });
        return;
      }
      if (!window.YT?.Player || !coldContainerRef.current || currentVidRef.current !== vid) return;
      const hostEl = coldContainerRef.current;
      let iframeEl: HTMLIFrameElement | null = null;
      if (hostEl instanceof HTMLIFrameElement) {
        iframeEl = hostEl;
      } else if (hostEl) {
        iframeEl = hostEl.querySelector("iframe");
      }
      console.log("[SyncBiz Audit] YT player create_start", {
        currentUrl: currentPlayUrl,
        currentSourceId: currentSource?.id ?? null,
        currentTrackIndex,
        videoId: vid,
        playlistId: ytPlaylistId,
        hasHost: !!hostEl,
        hostTag: hostEl?.tagName,
        hasIframe: !!iframeEl,
        hasContentWindow: !!iframeEl?.contentWindow,
        hasExistingPlayer: isYtPlayerReady(coldPlayerRef.current),
      });
      syncbizAuditPlayerCreationTarget({
        slot: "current",
        videoId: vid,
        playlistId: ytPlaylistId,
        currentSourceId: currentSource?.id ?? null,
      });
      urlTimingMark("yt_player_create_start", {
        videoId: vid,
        destroyingPrior: isYtPlayerReady(oldPlayer),
      });
      new window.YT.Player(coldContainerRef.current, {
        ...(vid != null ? { videoId: vid } : {}),
        width: 320,
        height: 180,
        playerVars,
        events: {
          onReady(evt) {
            if (vid && ytCanonicalActiveVidRef.current === vid) {
              p0XfadeDebug("cold_onReady_aborted_post_handoff", { vid });
              return;
            }
            if (currentVidRef.current !== vid) {
              console.log("[SyncBiz Audit] YT onReady timing", {
                embed: "current",
                aborted: "stale_vid_ref",
                expectedVideoId: vid,
                currentVidRef: currentVidRef.current,
              });
              return;
            }
            const target = evt.target;
            if (!isYtPlayerReady(target)) {
              console.log("[SyncBiz Audit] YT onReady timing", {
                embed: "current",
                aborted: "target_not_ready",
                videoId: vid,
              });
              return;
            }
            // Re-read DOM on ready for live diagnostics
            const hostElLive = coldContainerRef.current;
            let iframeElLive: HTMLIFrameElement | null = null;
            if (hostElLive instanceof HTMLIFrameElement) {
              iframeElLive = hostElLive;
            } else if (hostElLive) {
              iframeElLive = hostElLive.querySelector("iframe");
            }
            console.log("[SyncBiz Audit] YT iframe dom_check", {
              embed: "current",
              hasHost: !!hostElLive,
              hostTag: hostElLive?.tagName,
              hasIframe: !!iframeElLive,
              hasContentWindow: !!iframeElLive?.contentWindow,
              src: iframeElLive?.src,
            });
            console.log("[SyncBiz Audit] YT iframe dom_check_live", {
              hasHost: !!hostElLive,
              hostTag: hostElLive?.tagName,
              hasIframe: !!iframeElLive,
              hasContentWindow: !!iframeElLive?.contentWindow,
              src: iframeElLive?.src,
              currentUrl: currentPlayUrl,
              currentSourceId: currentSource?.id ?? null,
              currentTrackIndex,
            });
            const initialState = safeGetPlayerState(target);
            console.log("[SyncBiz Audit] YT onReady timing", {
              embed: "current",
              videoId: vid,
              playlistId: ytPlaylistId,
              currentUrl: currentPlayUrl,
              currentSourceId: currentSource?.id ?? null,
              currentTrackIndex,
              playerState: initialState,
              statusRef: statusRef.current,
            });
            console.log("[SyncBiz Audit] url_prepare yt_player_ready", {
              videoId: vid,
              playlistId: ytPlaylistId,
            });
            urlTimingMark("yt_on_ready", {
              videoId: vid,
              initialState: initialState,
              initialStateLabel: ytStateLabel(initialState ?? -1),
            });
            coldPlayerRef.current = target;
            safeSetVolume(target, volumeRef.current);
            setEmbedReady(true);
            const willPlay = statusRef.current === "playing";
            if (willPlay) {
              console.log("[SyncBiz Audit] YT command target", {
                reason: "onReady_status_playing",
                hasPlayer: true,
                videoId: vid,
                action: "safePlayVideo",
              });
              guardedYtPlay(target, "cold_onReady_status_playing");
              urlTimingMark("play_video_called", {
                reason: "cold_onReady_status_playing",
                playerStateAfter: safeGetPlayerState(target),
              });
              const stateAfterPlay = safeGetPlayerState(target);
              console.log("[SyncBiz Audit] YT first_state_after_ready", {
                embed: "current",
                videoId: vid,
                playlistId: ytPlaylistId,
                currentUrl: currentPlayUrl,
                currentSourceId: currentSource?.id ?? null,
                currentTrackIndex,
                playerState: stateAfterPlay,
              });
            } else {
              console.log("[SyncBiz Audit] YT command target", {
                reason: "skipped_not_playing",
                hasPlayer: true,
                videoId: vid,
                statusRef: statusRef.current,
                action: "none",
              });
              console.log("[SyncBiz Audit] YT first_state_after_ready", {
                embed: "current",
                videoId: vid,
                note: "play_not_issued",
                playerState: initialState,
                currentUrl: currentPlayUrl,
                currentSourceId: currentSource?.id ?? null,
              });
            }
            queueMicrotask(() => {
              console.log("[SyncBiz Audit] currentPlayUrl final", {
                currentPlayUrl: currentPlayUrlRef.current,
                currentSourceId: currentSourceIdRef.current,
                readyVideoId: vid,
                currentVidRef: currentVidRef.current,
                statusRef: statusRef.current,
              });
            });
            const auditReadyVid = vid;
            window.setTimeout(() => {
              if (currentVidRef.current !== auditReadyVid) {
                console.log("[SyncBiz Audit] YT player state shortly_after_ready", {
                  msAfterReady: 300,
                  aborted: "vid_replaced_before_sample",
                  readyVideoId: auditReadyVid,
                  currentVidRef: currentVidRef.current,
                  currentPlayUrl: currentPlayUrlRef.current,
                  currentSourceId: currentSourceIdRef.current,
                });
                return;
              }
              const p = coldPlayerRef.current;
              if (!isYtPlayerReady(p)) {
                console.log("[SyncBiz Audit] YT player state shortly_after_ready", {
                  msAfterReady: 300,
                  aborted: "no_current_player",
                  readyVideoId: auditReadyVid,
                  currentPlayUrl: currentPlayUrlRef.current,
                });
                return;
              }
              console.log("[SyncBiz Audit] YT player state shortly_after_ready", {
                msAfterReady: 300,
                videoId: auditReadyVid,
                playerState: safeGetPlayerState(p),
                currentPlayUrl: currentPlayUrlRef.current,
                currentSourceId: currentSourceIdRef.current,
                statusRef: statusRef.current,
              });
            }, 300);
            const sampleEngine = (msAfter: number) => {
              if (currentVidRef.current !== auditReadyVid && auditReadyVid != null) return;
              const p = coldPlayerRef.current;
              if (!isYtPlayerReady(p)) return;
              const pos = safeGetCurrentTime(p);
              const dur = safeGetDuration(p);
              const st = safeGetPlayerState(p);
              console.log("[SyncBiz Audit] YT engine_sample", {
                msAfterReady: msAfter,
                videoId: auditReadyVid,
                playlistId: ytPlaylistId,
                playerState: st,
                stateLabel: ytStateLabel(st),
                currentTime: pos,
                duration: dur,
                ytEngineConfirmed: ytEngineConfirmedRef.current,
              });
              const YT = window.YT;
              if (
                YT &&
                (st === YT.PlayerState.PLAYING || st === YT.PlayerState.BUFFERING) &&
                Number.isFinite(pos) &&
                pos > 0
              ) {
                markYtEngineConfirmed(`ready_sample_${msAfter}ms`, p);
              }
            };
            window.setTimeout(() => sampleEngine(1000), 1000);
            window.setTimeout(() => sampleEngine(3000), 3000);
          },
          onStateChange(evt) {
            handleYtPlayerStateChange(evt.target, evt.data, "cold_onStateChange");
          },
          onError(evt) {
            handleYtPlayerError(typeof evt?.data === "number" ? evt.data : -1, "cold_onError");
          },
        },
      });
    };
    if (window.YT?.Player) {
      urlTimingMark("yt_api_ready", { preloaded: true, via: "loadYouTube" });
      loadYT();
      return;
    }
    const chainYtApiReady = (run: () => void) => {
      const priorReady = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        urlTimingMark("yt_api_ready", { preloaded: false, via: "loadYouTube" });
        if (typeof priorReady === "function") priorReady();
        run();
      };
    };
    if (document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      chainYtApiReady(loadYT);
      return;
    }
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    const first = document.getElementsByTagName("script")[0];
    first?.parentNode?.insertBefore(tag, first);
    chainYtApiReady(loadYT);
  }, [vid, ytPlaylistId, isEmbedded, isYouTube, currentPlayUrl, clearYtCanonicalActive, clearYtEngineConfirmed, getActiveDeck, guardedYtPlay, getYtActiveDeck, getYtContainerRefForDeck, getYtPlayerRefForDeck, handleYtPlayerError, handleYtPlayerStateChange, markYtEngineConfirmed]);

  useEffect(() => {
    loadYouTubeRef.current = loadYouTube;
  }, [loadYouTube]);

  /**
   * Sequential fallback — single active-deck iframe: fade out, loadVideoById, fade in.
   * Used ONLY when the real A/B deck crossfade can't bring the standby up
   * (standby failed to load or never reached PLAYING/BUFFERING).
   */
  const beginYtSequentialTransition = useCallback(
    (
      nextVideoId: string,
      opts?: { natural?: boolean; onProviderAdvance?: () => void },
    ) => {
      if (ytSequentialActiveRef.current || ytManualTransitionRef.current) {
        p0XfadeDebug("yt_sequential_skipped", { nextVideoId, reason: "already_active" });
        return;
      }
      const player = getYtActivePlayer();
      if (!isYtPlayerReady(player)) {
        p0XfadeDebug("yt_sequential_skipped", { nextVideoId, reason: "player_not_ready" });
        return;
      }

      destroyYtStandbyPlayer();
      ytCrossfadeCleanupRef.current?.();
      ytCrossfadeCleanupRef.current = null;
      ytCrossfadeDismissRef.current?.();
      ytCrossfadeDismissRef.current = null;
      ytCrossfadeStartedRef.current = false;
      ytOverlapFadeAbortRef.current?.();
      ytOverlapFadeAbortRef.current = null;

      const run = () => {
        if (!deckTransitionLock.tryAcquire()) {
          deckTransitionLock.queueAfter(() => run());
          return;
        }

        ytSequentialActiveRef.current = true;
        ytManualTransitionRef.current = true;
        ytManualFadeActiveRef.current = true;

        const mixSec = Math.min(getMixDuration(), 12);
        const maxUiVol = volumeRef.current;
        let fadeAbort: (() => void) | null = null;

        const finishSequential = (success: boolean) => {
          fadeAbort?.();
          fadeAbort = null;
          ytManualFadeActiveRef.current = false;
          ytManualTransitionRef.current = false;
          ytSequentialActiveRef.current = false;
          if (opts?.natural) {
            ytNaturalSequentialStartedRef.current = false;
            ytOverlapActiveRef.current = false;
          }
          deckTransitionLock.release();
          if (success) {
            markYtCanonicalActive(nextVideoId, opts?.natural ? "sequential_natural" : "sequential_manual");
            setEmbedReady(true);
            p0XfadeDebug("yt_sequential_complete", { nextVideoId, natural: !!opts?.natural });
            return;
          }
          p0XfadeDebug("yt_sequential_failed", { nextVideoId, natural: !!opts?.natural });
          const p = getYtActivePlayer();
          if (isYtPlayerReady(p)) {
            safeUnMute(p);
            safeSetVolume(p, volumeRef.current);
            if (statusRef.current === "playing") safePlayVideo(p);
          }
        };

        const isAborted = () =>
          statusRef.current === "stopped" || !ytSequentialActiveRef.current;

        p0XfadeDebug("yt_sequential_fade_out_start", {
          nextVideoId,
          mixSec,
          natural: !!opts?.natural,
          via: lastPlayCommandViaRef.current,
        });

        fadeAbort = runDualVolumeCrossfade(
          (outV) => safeSetVolume(player, outV),
          () => {},
          maxUiVol,
          mixSec,
          {
            curve: "smoothstep",
            minUpdateIntervalMs: 40,
            isAborted,
            onComplete: () => {
              void (async () => {
                if (isAborted()) {
                  finishSequential(false);
                  return;
                }
                p0XfadeDebug("yt_sequential_load", { nextVideoId });
                currentVidRef.current = nextVideoId;
                safeLoadVideoById(player, nextVideoId);
                if (opts?.onProviderAdvance) opts.onProviderAdvance();

                const loaded = await waitForYtVideoLoaded(player, nextVideoId, {
                  timeoutMs: 15_000,
                  isAborted,
                });
                if (!loaded || isAborted()) {
                  finishSequential(false);
                  return;
                }

                safeUnMute(player);
                safeSetVolume(player, 0);
                if (statusRef.current === "playing") safePlayVideo(player);

                p0XfadeDebug("yt_sequential_fade_in_start", { nextVideoId });
                fadeAbort = runDualVolumeCrossfade(
                  () => {},
                  (inV) => safeSetVolume(player, inV),
                  maxUiVol,
                  mixSec,
                  {
                    curve: "smoothstep",
                    minUpdateIntervalMs: 40,
                    isAborted,
                    onComplete: () => finishSequential(true),
                    onError: () => finishSequential(false),
                  },
                );
              })();
            },
            onError: () => finishSequential(false),
          },
        );
      };

      if (opts?.natural) ytNaturalSequentialStartedRef.current = true;
      ytOverlapActiveRef.current = !!opts?.natural;
      run();
    },
    [deckTransitionLock, destroyYtStandbyPlayer, markYtCanonicalActive, getYtActivePlayer],
  );
  beginYtSequentialTransitionRef.current = beginYtSequentialTransition;

  /**
   * Create the standby-deck YouTube player and cue the next video at volume 0.
   * The standby iframe is never destroyed during a transition; it becomes the
   * active deck after the crossfade and is reused (loadVideoById) thereafter.
   */
  const createYtStandbyPlayer = useCallback(
    (deck: DeckId, videoId: string) => {
      if (!window.YT?.Player) return;
      const containerRef = getYtContainerRefForDeck(deck);
      const playerRef = getYtPlayerRefForDeck(deck);
      const host = containerRef.current;
      if (!host) return;
      const playerVars: Record<string, string | number> = {
        enablejsapi: 1,
        origin: typeof window !== "undefined" ? window.location.origin : "",
        /* Display-only: background video, no YT chrome (see cold-load playerVars). */
        controls: 0,
        disablekb: 1,
        iv_load_policy: 3,
        rel: 0,
      };
      syncbizAuditPlayerCreationTarget({
        slot: "standby",
        deck,
        videoId,
        currentSourceId: currentSourceIdRef.current,
      });
      new window.YT.Player(host, {
        videoId,
        width: 320,
        height: 180,
        playerVars,
        events: {
          onReady(evt) {
            const target = evt.target;
            if (!isYtPlayerReady(target)) return;
            playerRef.current = target;
            safeSetVolume(target, 0);
            p0XfadeDebug("yt_standby_ready", { deck, videoId });
          },
        },
      });
    },
    [getYtContainerRefForDeck, getYtPlayerRefForDeck],
  );

  /**
   * Real A/B deck crossfade (P0). Load the next video on the STANDBY deck at
   * volume 0, wait until it is actually PLAYING/BUFFERING, then overlap-fade the
   * active deck out and the standby deck in. On completion the deck pointer flips
   * (refs never swap) and the old active deck is paused but kept alive.
   *
   * Failure semantics: if the standby never comes up we fall back to the
   * single-iframe sequential fade; any abort restores the active deck and never
   * resets the queue/session.
   */
  const beginYtDeckCrossfade = useCallback(
    (
      nextVideoId: string,
      opts?: { natural?: boolean; onProviderAdvance?: () => void },
    ) => {
      if (ytSequentialActiveRef.current || ytManualTransitionRef.current) {
        p0XfadeDebug("yt_deck_skipped", { nextVideoId, reason: "already_active" });
        return;
      }
      const active = getYtActivePlayer();
      if (!isYtPlayerReady(active)) {
        p0XfadeDebug("yt_deck_skipped", { nextVideoId, reason: "active_not_ready" });
        return;
      }

      // Mirror the sequential setup so the natural-next flag lifecycle is identical
      // (notably the one-tick reset of ytCrossfadeStartedRef).
      ytCrossfadeCleanupRef.current?.();
      ytCrossfadeCleanupRef.current = null;
      ytCrossfadeDismissRef.current?.();
      ytCrossfadeDismissRef.current = null;
      ytCrossfadeStartedRef.current = false;
      ytOverlapFadeAbortRef.current?.();
      ytOverlapFadeAbortRef.current = null;

      const run = () => {
        if (!deckTransitionLock.tryAcquire()) {
          deckTransitionLock.queueAfter(() => run());
          return;
        }

        // Reuse the existing "transition in progress" guards so every other
        // effect (volume sync, loadYouTube, ENDED poll, stopAll) already knows
        // to stand down — exactly as it did for the sequential transition.
        ytSequentialActiveRef.current = true;
        ytManualTransitionRef.current = true;
        ytManualFadeActiveRef.current = true;

        const mixSec = Math.min(getMixDuration(), 12);
        const targetVol = volumeRef.current;
        const activePlayer = getYtActivePlayer();
        const standbyDeck = getYtStandbyDeck();
        const standbyRef = getYtPlayerRefForDeck(standbyDeck);
        let fadeAbort: (() => void) | null = null;
        let providerAdvanced = false;

        const clearTransitionFlags = () => {
          fadeAbort?.();
          fadeAbort = null;
          ytManualFadeActiveRef.current = false;
          ytManualTransitionRef.current = false;
          ytSequentialActiveRef.current = false;
          if (opts?.natural) {
            ytNaturalSequentialStartedRef.current = false;
            ytOverlapActiveRef.current = false;
          }
          deckTransitionLock.release();
        };

        const isAborted = () =>
          statusRef.current === "stopped" || !ytSequentialActiveRef.current;

        // Abort / hard failure that must NOT touch the queue/session: keep the
        // current active deck audible, drop the standby. Pointer stays put.
        const finishKeepActive = (reason: string) => {
          clearTransitionFlags();
          const a = getYtActivePlayer();
          if (isYtPlayerReady(a)) {
            safeUnMute(a);
            safeSetVolume(a, volumeRef.current);
            if (statusRef.current === "playing") safePlayVideo(a);
          }
          const sb = standbyRef.current;
          if (isYtPlayerReady(sb)) {
            safePauseVideo(sb);
            safeSetVolume(sb, 0);
          }
          p0XfadeDebug("yt_deck_keep_active", { nextVideoId, reason });
        };

        // Standby could not come up — fall back to the single-iframe sequential
        // fade on the active deck. Release our flags/lock first so it can run.
        const fallbackSequential = (reason: string) => {
          clearTransitionFlags();
          p0XfadeDebug("yt_deck_fallback_sequential", { nextVideoId, reason });
          beginYtSequentialTransitionRef.current(nextVideoId, opts);
        };

        const finishPromote = () => {
          // FLIP the pointer — refs never swap; the audible deck is now `standbyDeck`.
          ytActiveDeckRef.current = standbyDeck;
          markYtCanonicalActive(nextVideoId, opts?.natural ? "deck_natural" : "deck_manual");
          currentVidRef.current = nextVideoId;
          lastYtVidRef.current = nextVideoId;
          clearTransitionFlags();
          // Old active is now the standby deck: keep it alive, silence + pause it.
          if (isYtPlayerReady(activePlayer)) {
            safePauseVideo(activePlayer);
            safeSetVolume(activePlayer, 0);
          }
          setEmbedReady(true);
          p0XfadeDebug("yt_deck_complete", {
            nextVideoId,
            natural: !!opts?.natural,
            activeDeck: standbyDeck,
          });
        };

        void (async () => {
          // 1. Get the next video onto the standby deck — reuse its player if alive.
          const existing = standbyRef.current;
          if (isYtPlayerReady(existing)) {
            safeSetVolume(existing, 0);
            safeLoadVideoById(existing, nextVideoId);
          } else {
            createYtStandbyPlayer(standbyDeck, nextVideoId);
          }

          // 2. Wait for the standby player object to exist.
          const readyDeadline = Date.now() + 15_000;
          while (!isYtPlayerReady(standbyRef.current)) {
            if (isAborted() || Date.now() > readyDeadline) {
              finishKeepActive("standby_create_timeout");
              return;
            }
            await new Promise<void>((r) => setTimeout(r, 50));
          }
          const standby = standbyRef.current;

          // 3. Bring the standby up at volume 0 and require it to be actually
          //    PLAYING/BUFFERING before we touch a single volume value.
          safeSetVolume(standby, 0);
          safeUnMute(standby);
          safePlayVideo(standby);
          const stable = await waitForYtStandbyStable(standby, {
            timeoutMs: 8_000,
            isAborted,
          });
          if (isAborted()) {
            finishKeepActive("aborted_before_fade");
            return;
          }
          if (!stable) {
            fallbackSequential("standby_unstable");
            return;
          }

          // 4. Advance the provider queue NOW (no play command) so it tracks the
          //    incoming video — the transition flags keep loadYouTube standing down.
          if (opts?.onProviderAdvance && !providerAdvanced) {
            providerAdvanced = true;
            opts.onProviderAdvance();
          }

          // 5. True overlap: fade active out while standby comes up. Equal-power.
          p0XfadeDebug("yt_deck_crossfade_start", { nextVideoId, mixSec, standbyDeck });
          fadeAbort = runDualVolumeCrossfade(
            (outV) => safeSetVolume(activePlayer, outV),
            (inV) => safeSetVolume(standby, inV),
            targetVol,
            mixSec,
            {
              curve: "equalPower",
              minUpdateIntervalMs: 40,
              isAborted,
              onComplete: () => finishPromote(),
              onError: () => finishKeepActive("crossfade_error"),
            },
          );
        })();
      };

      if (opts?.natural) ytNaturalSequentialStartedRef.current = true;
      ytOverlapActiveRef.current = !!opts?.natural;
      run();
    },
    [
      deckTransitionLock,
      markYtCanonicalActive,
      getYtActivePlayer,
      getYtStandbyDeck,
      getYtPlayerRefForDeck,
      createYtStandbyPlayer,
    ],
  );
  beginYtDeckCrossfadeRef.current = beginYtDeckCrossfade;


  const mountSoundCloudWidget = useCallback((embedUrl: string) => {
    if (!scIframeRef.current || !window.SC) return;
    const widget = window.SC.Widget(scIframeRef.current);
    scWidgetRef.current = widget;
    widget.setVolume(volumeRef.current);
    widget.bind("ready", () => {
      if (lastScEmbedUrlRef.current !== embedUrl) return;
      setEmbedReady(true);
      if (statusRef.current === "playing") widget.play();
    });
    widget.bind("finish", () => {
      if (endedHandledRef.current) return;
      endedHandledRef.current = true;
      syncbizAuditTransportTransitionStart({
        phase: "soundcloud_finish_before_provider_next",
        auditTransportCase: "ended_auto",
      });
      nextRef.current({ auditTransportCase: "ended_auto" });
    });
  }, []);

  const beginScEmbedTransition = useCallback(
    (newEmbedUrl: string) => {
      if (scManualTransitionRef.current) return;
      const widget = scWidgetRef.current;
      if (!widget || !scIframeRef.current) return;

      const run = () => {
        if (!deckTransitionLock.tryAcquire()) {
          deckTransitionLock.queueAfter(() => run());
          return;
        }
        scManualTransitionRef.current = true;
        const mixSec = getMixDuration();
        const maxUiVol = volumeRef.current;
        let fadeAbort: (() => void) | null = null;

        const finish = (success: boolean) => {
          fadeAbort?.();
          fadeAbort = null;
          scManualTransitionRef.current = false;
          deckTransitionLock.release();
          if (success) lastScEmbedUrlRef.current = newEmbedUrl;
        };

        fadeAbort = runDualVolumeCrossfade(
          (outV) => {
            try {
              widget.setVolume(outV);
            } catch {
              /* ignore */
            }
          },
          () => {},
          maxUiVol,
          mixSec,
          {
            curve: "equalPower",
            minUpdateIntervalMs: 40,
            onComplete: () => {
              try {
                widget.unbind?.("finish");
                widget.pause();
              } catch {
                /* ignore */
              }
              scWidgetRef.current = null;
              const iframe = scIframeRef.current;
              if (iframe) iframe.src = newEmbedUrl;
              const loadSC = () => {
                if (!scIframeRef.current || !window.SC) {
                  finish(false);
                  return;
                }
                mountSoundCloudWidget(newEmbedUrl);
                const nw = scWidgetRef.current;
                if (!nw) {
                  finish(false);
                  return;
                }
                nw.setVolume(0);
                fadeAbort = runDualVolumeCrossfade(
                  () => {},
                  (inV) => {
                    try {
                      nw.setVolume(inV);
                    } catch {
                      /* ignore */
                    }
                  },
                  maxUiVol,
                  mixSec,
                  {
                    curve: "equalPower",
                    minUpdateIntervalMs: 40,
                    onComplete: () => finish(true),
                    onError: () => finish(false),
                    isAborted: () =>
                      statusRef.current === "stopped" || !scManualTransitionRef.current,
                  },
                );
                if (statusRef.current === "playing") nw.play();
              };
              if (window.SC) loadSC();
              else finish(false);
            },
            onError: () => finish(false),
            isAborted: () =>
              statusRef.current === "stopped" || !scManualTransitionRef.current,
          },
        );
      };
      run();
    },
    [deckTransitionLock, mountSoundCloudWidget],
  );
  beginScEmbedTransitionRef.current = beginScEmbedTransition;

  /** Load SoundCloud widget – deps exclude next/volume/status to avoid recreation loops and jitter */
  const loadSoundCloud = useCallback(() => {
    if (!scEmbedUrl || !scIframeRef.current) return;
    if (lastScEmbedUrlRef.current === scEmbedUrl) return;

    const prevUrl = lastScEmbedUrlRef.current;
    const midPlayback =
      statusRef.current === "playing" || statusRef.current === "paused";
    if (
      prevUrl &&
      prevUrl !== scEmbedUrl &&
      scWidgetRef.current &&
      midPlayback &&
      !scManualTransitionRef.current
    ) {
      beginScEmbedTransitionRef.current(scEmbedUrl);
      return;
    }

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
      mountSoundCloudWidget(scEmbedUrl);
    };
    if (window.SC) {
      loadSC();
      return;
    }
    const tag = document.createElement("script");
    tag.src = "https://w.soundcloud.com/player/api.js";
    tag.onload = loadSC;
    document.body.appendChild(tag);
  }, [scEmbedUrl, mountSoundCloudWidget]);

  useEffect(() => {
    if (!canPrewarmYoutubeEmbed || typeof window === "undefined") return;
    if (window.YT?.Player) {
      console.log("[SyncBiz Audit] YT API preload already ready");
      urlTimingMark("yt_api_ready", { preloaded: true, onMount: true });
      return;
    }
    if (document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) return;
    console.log("[SyncBiz Audit] YT API preload start");
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    const first = document.getElementsByTagName("script")[0];
    first?.parentNode?.insertBefore(tag, first);
    const priorReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      console.log("[SyncBiz Audit] YT API preload ready");
      urlTimingMark("yt_api_ready", { preloaded: true, onMount: false });
      if (typeof priorReady === "function") priorReady();
    };
  }, [canPrewarmYoutubeEmbed]);

  useEffect(() => {
    if (!isYouTube) return;
    loadYouTube();
  }, [isYouTube, loadYouTube]);

  useEffect(() => {
    if (!isSoundCloud) return;
    loadSoundCloud();
  }, [isSoundCloud, loadSoundCloud]);

  useEffect(() => {
    const vidFromUrl = isYouTube && currentPlayUrl ? getYouTubeVideoId(currentPlayUrl) : null;
    if (
      isYouTube &&
      vidFromUrl &&
      (ytCanonicalActiveVidRef.current === vidFromUrl ||
        lastYtVidRef.current === vidFromUrl ||
        ytSuppressColdLoadVidRef.current === vidFromUrl)
    ) {
      p0XfadeDebug("embed_state_reset_skipped_post_handoff", {
        vid: vidFromUrl,
        canonical: ytCanonicalActiveVidRef.current,
      });
      return;
    }
    if (isYouTube && vidFromUrl) {
      p0XfadeDebug("currentPlayUrl_changed_embed_reset", { vid: vidFromUrl });
    }
    urlTimingMark("audio_player_source", {
      currentPlayUrl: currentPlayUrl?.slice(0, 120) ?? null,
      currentSourceId: currentSource?.id ?? null,
      isYouTube,
      videoId: vidFromUrl,
    });
    setEmbedReady(false);
    clearYtEngineConfirmed("current_play_url_changed");
    setPosition(0);
    setDuration(0);
    setBufferedPercent(0);
    resetLocalPlaybackTime();
  }, [currentPlayUrl, isYouTube, clearYtEngineConfirmed]);

  /** YouTube stall watchdog — intent playing but engine never confirms within 4 s. */
  useEffect(() => {
    if (isDesktopMode || isControlMirror || !isYouTube) {
      if (ytStallTimerRef.current) {
        clearTimeout(ytStallTimerRef.current);
        ytStallTimerRef.current = null;
      }
      return;
    }
    if (status !== "playing") {
      if (ytStallTimerRef.current) {
        clearTimeout(ytStallTimerRef.current);
        ytStallTimerRef.current = null;
      }
      return;
    }
    if (ytStallTimerRef.current) clearTimeout(ytStallTimerRef.current);
    ytStallTimerRef.current = setTimeout(() => {
      ytStallTimerRef.current = null;
      if (statusRef.current !== "playing" || !isYouTubeRef.current) return;
      if (ytEngineConfirmedRef.current) return;
      const p = getYtActivePlayer();
      const YT = typeof window !== "undefined" ? window.YT : undefined;
      const st = isYtPlayerReady(p) ? safeGetPlayerState(p) : -1;
      const engineActive =
        YT != null && (st === YT.PlayerState.PLAYING || st === YT.PlayerState.BUFFERING);
      if (engineActive) {
        markYtEngineConfirmed("stall_watchdog_late", p);
        return;
      }
      console.warn("[SyncBiz Audit] YT stall — no playback confirmation after 4 s", {
        url: currentPlayUrlRef.current?.slice(0, 120) ?? null,
        videoId: currentVidRef.current,
        playerState: st,
        stateLabel: ytStateLabel(st),
        embedReady: embedReadyRef.current,
        hasPlayer: isYtPlayerReady(p),
      });
      urlTimingMark("stall_error", { playerState: st, stateLabel: ytStateLabel(st) });
      if (urlTimingActive()) urlTimingSummary({ outcome: "stall_error" });
      setLastMessage(getTranslations(locale).playbackFailed);
      stop();
    }, 4000);
    return () => {
      if (ytStallTimerRef.current) {
        clearTimeout(ytStallTimerRef.current);
        ytStallTimerRef.current = null;
      }
    };
  }, [
    status,
    isYouTube,
    currentPlayUrl,
    isControlMirror,
    isDesktopMode,
    stop,
    setLastMessage,
    locale,
    getYtActivePlayer,
    markYtEngineConfirmed,
    clearYtEngineConfirmed,
  ]);

  useEffect(() => {
    if (!isYouTube || isControlMirror || isDesktopMode) return;
    if (status === "stopped" || status === "idle" || status === "paused") {
      clearYtEngineConfirmed(`status_${status}`);
    }
  }, [status, isYouTube, isControlMirror, isDesktopMode, clearYtEngineConfirmed]);

  const handlePlaybackError = useCallback(
    (err: unknown, context?: string) => {
      mvpLog("playback_error", { error: String(err), context });
      setLastMessage(getTranslations(locale).playbackFailed);
    },
    [setLastMessage, locale]
  );

  /**
   * iPhone Safari rejects programmatic `audio.play()` outside the user-gesture
   * activation window. When that happens, flip status back to paused so the
   * UI doesn't claim audio is playing while it's silent, and surface the
   * "Tap to resume" affordance via the iOS unlock module.
   */
  const handleAudioPlayRejection = useCallback(
    (err: unknown, context?: string) => {
      if (isIOSAutoplayBlock(err)) {
        playbackLifecycleLog("ios_autoplay_block", { context, error: String(err) });
        setIOSNeedsTapToResume(true);
        try {
          pause();
        } catch {
          /* ignore — pause is best-effort; UI still flips via state */
        }
        return;
      }
      handlePlaybackError(err, context);
    },
    [handlePlaybackError, pause]
  );

  /** Load a stream URL on a specific deck (direct or HLS). Used for cold starts and post-crossfade handoff. */
  const loadStreamOnDeck = useCallback(
    (deck: DeckId, url: string, shouldPlay: boolean) => {
      const audio = getDeckAudio(deck);
      if (!audio) return;
      const useHls = isHlsUrl(url);
      if (hlsRef.current && hlsDeckRef.current !== deck) {
        try {
          hlsRef.current.destroy();
        } catch {
          /* ignore */
        }
        hlsRef.current = null;
        hlsDeckRef.current = null;
      }
      if (useHls) {
        void import("hls.js").then(({ default: Hls }) => {
          if (Hls.isSupported()) {
            if (hlsRef.current) {
              try {
                hlsRef.current.destroy();
              } catch {
                /* ignore */
              }
            }
            const hls = new Hls();
            hlsRef.current = hls;
            hlsDeckRef.current = deck;
            hls.on(Hls.Events.ERROR, (_e, data) => {
              if (data.fatal) {
                mvpLog("playback_error", { error: data.type, context: "hls" });
                setLastMessage(getTranslations(locale).streamFailed);
              }
            });
            hls.loadSource(url);
            hls.attachMedia(audio);
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
              if (shouldPlay && statusRef.current === "playing") {
                audio.play().catch((e) => handleAudioPlayRejection(e, "audio.play"));
              }
            });
          } else if (audio.canPlayType("application/vnd.apple.mpegurl")) {
            audio.src = url;
            if (shouldPlay && statusRef.current === "playing") {
              audio.play().catch((e) => handleAudioPlayRejection(e, "audio.play"));
            }
          } else {
            audio.src = url;
            if (shouldPlay && statusRef.current === "playing") {
              audio.play().catch((e) => handleAudioPlayRejection(e, "audio.play"));
            }
          }
        });
        return;
      }
      if (hlsRef.current) {
        try {
          hlsRef.current.destroy();
        } catch {
          /* ignore */
        }
        hlsRef.current = null;
        hlsDeckRef.current = null;
      }
      p0XfadeDebug("loadStreamOnDeck_src_set", {
        deck,
        url: url.slice(0, 120),
        shouldPlay,
        status: statusRef.current,
      });
      audio.src = url;
      if (shouldPlay && statusRef.current === "playing") {
        audio.play().catch((e) => handleAudioPlayRejection(e, "audio.play"));
      }
    },
    [getDeckAudio, handleAudioPlayRejection, locale],
  );

  /**
   * Manual or provider-driven URL replacement: crossfade active → standby when possible.
   * HLS uses fade-out → load → fade-in fallback (no true overlap).
   */
  const beginStreamUrlTransition = useCallback(
    (nextUrl: string) => {
      const run = () => {
        syncAudioRefToActiveDeck();
        p0XfadeDebug("transition_start", {
          via: lastPlayCommandViaRef.current,
          engine: "html_ab",
          nextUrl: nextUrl.slice(0, 120),
          activeDeck: getActiveDeck(),
          standbyDeck: getStandbyDeck(),
          status: statusRef.current,
          prevUrl: lastStreamUrlRef.current?.slice(0, 120) ?? null,
        });
        if (!deckTransitionLock.tryAcquire()) {
          deckTransitionLock.queueAfter(() => run());
          return;
        }
        const active = getDeckAudio(getActiveDeck());
        const standby = getDeckAudio(getStandbyDeck());
        p0XfadeDebug("deck_elements", {
          hasActive: !!active,
          hasStandby: !!standby,
          activeDeck: getActiveDeck(),
          standbyDeck: getStandbyDeck(),
        });
        const targetVol = volumeRef.current / 100;
        const mixSec = getMixDuration();
        const useHls = isHlsUrl(nextUrl);

        const releaseAndLoadDirect = () => {
          lastStreamUrlRef.current = nextUrl;
          standbyPreloadedUrlRef.current = null;
          loadStreamOnDeck(getActiveDeck(), nextUrl, statusRef.current === "playing");
          deckTransitionLock.release();
        };

        if (!active) {
          releaseAndLoadDirect();
          return;
        }

        streamTransitionAbortRef.current?.();
        crossfadeCleanupRef.current?.();
        crossfadeCleanupRef.current = null;
        crossfadeStartedRef.current = false;
        crossfadeAbortRef.current = true;

        if (useHls || !standby) {
          xfadeLog("hls_fade_fallback", { nextUrl: nextUrl.slice(0, 60) });
          const fadeOut = runVolumeFade(active, targetVol, 0, mixSec, {
            onComplete: () => {
              active.pause();
              active.currentTime = 0;
              releaseAndLoadDirect();
              if (statusRef.current === "playing") {
                runVolumeFade(active, 0, targetVol, mixSec, {
                  onComplete: () => {},
                  isAborted: () => statusRef.current === "stopped",
                });
              }
            },
            isAborted: () => statusRef.current === "stopped",
          });
          streamTransitionAbortRef.current = fadeOut;
          return;
        }

        streamTransitionAbortRef.current = runAbDeckCrossfade(
          active,
          standby,
          nextUrl,
          targetVol,
          mixSec,
          {
            onComplete: () => {
              swapActiveDeck();
              lastStreamUrlRef.current = nextUrl;
              standbyPreloadedUrlRef.current = null;
              streamTransitionAbortRef.current = null;
              deckTransitionLock.release();
              xfadeLog("manual_handoff_complete", { nextUrl: nextUrl.slice(0, 60) });
              p0XfadeDebug("transition_complete", {
                nextUrl: nextUrl.slice(0, 80),
                via: lastPlayCommandViaRef.current,
                engine: "html_ab",
                suppressedReload: true,
              });
            },
            onError: () => {
              releaseAndLoadDirect();
              streamTransitionAbortRef.current = null;
            },
            isAborted: () => statusRef.current === "stopped",
            getStatus: () => statusRef.current,
          },
        );
      };
      run();
    },
    [
      deckTransitionLock,
      getDeckAudio,
      getActiveDeck,
      getStandbyDeck,
      loadStreamOnDeck,
      swapActiveDeck,
      syncAudioRefToActiveDeck,
    ],
  );

  /** Best-effort resume when tab/app returns — does not override user pause (status must still be playing). */
  const nudgeResumePlayback = useCallback(() => {
    if (typeof document !== "undefined" && document.hidden) return;
    if (isControlMirrorRef.current) return;
    if (statusRef.current !== "playing") return;
    playbackLifecycleLog("resume_media_attempt", {
      isHtmlAudio: isHtmlAudioRef.current,
      isYouTube: isYouTubeRef.current,
      isSoundCloud: isSoundCloudRef.current,
      embedReady: embedReadyRef.current,
    });
    try {
      if (isHtmlAudioRef.current && audioRef.current?.paused) {
        void audioRef.current.play().catch((e) => {
          playbackLifecycleLog("resume_media_attempt", { result: "audio_reject", error: String(e) });
          handleAudioPlayRejection(e, "nudgeResumePlayback");
        });
      }
      if (isYouTubeRef.current && embedReadyRef.current) {
        const p = getYtActivePlayer();
        console.log("[SyncBiz Audit] YT command target", {
          reason: "nudgeResumePlayback",
          hasPlayer: isYtPlayerReady(p),
        });
        if (isYtPlayerReady(p)) guardedYtPlay(p, "nudgeResumePlayback");
      }
      if (isSoundCloudRef.current && scWidgetRef.current) {
        scWidgetRef.current.play();
      }
    } catch (e) {
      playbackLifecycleLog("resume_media_attempt", { result: "error", error: String(e) });
    }
  }, [handleAudioPlayRejection, guardedYtPlay]);

  useEffect(() => {
    playbackLifecycleLog("platform_hint", {
      wakeLockApi: typeof navigator !== "undefined" && "wakeLock" in navigator,
      iosLike: typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(navigator.userAgent),
      standalonePwa:
        typeof window !== "undefined" &&
        (window.matchMedia("(display-mode: standalone)").matches ||
          (navigator as Navigator & { standalone?: boolean }).standalone === true),
    });
  }, []);

  // Make the live <audio> element discoverable by the iOS unlock module so
  // mobile-now-playing-sheet can call audio.play() synchronously inside its
  // tap handler. No-op on non-iOS UAs because primeIOSFromGesture short-circuits.
  useEffect(() => {
    syncAudioRefToActiveDeck();
    registerIOSAudioElement(audioRef.current);
    return () => registerIOSAudioElement(null);
  }, [syncAudioRefToActiveDeck]);

  // Clear the "Tap to resume" flag whenever audio actually starts playing or
  // the user explicitly pauses/stops, so the affordance only appears when
  // iOS actually blocked us.
  useEffect(() => {
    if (status === "playing") {
      const audio = audioRef.current;
      if (!audio) return;
      const onPlaying = () => setIOSNeedsTapToResume(false);
      audio.addEventListener("playing", onPlaying);
      return () => audio.removeEventListener("playing", onPlaying);
    }
    if (status === "paused" || status === "stopped" || status === "idle") {
      setIOSNeedsTapToResume(false);
    }
  }, [status]);

  useEffect(() => {
    if (isControlMirror) return;
    if (status !== "playing") {
      void releasePlaybackWakeLock(wakeLockRef);
      return;
    }
    if (typeof document !== "undefined" && document.hidden) return;
    void acquirePlaybackWakeLock(wakeLockRef);
    return () => {
      void releasePlaybackWakeLock(wakeLockRef);
    };
  }, [status, isControlMirror]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    const onVisibility = () => {
      playbackLifecycleLog("visibility", {
        hidden: document.hidden,
        visibilityState: document.visibilityState,
      });
      if (document.visibilityState === "visible") {
        logProviderEngineTruthSnapshot("visibilitychange_to_visible");
      }
      if (!document.hidden) {
        nudgeResumePlayback();
        if (statusRef.current === "playing" && !isControlMirrorRef.current) {
          void acquirePlaybackWakeLock(wakeLockRef);
        }
      }
    };
    const onPageHide = (e: PageTransitionEvent) => {
      playbackLifecycleLog("pagehide", { persisted: e.persisted });
    };
    const onPageShow = (e: PageTransitionEvent) => {
      playbackLifecycleLog("pageshow", { persisted: e.persisted });
      if (!document.hidden) {
        logProviderEngineTruthSnapshot("pageshow");
      }
      nudgeResumePlayback();
      if (statusRef.current === "playing" && !isControlMirrorRef.current && !document.hidden) {
        void acquirePlaybackWakeLock(wakeLockRef);
      }
    };
    const onFreeze = () => playbackLifecycleLog("freeze", {});
    const onResume = () => {
      playbackLifecycleLog("resume", {});
      logProviderEngineTruthSnapshot("document_resume");
      nudgeResumePlayback();
    };
    const onFocus = () => playbackLifecycleLog("focus", {});
    const onBlur = () => playbackLifecycleLog("blur", {});

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("freeze", onFreeze);
    document.addEventListener("resume", onResume);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("freeze", onFreeze);
      document.removeEventListener("resume", onResume);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, [nudgeResumePlayback, logProviderEngineTruthSnapshot]);

  // HTML5 audio play/pause – only call play() when paused to avoid redundant calls that can cause jumps
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !isHtmlAudio) return;
    if (status === "playing") {
      if (audio.paused) audio.play().catch((e) => handleAudioPlayRejection(e, "audio.play"));
    } else {
      audio.pause();
      if (status === "stopped") audio.currentTime = 0;
    }
  }, [status, isHtmlAudio, handleAudioPlayRejection]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !isHtmlAudio) return;
    if (deckTransitionLock.isLocked() || streamTransitionAbortRef.current || crossfadeStartedRef.current) {
      p0XfadeDebug("volume_sync_skipped_during_transition");
      return;
    }
    audio.volume = volume / 100;
  }, [volume, isHtmlAudio, deckTransitionLock]);

  const stopAllEmbedded = useCallback(() => {
    p0XfadeDebug("stopAllEmbedded_called", {
      ytManual: ytManualTransitionRef.current,
      scManual: scManualTransitionRef.current,
      lock: deckTransitionLock.isLocked(),
      canonical: ytCanonicalActiveVidRef.current,
      inGrace: Date.now() < ytHandoffGraceUntilRef.current,
    });
    if (
      ytManualTransitionRef.current ||
      ytSequentialActiveRef.current ||
      scManualTransitionRef.current ||
      deckTransitionLock.isLocked() ||
      isYtHandoffGuardActive()
    ) {
      p0XfadeDebug("stopAllEmbedded_skipped_transition_active");
      return;
    }
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
  }, [isYtHandoffGuardActive]);

  useEffect(() => {
    const unregister = registerStopAllPlayers(stopAllEmbedded);
    return unregister;
  }, [registerStopAllPlayers, stopAllEmbedded]);

  useEffect(() => {
    const seekToLocal = (seconds: number) => {
      const sec = Math.max(0, seconds);
      if (deviceCtx?.deviceMode === "MASTER") {
        masterPlaybackDiag("seekTo programmatic", { seconds: sec, isYouTube, isSoundCloud, isHtmlAudio });
      }
      // Desktop plays audio through MPV — a programmatic seek (e.g. a CONTROL
      // dragging the phone's progress bar → SEEK command) must go to MPV, NOT the
      // muted YouTube video iframe. This mirrors the desktop's own seek bar
      // (onSeekChange → mpvSeekTo); without it, controller SEEK moved the silent
      // clip while the MPV audio stayed put ("seek from the phone does nothing").
      if (isDesktopMode) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        void (window as any).syncbizDesktop?.mpvSeekTo?.(sec);
        return;
      }
      if (isYouTube) {
        const p = getYtActivePlayer();
        if (isYtPlayerReady(p)) {
          safeSeekTo(p, sec, true);
          setPosition(sec);
        }
      } else if (isSoundCloud && scWidgetRef.current) {
        scWidgetRef.current.seekTo(sec * 1000);
        setPosition(sec);
      } else if (isHtmlAudio && audioRef.current) {
        audioRef.current.currentTime = sec;
        setPosition(sec);
      }
    };
    return registerSeekCallback(seekToLocal);
  }, [registerSeekCallback, isYouTube, isSoundCloud, isHtmlAudio, isDesktopMode]);

  /** Tear down embeds only when leaving YouTube/SoundCloud — NOT on every URL/track change. */
  useEffect(() => {
    if (!isYouTube && !isSoundCloud) {
      lastScEmbedUrlRef.current = null;
    }
  }, [isYouTube, isSoundCloud]);

  useEffect(() => {
    if (isYouTube || isSoundCloud) return;
    p0XfadeDebug("embed_teardown_non_embed_mode");
    stopAllEmbedded();
  }, [isYouTube, isSoundCloud, stopAllEmbedded]);

  useEffect(() => {
    const p = getYtActivePlayer();
    const urlVid = isYouTube && currentPlayUrl ? getYouTubeVideoId(currentPlayUrl) : null;
    if (status === "playing") {
      if (isYtPlayerReady(p) && isYouTube) {
        console.log("[SyncBiz Audit] YT command target", {
          reason: "status_play",
          hasPlayer: true,
          videoUrl: currentPlayUrl,
        });
        guardedYtPlay(p, "status_effect_play");
      }
      else if (scWidgetRef.current && isSoundCloud) scWidgetRef.current.play();
    } else if (status === "paused" || status === "stopped") {
      if (status === "stopped" && isYouTube) {
        if (isYtHandoffGuardActive(urlVid)) {
          p0XfadeDebug("status_stop_skipped_post_handoff", { urlVid });
        } else {
          clearYtCanonicalActive("status_stopped");
        }
      }
      if (isYtPlayerReady(p) && isYouTube) {
        if (isYtHandoffGuardActive(urlVid)) {
          p0XfadeDebug("status_pause_stop_skipped_post_handoff", { status, urlVid });
        } else {
          if (status === "stopped") safeStopVideo(p);
          else safePauseVideo(p);
        }
      } else if (scWidgetRef.current && isSoundCloud) {
        scWidgetRef.current.pause();
        if (status === "stopped") scWidgetRef.current.seekTo(0);
      }
    }
  }, [status, isYouTube, isSoundCloud, embedReady, currentPlayUrl, guardedYtPlay, clearYtCanonicalActive, isYtHandoffGuardActive]);

  // Stream URL routing: A/B deck crossfade on replacement; cold load when idle/stopped.
  // IMPORTANT: Do NOT include status in deps – play/pause is handled separately.
  useEffect(() => {
    syncAudioRefToActiveDeck();

    // Local file paths (Windows/Unix absolute paths, file:// URIs) cannot be loaded by a web
    // browser renderer due to security restrictions. Detect this early, log a clear error, and
    // stop playback so the UI does not show a fake PLAYING state. On Electron Desktop the
    // MPV bridge handles local files; the HTML audio engine is intentionally bypassed.
    const isDesktopApp = typeof window !== "undefined" && "syncbizDesktop" in window;
    if (isHtmlAudio && currentPlayUrl && !isDesktopApp && isValidLocalFilePlaybackPath(currentPlayUrl)) {
      console.warn("[SyncBiz Audit] local_file_browser_blocked", {
        url: currentPlayUrl.slice(0, 120),
        note: "Browser cannot load local filesystem paths. Use the SyncBiz Desktop app to play local files.",
      });
      setLastMessage("Local files require the SyncBiz desktop app");
      stop();
      return;
    }

    if (!isHtmlAudio || !currentPlayUrl) {
      lastStreamUrlRef.current = null;
      standbyPreloadedUrlRef.current = null;
      if (hlsRef.current) {
        try {
          hlsRef.current.destroy();
        } catch {
          /* ignore */
        }
        hlsRef.current = null;
        hlsDeckRef.current = null;
      }
      for (const deck of ["A", "B"] as DeckId[]) {
        const el = getDeckAudio(deck);
        if (el) {
          el.pause();
          el.removeAttribute("src");
          el.load();
        }
      }
      return;
    }

    if (lastStreamUrlRef.current === currentPlayUrl) return;

    const prevUrl = lastStreamUrlRef.current;
    const shouldCrossfade =
      !!prevUrl &&
      prevUrl !== currentPlayUrl &&
      (statusRef.current === "playing" || statusRef.current === "paused");

    if (shouldCrossfade) {
      xfadeLog("url_change_transition", {
        from: prevUrl.slice(0, 60),
        to: currentPlayUrl.slice(0, 60),
      });
      p0XfadeDebug("html_routing_crossfade", {
        from: prevUrl.slice(0, 80),
        to: currentPlayUrl.slice(0, 80),
      });
      beginStreamUrlTransition(currentPlayUrl);
      return;
    }

    p0XfadeDebug("html_routing_cold_load", {
      url: currentPlayUrl.slice(0, 80),
      prevUrl: prevUrl?.slice(0, 80) ?? null,
      status: statusRef.current,
    });
    lastStreamUrlRef.current = currentPlayUrl;
    standbyPreloadedUrlRef.current = null;
    loadStreamOnDeck(getActiveDeck(), currentPlayUrl, statusRef.current === "playing");
  }, [isHtmlAudio, currentPlayUrl, beginStreamUrlTransition, loadStreamOnDeck, getDeckAudio, getActiveDeck, syncAudioRefToActiveDeck, stop, setLastMessage]);

  useEffect(() => {
    if (
      ytManualTransitionRef.current ||
      ytSequentialActiveRef.current ||
      ytManualFadeActiveRef.current ||
      ytOverlapActiveRef.current ||
      ytOverlapFadeAbortRef.current ||
      deckTransitionLock.isLocked()
    ) {
      p0XfadeDebug("embed_volume_sync_skipped_during_transition");
      return;
    }
    const p = getYtActivePlayer();
    if (isYtPlayerReady(p) && isYouTube) safeSetVolume(p, volume);
    else if (scWidgetRef.current && isSoundCloud) scWidgetRef.current.setVolume(volume);
  }, [volume, isYouTube, isSoundCloud, deckTransitionLock]);

  useEffect(() => {
    const isDesktop = typeof window !== "undefined" && "syncbizDesktop" in window;
    const engineName = isYouTube ? "youtube_iframe"
      : (isSoundCloud ? "soundcloud_widget"
      : (isDesktop ? "mpv_desktop" : (currentPlayUrl ? "html_audio" : "none")));
    const isLocalPath = currentPlayUrl ? isValidLocalFilePlaybackPath(currentPlayUrl) : false;
    console.log("[SyncBiz Audit] AudioPlayer engine_selection", {
      engine: engineName,
      url: currentPlayUrl?.slice(0, 120) ?? null,
      videoId: isYouTube && currentPlayUrl ? getYouTubeVideoId(currentPlayUrl) : null,
      playlistId: isYouTube && currentPlayUrl ? getYouTubePlaylistId(currentPlayUrl) : null,
      isEmbedded,
      isYouTube,
      isSoundCloud,
      isLocalPath,
      isDesktop,
      isControlMirror,
      status,
      ytEngineConfirmed,
      sourceId: currentSource?.id ?? null,
      sourceTitle: currentSource?.title ?? null,
      sourceType: currentTrack?.type ?? null,
      embedMismatch: isYouTube && !isEmbedded ? "isYouTube_without_isEmbedded" : null,
      note: isLocalPath && !isDesktop ? "LOCAL_PATH_IN_BROWSER: will be blocked by stream routing guard" : null,
    });
    p0XfadeDebug("currentPlayUrl_changed", {
      url: currentPlayUrl?.slice(0, 120) ?? null,
      isHtmlAudio,
      isYouTube,
      isSoundCloud,
      isDesktop,
      isControlMirror,
      deviceMode: deviceCtx?.deviceMode ?? null,
      status,
      trackType: currentTrack?.type ?? null,
      lastStreamUrl: lastStreamUrlRef.current?.slice(0, 120) ?? null,
      lock: deckTransitionLock.isLocked(),
      canonical: ytCanonicalActiveVidRef.current,
      suppress: ytSuppressColdLoadVidRef.current,
      inHandoffGrace: Date.now() < ytHandoffGraceUntilRef.current,
      via: lastPlayCommandViaRef.current,
    });
  }, [currentPlayUrl, isHtmlAudio, isYouTube, isSoundCloud, isControlMirror, deviceCtx?.deviceMode, status, currentTrack?.type, deckTransitionLock, isDesktopMode, currentSource?.id, currentSource?.title, isEmbedded, ytEngineConfirmed]);

  useEffect(() => {
    const urlVid = isYouTube && currentPlayUrl ? getYouTubeVideoId(currentPlayUrl) : null;
    if (
      urlVid &&
      ytCanonicalActiveVidRef.current === urlVid &&
      Date.now() < ytHandoffGraceUntilRef.current
    ) {
      p0XfadeDebug("url_reset_skipped_post_handoff", { urlVid });
      return;
    }
    if (
      deckTransitionLock.isLocked() ||
      ytManualTransitionRef.current ||
      ytSequentialActiveRef.current ||
      scManualTransitionRef.current ||
      streamTransitionAbortRef.current
    ) {
      p0XfadeDebug("url_reset_skipped_transition_active", {
        url: currentPlayUrl?.slice(0, 80) ?? null,
      });
      endedHandledRef.current = false;
      return;
    }
    p0XfadeDebug("url_reset_crossfade_state", { url: currentPlayUrl?.slice(0, 80) ?? null });
    endedHandledRef.current = false;
    crossfadeStartedRef.current = false;
    crossfadeAbortRef.current = false;
    crossfadeInMixWindowRef.current = false;
    crossfadeDurNonFiniteLoggedRef.current = false;
    mpvDesktopMixStartedRef.current = false;
    crossfadeCleanupRef.current?.();
    crossfadeCleanupRef.current = null;
    ytCrossfadeStartedRef.current = false;
    ytCrossfadeAbortRef.current = false;
    ytOverlapActiveRef.current = false;
    ytNextVideoIdRef.current = null;
    ytCrossfadeCleanupRef.current?.();
    ytCrossfadeCleanupRef.current = null;
    ytCrossfadeDismissRef.current?.();
    ytCrossfadeDismissRef.current = null;
    ytOverlapFadeAbortRef.current?.();
    ytOverlapFadeAbortRef.current = null;
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
      const p = getYtActivePlayer();
      if (!isYtPlayerReady(p)) return;
      const playlist = safeGetPlaylist(p);
      const idx = safeGetPlaylistIndex(p);
      const data = safeGetVideoData(p);
      if (!data) return;
      const total = playlist.length || 1;
      const nextVid = playlist[idx + 1] ?? null;
      const nextThumb = nextVid ? `https://img.youtube.com/vi/${nextVid}/hqdefault.jpg` : null;
      const ytFallback = getTranslations(locale).providerYouTube;
      setYtMultiTrackState((prev) => {
        if (prev && prev.currentIndex === idx && prev.currentTitle === data.title) return prev;
        return {
          currentTitle: data.title || ytFallback,
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
  }, [isYouTubeMultiTrack, isYouTube, locale]);

  useEffect(() => {
    if (!currentSource || isSeekingRef.current) return;
    const poll = () => {
      if (isSeekingRef.current) return;
      truthAuditPollTickRef.current += 1;
      truthAuditLastPollWallMsRef.current = Date.now();
      if (isYouTube) {
        const p = getYtActivePlayer();
        if (isYtPlayerReady(p)) {
          const playerState = safeGetPlayerState(p);
          if (playerState === window.YT!.PlayerState.ENDED) {
            if (Date.now() < ytHandoffGraceUntilRef.current) {
              p0XfadeDebug("yt_ended_ignored_handoff_grace", {
                canonical: ytCanonicalActiveVidRef.current,
                currentVid: currentVidRef.current,
              });
              return;
            }
            const overlapActiveOuter = !!ytOverlapActiveRef.current;
            const nextVidOuter = ytNextVideoIdRef.current;
            console.log("[SyncBiz Audit] YT ended outer_state", {
              currentUrl: currentPlayUrl,
              currentSourceId: currentSource?.id ?? null,
              currentTrackIndex,
              queueIndex,
              queueLength: queue.length,
              isYouTubeMix,
              endedHandled: endedHandledRef.current,
              overlapActive: overlapActiveOuter,
              nextVid: nextVidOuter,
            });
            console.log("[SyncBiz Audit] YT ended", {
              currentUrl: currentPlayUrl,
              trackType: currentTrack?.type,
              currentTrackIndex,
              isMix: isYouTubeMix,
              isMultiTrack: isYouTubeMultiTrack,
            });
            const willEnterInnerGuard = !isYouTubeMix && !endedHandledRef.current;
            console.log("[SyncBiz Audit] YT ended guard_decision", {
              currentUrl: currentPlayUrl,
              currentSourceId: currentSource?.id ?? null,
              currentTrackIndex,
              queueIndex,
              queueLength: queue.length,
              isYouTubeMix,
              endedHandled: endedHandledRef.current,
              willEnterInnerGuard,
              overlapActive: overlapActiveOuter,
              nextVid: nextVidOuter,
            });
            if (willEnterInnerGuard) {
              const overlapActive = !!ytOverlapActiveRef.current;
              const nextVid = ytNextVideoIdRef.current;
              console.log("[SyncBiz Audit] YT ended guard_state", {
                currentUrl: currentPlayUrl,
                currentSourceId: currentSource?.id ?? null,
                currentTrackIndex,
                queueIndex,
                queueLength: queue.length,
                endedHandled: endedHandledRef.current,
                overlapActive,
                nextVid,
              });
              ytXfadeLog("current_ended", { overlapActive, nextVid: nextVid ?? null });
              console.log("[SyncBiz Audit] YT AutoMix current_ended", {
                overlapActive,
                nextVid,
              });
              if (
                ytSequentialActiveRef.current ||
                ytNaturalSequentialStartedRef.current ||
                overlapActive
              ) {
                p0XfadeDebug("yt_ended_ignored_sequential", {
                  overlapActive,
                  sequential: ytSequentialActiveRef.current,
                  natural: ytNaturalSequentialStartedRef.current,
                });
                endedHandledRef.current = true;
              } else {
                endedHandledRef.current = true;
                if (ytCrossfadeStartedRef.current) {
                  ytCrossfadeCleanupRef.current?.();
                  ytCrossfadeStartedRef.current = false;
                  ytNextVideoIdRef.current = null;
                }
                console.log("[SyncBiz Audit] YT AutoMix fallback_next", {
                  currentSourceId: currentSource?.id,
                });
                console.log("[SyncBiz Audit] YT ended next_called", {
                  path: "fallback_next",
                  currentUrl: currentPlayUrl,
                  currentSourceId: currentSource?.id ?? null,
                  currentTrackIndex,
                  queueIndex,
                  queueLength: queue.length,
                });
                console.log("[SyncBiz Audit] runtime path step", {
                  transport: "audio_player_yt_ended",
                  phase: "before_provider_next_ended_auto",
                  auditTransportCase: "ended_auto",
                  currentPlayUrlSnapshot: currentPlayUrl?.slice(0, 200) ?? null,
                  currentSourceId: currentSource?.id ?? null,
                  currentTrackIndex,
                  queueLength: queue.length,
                });
                const beforeSourceId = currentSource?.id ?? null;
                const beforeTrackIndex = currentTrackIndex;
                // Capture URL before next() — used below to detect single-track restart.
                const urlBeforeNext = currentPlayUrlRef.current;
                syncbizAuditTransportTransitionStart({
                  phase: "yt_poll_ended_fallback_before_provider_next",
                  auditTransportCase: "ended_auto",
                  currentSourceId: beforeSourceId,
                  queueIndex,
                  queueLength: queue.length,
                });
                nextRef.current({ auditTransportCase: "ended_auto" });
                setTimeout(() => {
                  console.log("[SyncBiz Audit] YT ended state_after_next", {
                    currentUrl: currentPlayUrl,
                    previousSourceId: beforeSourceId,
                    previousTrackIndex: beforeTrackIndex,
                    currentSourceId: currentSource?.id ?? null,
                    currentTrackIndex,
                    queueIndex,
                    queueLength: queue.length,
                  });
                  // Single-track playlist restart guard:
                  // When next() performs a same-index restart (sessionTracks.length === 1),
                  // currentPlayUrl does not change, so the useEffect([currentPlayUrl]) that
                  // resets endedHandledRef never fires. The YT player stays stuck in ENDED
                  // state with endedHandledRef=true, preventing any further advance forever.
                  // Fix: if the URL is still the same after next(), seek to 0 and replay.
                  if (currentPlayUrlRef.current === urlBeforeNext) {
                    const p = getYtActivePlayer();
                    if (isYtPlayerReady(p)) {
                      console.log("[SyncBiz Audit] YT single-track restart — replaying from 0", {
                        url: urlBeforeNext,
                      });
                      endedHandledRef.current = false;
                      safeSeekTo(p, 0, true);
                      guardedYtPlay(p, "single_track_restart");
                    }
                  }
                }, 0);
              }
            }
          } else {
            if (endedHandledRef.current) {
              console.log("[SyncBiz Audit] YT ended reset_flag", {
                currentUrl: currentPlayUrl,
                currentSourceId: currentSource?.id ?? null,
                currentTrackIndex,
                reason: "playerState_not_ENDED",
              });
            }
            if (!(ytCanonicalActiveVidRef.current && Date.now() < ytHandoffGraceUntilRef.current)) {
              endedHandledRef.current = false;
            }
          }
          const pos = safeGetCurrentTime(p);
          const dur = safeGetDuration(p);
          if (Number.isFinite(pos)) truthAuditLastEngineTimeRef.current = pos;
          updatePositionIfChanged(pos);
          updateDurationIfChanged(dur);
          const frac = safeGetVideoLoadedFraction(p);
          updateBufferedIfChanged(frac * 100);
          if (deviceCtx?.isBranchConnected && deviceCtx.deviceMode === "MASTER" && Number.isFinite(pos) && Number.isFinite(dur)) {
            deviceCtx.reportPosition(pos, dur);
          }
          reportRecoveryProgress(pos);
          const YT = window.YT;
          if (
            statusRef.current === "playing" &&
            !ytEngineConfirmedRef.current &&
            YT != null &&
            (playerState === YT.PlayerState.PLAYING || playerState === YT.PlayerState.BUFFERING)
          ) {
            markYtEngineConfirmed("poll_state", p);
          }
          if (
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
              console.log("[SyncBiz Audit] YT AutoMix automix_source_check", {
                pos,
                dur,
                mixSec,
                currentUrl: currentPlayUrl,
                nextUrl,
                nextVid,
              });
            }
            if (pos >= preloadThreshold && !nextVid && nextEmbed) {
              p0XfadeDebug("natural_preload_skipped_no_vid", {
                pos,
                dur,
                nextUrl: nextUrl?.slice(0, 80) ?? null,
                sessionNext: true,
              });
            }
            if (
              pos >= mixPointThreshold &&
              nextVid &&
              !ytNaturalSequentialStartedRef.current &&
              !ytSequentialActiveRef.current &&
              !ytCrossfadeStartedRef.current
            ) {
              ytCrossfadeStartedRef.current = true;
              ytNextVideoIdRef.current = nextVid;
              endedHandledRef.current = true;
              p0XfadeDebug("yt_natural_deck_crossfade_start", { nextVid, pos, dur, mixSec });
              beginYtDeckCrossfadeRef.current(nextVid, {
                natural: true,
                onProviderAdvance: () => {
                  syncbizAuditTransportTransitionStart({
                    phase: "yt_natural_sequential_provider_advance",
                    auditTransportCase: "ended_auto",
                  });
                  nextRef.current({ skipPlay: true, auditTransportCase: "ended_auto" });
                },
              });
            }
          }
        }
      } else if (isSoundCloud && scWidgetRef.current) {
        scWidgetRef.current.getPosition((pos) => {
          const p = pos / 1000;
          if (Number.isFinite(p)) truthAuditLastEngineTimeRef.current = p;
          updatePositionIfChanged(p);
          scWidgetRef.current?.getDuration((dur) => {
            const d = dur / 1000;
            updateDurationIfChanged(d);
            if (deviceCtx?.isBranchConnected && deviceCtx.deviceMode === "MASTER" && Number.isFinite(p) && Number.isFinite(d)) {
              deviceCtx.reportPosition(p, d);
            }
            reportRecoveryProgress(p);
          });
        });
      } else if (isHtmlAudio && audioRef.current) {
        const a = audioRef.current;
        const t = a.currentTime;
        const d = a.duration;
        if (Number.isFinite(t)) truthAuditLastEngineTimeRef.current = t;
        lastKnownDurationRef.current = d;
        updatePositionIfChanged(t);
        if (!Number.isFinite(d) || d <= 0) {
          if (!crossfadeDurNonFiniteLoggedRef.current) {
            xfadeLog("duration_not_finite", { d, url: currentPlayUrl?.slice(0, 50), type: currentTrack?.type, origin: currentSource?.origin });
            crossfadeDurNonFiniteLoggedRef.current = true;
          }
        }
        if (Number.isFinite(d) && d > 0) {
          updateDurationIfChanged(d);
          if (a.buffered.length > 0) {
            const end = a.buffered.end(a.buffered.length - 1);
            updateBufferedIfChanged((end / d) * 100);
          }
          if (deviceCtx?.isBranchConnected && deviceCtx.deviceMode === "MASTER" && Number.isFinite(t) && Number.isFinite(d)) {
            deviceCtx.reportPosition(t, d);
          }
          reportRecoveryProgress(t);
          const mixSec = getMixDuration();
          const preloadAt = preloadThresholdSec(d, mixSec);
          const mixAt = mixPointThresholdSec(d, mixSec);
          const nextUrl = getNextStreamUrl();
          const canOverlap = !!(
            nextUrl &&
            currentPlayUrl &&
            !isHlsUrl(currentPlayUrl) &&
            !isHlsUrl(nextUrl)
          );

          if (canOverlap && t >= preloadAt && standbyPreloadedUrlRef.current !== nextUrl) {
            const standby = getDeckAudio(getStandbyDeck());
            if (standby && !crossfadeStartedRef.current) {
              standbyPreloadedUrlRef.current = nextUrl;
              standby.volume = 0;
              standby.preload = "auto";
              standby.src = nextUrl;
              standby.load();
              xfadeLog("standby_preload", { nextUrl: nextUrl.slice(0, 60), t, d, preloadAt });
            }
          }

          if (t >= mixAt && !crossfadeInMixWindowRef.current) {
            crossfadeInMixWindowRef.current = true;
            xfadeLog("mix_window_entered", {
              t,
              d,
              mixSec,
              mixAt,
              nextUrl: nextUrl ? "yes" : "no",
              status: statusRef.current,
              hls: isHlsUrl(currentPlayUrl ?? ""),
            });
          }

          if (
            statusRef.current === "playing" &&
            canOverlap &&
            !crossfadeStartedRef.current &&
            nextUrl &&
            t >= mixAt
          ) {
            const standby = getDeckAudio(getStandbyDeck());
            if (!standby) return;
            xfadeLog("trigger", { t, d, mixSec, nextUrl: nextUrl.slice(0, 60) });
            p0XfadeDebug("natural_crossfade_trigger", {
              t,
              d,
              mixSec,
              nextUrl: nextUrl.slice(0, 80),
              activeDeck: getActiveDeck(),
              standbyDeck: getStandbyDeck(),
            });
            crossfadeStartedRef.current = true;
            crossfadeAbortRef.current = false;
            crossfadeCleanupRef.current?.();
            if (!deckTransitionLock.tryAcquire()) {
              crossfadeStartedRef.current = false;
              return;
            }
            const abort = runAbDeckCrossfade(a, standby, nextUrl, volumeRef.current / 100, mixSec, {
              onComplete: () => {
                swapActiveDeck();
                lastStreamUrlRef.current = nextUrl;
                standbyPreloadedUrlRef.current = null;
                deckTransitionLock.release();
                xfadeLog("onComplete");
                syncbizAuditTransportTransitionStart({
                  phase: "direct_audio_xfade_onComplete_before_provider_next_skipPlay",
                  auditTransportCase: "ended_auto",
                  skipPlay: true,
                  nextUrlPreview: nextUrl?.slice(0, 120) ?? null,
                });
                (nextRef.current as ((opts?: { skipPlay?: boolean; auditTransportCase?: "ended_auto" }) => void) | undefined)?.({
                  skipPlay: true,
                  auditTransportCase: "ended_auto",
                });
                endedHandledRef.current = true;
              },
              onError: () => {
                deckTransitionLock.release();
                crossfadeStartedRef.current = false;
                xfadeLog("onError");
              },
              isAborted: () => crossfadeAbortRef.current || statusRef.current !== "playing",
              getStatus: () => statusRef.current,
            });
            crossfadeCleanupRef.current = abort;
          }
        }
      }
    };
    poll();
    const id = setInterval(poll, 500);
    return () => clearInterval(id);
  }, [currentSource, isYouTube, isSoundCloud, isHtmlAudio, isYouTubeMix, isYouTubeMultiTrack, getNextStreamUrl, getNextEmbeddedSource, deviceCtx?.isBranchConnected, deviceCtx?.deviceMode, updatePositionIfChanged, updateDurationIfChanged, updateBufferedIfChanged, reportRecoveryProgress, getDeckAudio, getStandbyDeck, swapActiveDeck, deckTransitionLock, guardedYtPlay, markYtEngineConfirmed]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !isHtmlAudio) return;
    const onEnded = () => {
      const d = lastKnownDurationRef.current;
      if (!Number.isFinite(d) || d <= 0) return;
      if (endedHandledRef.current || crossfadeStartedRef.current) {
        xfadeLog("ended_skipped", { endedHandled: endedHandledRef.current, crossfadeStarted: crossfadeStartedRef.current });
        console.log("[SyncBiz Audit] Audio ended_skipped", {
          duration: d,
          endedHandled: endedHandledRef.current,
          crossfadeStarted: crossfadeStartedRef.current,
          url: currentPlayUrl,
        });
        return;
      }
      xfadeLog("ended_advance");
      console.log("[SyncBiz Audit] Audio ended_advance", {
        duration: d,
        url: currentPlayUrl,
      });
      endedHandledRef.current = true;
      syncbizAuditTransportTransitionStart({
        phase: "html_audio_element_ended_before_provider_next",
        auditTransportCase: "ended_auto",
        urlPreview: currentPlayUrl?.slice(0, 120) ?? null,
      });
      nextRef.current({ auditTransportCase: "ended_auto" });
    };
    audio.addEventListener("ended", onEnded);
    return () => audio.removeEventListener("ended", onEnded);
  }, [isHtmlAudio]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !isHtmlAudio) return;
    const onPause = () => {
      if (statusRef.current !== "playing") return;
      if (audio.ended) return;
      playbackLifecycleLog("audio_unexpected_pause", {
        currentTime: audio.currentTime,
        readyState: audio.readyState,
      });
      if (deviceCtx?.deviceMode === "MASTER") {
        masterPlaybackDiag("media pause (unexpected)", {
          currentTime: audio.currentTime,
          readyState: audio.readyState,
          paused: audio.paused,
        });
      }
    };
    audio.addEventListener("pause", onPause);
    return () => audio.removeEventListener("pause", onPause);
  }, [isHtmlAudio, currentPlayUrl, deviceCtx?.deviceMode]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !isHtmlAudio || deviceCtx?.deviceMode !== "MASTER") return;
    const logMedia = (event: string, extra?: Record<string, unknown>) => {
      masterPlaybackDiag(`media ${event}`, {
        currentTime: audio.currentTime,
        duration: audio.duration,
        paused: audio.paused,
        readyState: audio.readyState,
        ...extra,
      });
    };
    const onPlay = () => logMedia("play");
    const onPlaying = () => logMedia("playing");
    const onWaiting = () => logMedia("waiting");
    const onStalled = () => logMedia("stalled");
    const onError = () => logMedia("error");
    const onTimeUpdate = () => {
      if (process.env.NODE_ENV !== "development") return;
      const t = audio.currentTime;
      if (!Number.isFinite(t)) return;
      const last = (audio as HTMLAudioElement & { __sbLastDiagT?: number }).__sbLastDiagT ?? -1;
      if (Math.abs(t - last) < 0.45) return;
      (audio as HTMLAudioElement & { __sbLastDiagT?: number }).__sbLastDiagT = t;
      logMedia("timeupdate");
    };
    audio.addEventListener("play", onPlay);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("stalled", onStalled);
    audio.addEventListener("error", onError);
    audio.addEventListener("timeupdate", onTimeUpdate);
    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("stalled", onStalled);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("timeupdate", onTimeUpdate);
    };
  }, [isHtmlAudio, currentPlayUrl, deviceCtx?.deviceMode]);

  // ── Desktop mode: route web UI playback through MPV Channel A ──────────────
  // Chromium audio is muted at the Electron level (setAudioMuted). These effects
  // mirror every play/pause/stop/URL change to the Orchestrator → MPV Ch-A.

  useEffect(() => {
    if (typeof window === "undefined" || !("syncbizDesktop" in window)) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const desktop = (window as any).syncbizDesktop;
    const sync = () => {
      if (typeof desktop.setMixDuration === "function") {
        void desktop.setMixDuration(getMixDuration());
      }
    };
    sync();
    return onMixDurationChanged(sync);
  }, []);

  // Desktop MPV: advance at mix point (duration − mixSec) so crossfade overlaps like browser A/B decks.
  useEffect(() => {
    if (typeof window === "undefined" || !("syncbizDesktop" in window)) return;
    if (!desktopMpvSnap || status !== "playing" || !getAutoMix()) return;
    if (!currentPlayUrl || isHlsUrl(currentPlayUrl)) return;

    const pos = desktopMpvSnap.position;
    const dur = desktopMpvSnap.duration;
    if (!Number.isFinite(pos) || !Number.isFinite(dur) || dur <= 0) return;

    const nextUrl = getNextStreamUrl();
    if (!nextUrl || isHlsUrl(nextUrl)) return;

    const mixSec = getMixDuration();
    const mixAt = mixPointThresholdSec(dur, mixSec);
    if (pos < mixAt || mpvDesktopMixStartedRef.current) return;

    mpvDesktopMixStartedRef.current = true;
    p0XfadeDebug("desktop_mpv_natural_mix_advance", {
      pos,
      dur,
      mixSec,
      mixAt,
      nextUrl: nextUrl.slice(0, 80),
    });
    nextRef.current({ skipPlay: true, auditTransportCase: "ended_auto" });
  }, [desktopMpvSnap, status, currentPlayUrl, getNextStreamUrl]);

  const mpvLastUrlRef = useRef<string | null>(null);
  // Tracks Ch-A MPV status from onStatus broadcasts (no re-render — refs only).
  const mpvChAStatusRef = useRef<string>("idle");
  const mpvRecoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Desktop MPV "playing but frozen" self-heal bookkeeping (see watchdog effect).
  const mpvFrozenForUrlRef = useRef<string | null>(null);
  const mpvFrozenAttemptsRef = useRef(0);
  const mpvFrozenSkippedForUrlRef = useRef<string | null>(null);
  const mpvRecoveredReportedForUrlRef = useRef<string | null>(null);
  // Real wall-clock of the last actual dispatch to MPV (routing effect OR
  // self-heal re-send). Surfaced in the diagnostic so re-sends of the same URL
  // are visible (the URL string itself doesn't change on a re-dispatch).
  const mpvLastDispatchAtRef = useRef<number>(0);
  // Latest identity/context for owner telemetry — refreshed each render so the
  // watchdog interval (which closes over stale values) reports accurate tags.
  const playerTelemetryRef = useRef<{ deviceId: string | null; deviceMode: string | null; platform: string }>(
    { deviceId: null, deviceMode: null, platform: "browser" },
  );
  playerTelemetryRef.current = {
    deviceId: deviceCtx?.deviceId ?? null,
    deviceMode: deviceCtx?.deviceMode ?? null,
    platform: isDesktopMode ? "desktop" : "browser",
  };
  /**
   * Coalesce rapid `currentPlayUrl` changes during startup/restore/adoption into
   * a SINGLE MPV `loadfile`. On cold launch multiple React effects (persistence
   * restore, URL-driven page load, WS master-state adoption, playlist hydration)
   * can each commit a different `currentSource` within the first ~1s, which
   * previously caused MPV to walk through each URL in turn before settling.
   * We debounce the actual `mpvPlayUrl(...)` dispatch by a short idle window so
   * that only the final URL is ever loaded — imperceptible during normal use
   * (user-initiated plays see a ~200ms delay at most) but decisive at startup.
   */
  const mpvPendingUrlRef = useRef<string | null>(null);
  const mpvCoalesceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mpvDesktopMixStartedRef = useRef(false);
  // Fires 4 s after mpvPlayUrl() is dispatched. If MPV hasn't confirmed "playing" by
  // then, the fake-PLAYING UI is reset and the error is surfaced to the user.
  const mpvStallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const MPV_LOADFILE_COALESCE_MS = 250;

  // Subscribe to desktop status once. When Ch-A unexpectedly goes idle while
  // the web player is still "playing" (test panel hijacked Ch-A), schedule a
  // 1.5 s reload of the library URL. If Ch-A recovers on its own (loadfile replace
  // transition) within that window, the timer is cancelled.
  useEffect(() => {
    if (typeof window === "undefined" || !("syncbizDesktop" in window)) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const desktop = (window as any).syncbizDesktop;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const unsub = desktop.onStatus((s: any) => {
      const prev = mpvChAStatusRef.current;
      const next: string = s.mockPlaybackStatus ?? "idle";
      mpvChAStatusRef.current = next;

      if (prev !== "idle" && next === "idle" &&
          statusRef.current === "playing" && currentPlayUrlRef.current) {
        // Ch-A just went idle while web player is still playing.
        //
        // For local-file URLs (multi-track folder drops, saved local playlists), this is the
        // natural end of the clip — the only reliable end-of-track signal we get through MPV
        // for this transport. Advance via the provider so NEXT logic, the live queue
        // highlightIndex, and the rotating-art track all stay in sync. If the provider chose
        // a same-URL restart (single-track session), force a fresh loadfile so the file
        // replays from 0 (PLAY alone won't restart an idle MPV).
        //
        // For non-local URLs, the original heuristic still applies: a 1.5s reload guards
        // against the test panel hijack briefly stealing Ch-A. (Streams/YouTube have their
        // own ENDED handlers earlier in this file.)
        const cur = currentPlayUrlRef.current;
        if (mpvRecoverTimerRef.current) clearTimeout(mpvRecoverTimerRef.current);
        mpvRecoverTimerRef.current = null;

        if (isValidLocalFilePlaybackPath(cur)) {
          const urlBeforeNext = cur;
          try {
            nextRef.current({ auditTransportCase: "ended_auto" });
          } catch (err) {
            console.warn("[SyncBiz:mpv-natural-end] next() threw", err);
          }
          // Single-track session restart guard: if next() kept the same URL,
          // routing effect won't re-fire — push a fresh loadfile here.
          mpvRecoverTimerRef.current = setTimeout(() => {
            mpvRecoverTimerRef.current = null;
            if (statusRef.current === "playing" &&
                currentPlayUrlRef.current &&
                currentPlayUrlRef.current === urlBeforeNext &&
                mpvChAStatusRef.current === "idle") {
              mpvLastUrlRef.current = null;
              void desktop.mpvPlayUrl(currentPlayUrlRef.current);
            }
          }, 80);
        } else {
          mpvRecoverTimerRef.current = setTimeout(() => {
            mpvRecoverTimerRef.current = null;
            // Re-check: still playing, still idle (didn't recover on its own via replace)
            if (statusRef.current === "playing" &&
                currentPlayUrlRef.current &&
                mpvChAStatusRef.current === "idle") {
              mpvLastUrlRef.current = null; // force routing effect to treat as new
              void desktop.mpvPlayUrl(currentPlayUrlRef.current);
            }
          }, 1500);
        }
      } else if (next !== "idle" && mpvRecoverTimerRef.current) {
        // Ch-A is active again — loadfile replace transition settled; cancel reload
        clearTimeout(mpvRecoverTimerRef.current);
        mpvRecoverTimerRef.current = null;
      }
    });
    return () => {
      if (typeof unsub === "function") unsub();
      if (mpvRecoverTimerRef.current) { clearTimeout(mpvRecoverTimerRef.current); mpvRecoverTimerRef.current = null; }
    };
  }, []); // mount-only — uses refs for all runtime values

  // Route play/pause/stop transport and new URLs to Ch-A.
  // Deps: only [status, currentPlayUrl] — extra deps cause spurious re-fires.
  useEffect(() => {
    if (typeof window === "undefined" || !("syncbizDesktop" in window)) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const desktop = (window as any).syncbizDesktop;

    const cancelPendingLoadfile = () => {
      if (mpvCoalesceTimerRef.current) {
        clearTimeout(mpvCoalesceTimerRef.current);
        mpvCoalesceTimerRef.current = null;
      }
      mpvPendingUrlRef.current = null;
    };

    if (status === "playing" && currentPlayUrl) {
      if (currentPlayUrl !== mpvLastUrlRef.current) {
        // New URL — schedule/refresh a debounced loadfile. Any further URL
        // change within the coalesce window cancels and reschedules, so only
        // the FINAL currentPlayUrl in a burst actually reaches MPV.
        mpvPendingUrlRef.current = currentPlayUrl;
        if (mpvCoalesceTimerRef.current) clearTimeout(mpvCoalesceTimerRef.current);
        mpvCoalesceTimerRef.current = setTimeout(() => {
          mpvCoalesceTimerRef.current = null;
          const latest = mpvPendingUrlRef.current;
          mpvPendingUrlRef.current = null;
          if (!latest) return;
          // Re-validate at timer fire: still playing, still same latest URL,
          // and not already loaded.
          if (statusRef.current !== "playing") return;
          if (currentPlayUrlRef.current !== latest) return;
          if (latest === mpvLastUrlRef.current) return;
          const prevMpv = mpvLastUrlRef.current;
          mpvLastUrlRef.current = latest;
          const fadeSec = getMixDuration();
          const mpvPlaying = mpvChAStatusRef.current === "playing";
          const intentPlaying = statusRef.current === "playing";
          const useCrossfade = !!(prevMpv && desktop.mpvPlayUrlCrossfade && (mpvPlaying || intentPlaying));
          p0XfadeDebug("desktop_mpv_url_dispatch", {
            latest: latest.slice(0, 120),
            prevMpv: prevMpv?.slice(0, 120) ?? null,
            fadeSec,
            mpvPlaying,
            intentPlaying,
            useCrossfade,
          });
          if (useCrossfade) {
            void desktop.mpvPlayUrlCrossfade(latest, fadeSec);
          } else {
            void desktop.mpvPlayUrl(latest);
          }
          mpvLastDispatchAtRef.current = Date.now();

          // Stall detection: if Ch-A hasn't reported "playing" within 4 s, the file
          // or engine has a problem. Reset the fake-playing state and surface the error.
          if (mpvStallTimerRef.current) clearTimeout(mpvStallTimerRef.current);
          mpvStallTimerRef.current = setTimeout(() => {
            mpvStallTimerRef.current = null;
            if (
              statusRef.current === "playing" &&
              currentPlayUrlRef.current === latest &&
              mpvChAStatusRef.current !== "playing"
            ) {
              const snap = desktopMpvSnapRef.current;
              const engineOk = snap?.engineReady !== false;
              const errDetail = snap?.lastError ?? null;
              const userMsg = !engineOk
                ? (errDetail ?? "MPV player is not ready — check the desktop installation")
                : (errDetail ?? "Desktop playback did not start — file may be missing or in an unsupported format");
              console.warn("[SyncBiz Audit] Desktop MPV stall — no playing confirmation after 4 s", {
                url: latest.slice(0, 100),
                mpvChAStatus: mpvChAStatusRef.current,
                engineReady: snap?.engineReady ?? null,
                lastError: errDetail,
              });
              setLastMessage(userMsg);
              stop();
            }
          }, 4000);
        }, MPV_LOADFILE_COALESCE_MS);
      } else {
        // Same URL, resumed after pause — don't restart.
        cancelPendingLoadfile();
        if (mpvStallTimerRef.current) { clearTimeout(mpvStallTimerRef.current); mpvStallTimerRef.current = null; }
        void desktop.localMockTransport({ command: "PLAY" });
      }
    } else if (status === "paused") {
      cancelPendingLoadfile();
      if (mpvStallTimerRef.current) { clearTimeout(mpvStallTimerRef.current); mpvStallTimerRef.current = null; }
      void desktop.localMockTransport({ command: "PAUSE" });
    } else if (status === "stopped") {
      cancelPendingLoadfile();
      if (mpvStallTimerRef.current) { clearTimeout(mpvStallTimerRef.current); mpvStallTimerRef.current = null; }
      mpvLastUrlRef.current = null;
      void desktop.localMockTransport({ command: "STOP" });
    }
    return () => {
      if (mpvStallTimerRef.current) { clearTimeout(mpvStallTimerRef.current); mpvStallTimerRef.current = null; }
    };
  }, [status, currentPlayUrl, stop, setLastMessage]);

  // Sync volume slider → MPV master volume
  useEffect(() => {
    if (typeof window === "undefined" || !("syncbizDesktop" in window)) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    void (window as any).syncbizDesktop.localMockTransport({ command: "SET_VOLUME", volume });
  }, [volume]);
  // ── Desktop MPV self-heal: "playing but frozen" auto-recovery ──────────────
  // The engine can open a YouTube/network stream, report "playing", and know the
  // duration, yet never advance time-pos (a buffering/decode stall). The 4s stall
  // guard misses this because the channel status IS "playing". Left alone the
  // track can hang for minutes; a manual refresh (which re-issues loadfile) fixes
  // it. A business player must NEVER freeze on a paying customer, so this watchdog
  // automates that recovery: on a confirmed multi-second freeze it re-dispatches
  // the same URL (identical to what a refresh does), up to a few times, then skips
  // forward to keep the music alive. Additive + desktop-only; it fires ONLY after
  // a real freeze and never stops playback.
  useEffect(() => {
    if (typeof window === "undefined" || !("syncbizDesktop" in window)) return;
    if (!isDesktopMode) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const desktop = (window as any).syncbizDesktop;
    const FREEZE_MS = 6000; // no time-pos advance for 6s while MPV claims "playing"
    const MAX_REDISPATCH = 3; // re-loadfile this many times before skipping forward
    const id = setInterval(() => {
      if (statusRef.current !== "playing") return; // we must intend to play
      const snap = desktopMpvSnapRef.current;
      if (!snap || snap.status !== "playing") return; // MPV must claim it's playing
      // NOTE: intentionally do NOT require duration>0. A stuck YouTube resolve
      // sits at duration:0 / pos:0 while MPV still reports "playing" (seen in the
      // field). Keying only on "position not advancing" covers BOTH that and the
      // duration-known freeze. A healthy live stream (duration 0) still advances
      // its position, so it is never mistaken for frozen.
      if (!(desktopSnapPositionAtRef.current > 0)) return; // have a real position clock
      const url = currentPlayUrlRef.current;
      if (!url) return;
      const frozenMs = Date.now() - desktopSnapPositionAtRef.current;
      const ctx = playerTelemetryRef.current;
      // Fire-and-forget owner telemetry — never blocks/throws (see the client lib).
      const tele = (kind: Parameters<typeof reportPlaybackIncident>[0]["kind"], extra: Record<string, unknown>) =>
        reportPlaybackIncident({
          kind,
          deviceId: ctx.deviceId,
          deviceMode: ctx.deviceMode,
          platform: ctx.platform,
          sourceType: classifySource(url),
          urlHost: hostOnly(url),
          mpvStatus: snap.status,
          engineReady: snap.engineReady,
          ...extra,
        });

      if (frozenMs < FREEZE_MS) {
        // Healthy again → if we intervened on this track, report a one-time recovery.
        if (
          mpvFrozenForUrlRef.current === url &&
          mpvFrozenAttemptsRef.current > 0 &&
          mpvRecoveredReportedForUrlRef.current !== url
        ) {
          mpvRecoveredReportedForUrlRef.current = url;
          tele("recovered", { recovered: true, attempt: mpvFrozenAttemptsRef.current });
        }
        return; // position advanced recently → healthy
      }

      // New track resets the recovery budget + recovery-report guard.
      if (mpvFrozenForUrlRef.current !== url) {
        mpvFrozenForUrlRef.current = url;
        mpvFrozenAttemptsRef.current = 0;
        mpvRecoveredReportedForUrlRef.current = null;
      }

      if (mpvFrozenAttemptsRef.current < MAX_REDISPATCH) {
        mpvFrozenAttemptsRef.current += 1;
        console.warn("[SyncBiz] desktop MPV frozen (playing, no progress) — self-heal re-dispatch", {
          attempt: mpvFrozenAttemptsRef.current,
          frozenMs,
          pos: snap.position,
          dur: snap.duration,
          url: url.slice(0, 100),
        });
        // First detection = the freeze itself; later kicks = re-dispatch attempts.
        tele(mpvFrozenAttemptsRef.current === 1 ? "freeze" : "self_heal_redispatch", {
          attempt: mpvFrozenAttemptsRef.current,
          frozenMs,
        });
        mpvLastUrlRef.current = url; // keep the routing effect in sync
        mpvLastDispatchAtRef.current = Date.now(); // record the actual re-send
        desktopSnapPositionAtRef.current = Date.now(); // fresh window for this retry
        void desktop.mpvPlayUrl(url); // force a fresh loadfile (== manual refresh)
        return;
      }

      // Still frozen after every re-dispatch → keep the music going: skip forward
      // once for this stuck track.
      if (mpvFrozenSkippedForUrlRef.current !== url) {
        mpvFrozenSkippedForUrlRef.current = url;
        console.warn("[SyncBiz] desktop MPV still frozen after retries — skipping forward to keep playback alive", {
          url: url.slice(0, 100),
        });
        tele("skip_recover", { recovered: false, attempt: mpvFrozenAttemptsRef.current, frozenMs });
        desktopSnapPositionAtRef.current = Date.now();
        nextRef.current?.({ auditTransportCase: "ended_auto" });
      }
    }, 1000);
    return () => clearInterval(id);
  }, [isDesktopMode]);

  // ── End desktop routing ───────────────────────────────────────────────────

  /** Unified display values: desktop MPV > CONTROL mirror > local React state. */
  const ms = deviceCtx?.masterState;
  // isDesktopMode is declared earlier (near the desktopMpvSnap state) to avoid TDZ errors
  // in effects that reference it in their dependency arrays before this line in the file.

  // Desktop: tick between onStatus pushes so the timeline advances smoothly.
  const [, setDesktopProgressTick] = useState(0);
  useEffect(() => {
    if (!isDesktopMode || desktopMpvSnap?.status !== "playing") return;
    const id = setInterval(() => setDesktopProgressTick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [isDesktopMode, desktopMpvSnap?.status]);

  const desktopStalePlayingZero =
    isDesktopMode &&
    desktopMpvSnap.status === "playing" &&
    desktopMpvSnap.duration > 0 &&
    desktopMpvSnap.position <= 0 &&
    desktopSnapPositionAtRef.current > 0 &&
    Date.now() - desktopSnapPositionAtRef.current > 1000;

  /** Browser YouTube: provider intent is playing but IFrame API has not confirmed yet. */
  const isYtAwaitingEngine =
    !isDesktopMode &&
    !isControlMirror &&
    isYouTube &&
    status === "playing" &&
    !ytEngineConfirmed;

  /** Player-deck URL drop: parse/resolve/create in flight before playSource. */
  const isUrlPreparing =
    !isDesktopMode && !isControlMirror && urlPrepareActive;

  const displayStatus = isDesktopMode
    ? (desktopStalePlayingZero ? "paused" : desktopMpvSnap.status)
    : isControlMirror
      ? (ms?.status ?? "idle")
      : isYtAwaitingEngine
        ? "idle"
        : status;
  const displayTrack = isControlMirror ? ms?.currentTrack : currentTrack;
  const displaySource = isControlMirror ? ms?.currentSource : currentSource;

  // CONTROL mirror: tick every 250 ms so the progress bar advances smoothly
  // between STATE_UPDATE snapshots (which arrive ~1s from Desktop / ~1s from browser MASTER).
  // The tick only runs when in CONTROL mirror mode and MASTER is playing.
  const [, setControlMirrorTick] = useState(0);
  useEffect(() => {
    if (!isControlMirror || ms?.status !== "playing") return;
    const id = setInterval(() => setControlMirrorTick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [isControlMirror, ms?.status]);

  // CONTROL mirror: the state snapshot carries no play URL, so recover the
  // YouTube video id for the display-only video dock. Prefer an explicit
  // session URL if present, else pull it from the YouTube thumbnail cover
  // (i.ytimg.com/vi/<id>/…). Returns null for non-YouTube tracks → no dock.
  const mirrorVid = isControlMirror
    ? (() => {
        const idx = typeof ms?.currentTrackIndex === "number" ? ms.currentTrackIndex : -1;
        const sessUrl = idx >= 0 ? ms?.sessionTracks?.[idx]?.url : undefined;
        if (sessUrl && getEmbedType(sessUrl) === "youtube") {
          const fromUrl = getYouTubeVideoId(sessUrl);
          if (fromUrl) return fromUrl;
        }
        const cover = ms?.currentTrack?.cover ?? ms?.currentSource?.cover ?? "";
        const m = cover.match(/\/vi(?:_webp)?\/([A-Za-z0-9_-]{6,})\//);
        return m ? m[1] : null;
      })()
    : null;

  // Interpolate CONTROL position between STATE_UPDATE snapshots using positionAt timestamp.
  const displayPosition = isDesktopMode
    ? (() => {
        const pos = desktopMpvSnap.position;
        const dur = desktopMpvSnap.duration;
        if (desktopMpvSnap.status !== "playing" || !Number.isFinite(pos)) return pos;
        if (!Number.isFinite(dur) || dur <= 0) return pos;
        const at = desktopSnapPositionAtRef.current;
        if (!at) return pos;
        const ageMs = Date.now() - at;
        if (ageMs > 1200) return pos;
        return Math.min(pos + ageMs / 1000, dur);
      })()
    : isControlMirror
      ? (() => {
          const pos = ms?.position;
          const at = ms?.positionAt;
          if (typeof pos !== "number" || !Number.isFinite(pos)) return Number.NaN;
          if (ms?.status !== "playing" || typeof at !== "number" || !Number.isFinite(at)) return pos;
          const dur = typeof ms?.duration === "number" && Number.isFinite(ms.duration) ? ms.duration : Infinity;
          const ageMs = Date.now() - at;
          if (ageMs > 1200) return pos;
          return Math.min(pos + ageMs / 1000, dur);
        })()
      : position;
  const displayDuration = isDesktopMode
    ? desktopMpvSnap.duration
    : isControlMirror
      ? (typeof ms?.duration === "number" && Number.isFinite(ms.duration) ? ms.duration : Number.NaN)
      : duration;
  const displayVolume = isDesktopMode
    ? desktopMpvSnap.volume
    : isControlMirror
      ? (typeof ms?.volume === "number" && Number.isFinite(ms.volume) ? ms.volume : 80)
      : volume;
  const displayShuffle =
    isControlMirror ? (typeof ms?.shuffle === "boolean" ? ms?.shuffle : shuffle) : shuffle;
  const displayAutoMix =
    isControlMirror ? (typeof ms?.autoMix === "boolean" ? ms?.autoMix : autoMix) : autoMix;
  const displayThumbnailCover = (() => {
    if (!isControlMirror && ytMultiTrackState?.currentThumbnail) return ytMultiTrackState.currentThumbnail;
    if (isControlMirror) {
      return ms?.currentTrack?.cover ?? ms?.currentSource?.cover ?? null;
    }
    const pl =
      currentSource != null ? effectivePlaybackPlaylistAttachment(currentSource) ?? currentPlaylist : null;
    return resolvePlaybackHeroCoverArt({
      trackCover: currentTrack?.cover,
      trackUrl: currentTrack?.url,
      trackType: currentTrack?.type,
      sourceCover: currentSource?.cover,
      sourceUrl: currentSource?.url,
      playlist: pl,
    });
  })();
  const displayTitle = isControlMirror
    ? (ms?.currentTrack?.title ?? ms?.currentSource?.title ?? t.noSourceSelected)
    : (ytMultiTrackState?.currentTitle ?? currentTrack?.title ?? t.noSourceSelected);

  /**
   * Now Playing chips (Source / Genre / Mood) — resolved against the underlying
   * `PlaylistTrack` so we get the per-track ID3/catalog taxonomy the AI builder
   * recorded, not just the playlist-level vibe. In CONTROL-mirror mode we have
   * no access to the underlying track list, so we fall back to the parent
   * playlist taxonomy (still better than no chip).
   */
  const playerHeroPlaylist = useMemo(() => {
    if (isControlMirror) return null;
    if (currentSource) {
      const attached = effectivePlaybackPlaylistAttachment(currentSource);
      if (attached) return attached;
    }
    return currentPlaylist ?? null;
  }, [isControlMirror, currentSource, currentPlaylist]);
  const playerHeroTrack = useMemo(() => {
    if (isControlMirror) return null;
    const pl = playerHeroPlaylist;
    if (!pl) return null;
    const trackId = currentTrack?.id;
    if (!trackId) return null;
    return getPlaylistTracks(pl).find((x) => x.id === trackId) ?? null;
  }, [isControlMirror, playerHeroPlaylist, currentTrack?.id]);
  const playerHeroTrackMetaCache = useMemo(
    () => (playerHeroPlaylist ? getCachedAiPlaylistTracksMeta(playerHeroPlaylist.id) : {}),
    [playerHeroPlaylist],
  );
  /*
   * NEXT TRACK label resolution. Old logic walked currentPlaylist -> queue and was wrong in
   * two common cases the operator hit on stage:
   *   1) Play Next item playing -> currentPlaylist is null, so we fell to queue[i+1]?.title
   *      which is the *playlist source* title (e.g. "Afro SET"), not the actual next track.
   *   2) currentPlaylist null but currentSource has a playlist attachment (the routine session
   *      shape after the provider promotes a leaf source) — same fallthrough, same wrong label.
   * New logic, in priority order:
   *   a) ytMultiTrackState.nextTitle (YouTube mix preview, unchanged)
   *   b) Play Next active: first staged item's title; if queue empty but baseline exists, peek
   *      the baseline session's next track via the attached playlist.
   *   c) Effective attachment of currentSource (covers leaf sources that point back to a saved
   *      playlist) — next track relative to currentTrackIndex.
   *   d) currentPlaylist next track.
   *   e) Stop. Do NOT fall back to queue[i+1]?.title — that's the playlist name, never the
   *      next track, and that fallback is what the operator was reading as wrong.
   */
  const displayNextLabel = isControlMirror
    ? (ms?.nextSessionTrack?.title ??
      (() => {
        const rows = ms?.sessionTracks;
        if (!rows?.length) return null;
        const idx = typeof ms?.currentTrackIndex === "number" ? ms.currentTrackIndex : 0;
        const nextIdx = rows.length === 1 ? 0 : idx < rows.length - 1 ? idx + 1 : 0;
        return rows[nextIdx]?.title ?? null;
      })())
    : (() => {
        if (ytMultiTrackState?.nextTitle) return ytMultiTrackState.nextTitle;

        const isPlayNextActive = isPlayNextSourceId(currentSource?.id);
        if (isPlayNextActive) {
          const firstStaged = (playNextQueue ?? [])[0];
          if (firstStaged?.title) return firstStaged.title;
          if (playNextBaseline?.currentSource) {
            const baselinePl = effectivePlaybackPlaylistAttachment(playNextBaseline.currentSource);
            if (baselinePl) {
              const baseTracks = getPlaylistTracks(baselinePl);
              const baseIdx = playNextBaseline.currentTrackIndex ?? 0;
              const baseNextIdx = baseIdx + 1 < baseTracks.length ? baseIdx + 1 : 0;
              const baseNext = baseTracks[baseNextIdx];
              if (baseNext?.name) return baseNext.name;
            }
          }
          return null;
        }

        const effectivePl =
          (currentSource ? effectivePlaybackPlaylistAttachment(currentSource) : null) ??
          currentPlaylist;
        if (effectivePl) {
          const tracks = getPlaylistTracks(effectivePl);
          if (tracks.length > 1) {
            const idx = currentTrackIndex < tracks.length - 1 ? currentTrackIndex + 1 : 0;
            const t = tracks[idx];
            if (t?.name) return t.name;
          }
        }
        return null;
      })();
  const displayHasContent = isControlMirror ? !!(ms?.currentSource || ms?.currentTrack) : !!currentSource;
  // ─── Diagnostic: log displayHasContent + masterState changes ────────────
  useEffect(() => {
    console.warn("[SyncBiz DIAG] AudioPlayer displayHasContent →", displayHasContent, {
      isControlMirror,
      currentSource: currentSource?.id ?? null,
      masterHasSource: ms ? !!(ms.currentSource || ms.currentTrack) : null,
      masterStatus: ms?.status ?? null,
      ts: new Date().toISOString(),
    });
  }, [displayHasContent]); // eslint-disable-line react-hooks/exhaustive-deps
  // ────────────────────────────────────────────────────────────────────────
  // Live Play Next staged items (and the post-play baseline-resume) need to keep the Next/Prev
  // transport active even when the operator dropped a one-off track that has no queue or
  // playlist of its own. Without this the Next button goes dead the moment a Play Next item
  // becomes the current source.
  const hasStagedPlayNext = (playNextQueue?.length ?? 0) > 0 || !!playNextBaseline;
  const displayHasPrevNext = isDesktopMode
    // Desktop: catalog navigation — enabled when library has > 1 item, OR local playlist/queue also covers the case
    ? (desktopMpvSnap.catalogCount > 1 || (currentSource && queue.length > 1) || !!(currentSource?.playlist && (currentSource.playlist.tracks?.length ?? 0) > 1) || hasStagedPlayNext)
    : isControlMirror
      ? ((ms?.sessionTracks?.length ?? 0) > 1 || (ms?.queue?.length ?? 0) > 1)
      : (currentSource && queue.length > 1) || (currentSource?.playlist && (currentSource.playlist.tracks?.length ?? 0) > 1) || hasStagedPlayNext;
  const displayCanSeek = isDesktopMode
    // Desktop: MPV reports duration when a file is loaded — that is the only condition needed.
    ? displayDuration > 0
    : isControlMirror
      ? (displayDuration > 0)
      : (!!currentSource &&
          ((isYouTube && isYtPlayerReady(getYtActivePlayer())) ||
            (!!scWidgetRef.current && isSoundCloud) ||
            (isHtmlAudio && Number.isFinite(duration) && duration > 0)));
  const displayBufferedPercent = isControlMirror ? 0 : bufferedPercent;
  const displayProgressPercent =
    Number.isFinite(displayPosition) &&
    Number.isFinite(displayDuration) &&
    displayDuration > 0
      ? Math.min(100, (displayPosition / displayDuration) * 100)
      : 0;

  const displayStatusLabel =
    isUrlPreparing
      ? "Preparing URL"
      : isYtAwaitingEngine
        ? "Loading"
        : displayStatus === "playing"
          ? t.playing
          : displayStatus === "paused"
            ? t.paused
            : displayStatus === "stopped"
              ? t.stopped
              : t.idle;

  const trackTypeForTooltip = (displayTrack as PlaybackTrack | undefined)?.type;
  const originForTooltip = (displaySource as typeof currentSource | null | undefined)?.origin;
  const sourceIconTitle = !displaySource?.title
    ? t.providerLocal
    : isControlMirror
      ? t.providerRemote
      : originForTooltip === "radio"
        ? labels.radio[locale]
        : trackTypeForTooltip === "youtube"
          ? t.providerYouTube
          : trackTypeForTooltip === "soundcloud"
            ? t.providerSoundCloud
            : trackTypeForTooltip === "spotify"
              ? t.providerSpotify
              : t.providerLocal;

  const deckBadgeLabels = {
    youtube: t.deckBadgeYoutube,
    soundcloud: t.deckBadgeSoundcloud,
    radio: t.deckBadgeRadio,
    liveStream: t.deckBadgeLiveStream,
    syncbizPlaylist: t.deckBadgeSyncbizPlaylist,
    local: t.deckBadgeLocal,
    djCreatorPlaylist: t.deckBadgeDjCreator,
    readyPlaylist: t.deckBadgeReadyPlaylist,
    scheduledPlaylist: t.deckBadgeScheduledPlaylist,
    myPlaylist: t.deckBadgeMyPlaylist,
    branchPlaylist: t.deckBadgeBranchPlaylist,
  };

  const deckSourceBadgeLabel = isControlMirror
    ? labelForPlaylistOriginBadge(ms?.currentSource?.playlistOriginBadge, deckBadgeLabels) ?? t.deckBadgeRemote
    : resolveDeckSourceBadge(currentSource ?? undefined, currentTrack ?? undefined, deckBadgeLabels);

  // Desktop PREV/NEXT strategy:
  //  - Multi-track playlist or queued items → provider prev()/next() changes currentPlayUrl
  //    → routing effect fires → mpvPlayUrl(newUrl). This is the only correct path for
  //    within-playlist track navigation.
  //  - Single station with a populated catalog → catalog PREV/NEXT + PLAY via localMockTransport.
  const desktopSessionTrackCount = (() => {
    const pl =
      currentSource != null ? effectivePlaybackPlaylistAttachment(currentSource) ?? currentPlaylist : null;
    return pl ? getPlaylistTracks(pl).length : 0;
  })();
  const desktopHasProviderNav =
    isDesktopMode && (desktopSessionTrackCount > 1 || queue.length > 1);

  const onPrev = isDesktopMode
    ? () => {
        if (desktopHasProviderNav) {
          endedHandledRef.current = true;
          prev();
        } else {
          // Catalog navigation: PREV advances the station, PLAY loads the new URL into MPV.
          const desktop = (window as any).syncbizDesktop;
          void desktop.localMockTransport({ command: "PREV" }).then(() =>
            desktop.localMockTransport({ command: "PLAY" })
          );
        }
      }
    : isControlMirror
      ? () => {
          console.log("[SyncBiz Audit] PREV path resolved", {
            context: "remote_ui_control",
            deviceMode: deviceCtx?.deviceMode,
            isControlMirror,
            currentUrl: currentPlayUrl,
            trackType: currentTrack?.type,
            currentTrackIndex,
            intendedPrevIndex: currentTrackIndex - 1,
            queueIndex,
            queueLength: queue.length,
          });
          endedHandledRef.current = true;
          deviceCtx!.prevOrSend();
        }
      : () => {
          console.log("[SyncBiz Audit] PREV path resolved", {
            context: "local_ui",
            deviceMode: deviceCtx?.deviceMode,
            isControlMirror,
            currentUrl: currentPlayUrl,
            trackType: currentTrack?.type,
            currentTrackIndex,
            intendedPrevIndex: currentTrackIndex - 1,
            queueIndex,
            queueLength: queue.length,
          });
          endedHandledRef.current = true;
          prev();
        };
  const onNext = isDesktopMode
    ? () => {
        if (desktopHasProviderNav) {
          crossfadeAbortRef.current = true;
          crossfadeCleanupRef.current?.();
          ytCrossfadeAbortRef.current = true;
          ytCrossfadeCleanupRef.current?.();
          endedHandledRef.current = true;
          next();
        } else {
          // Catalog navigation: NEXT advances the station, PLAY loads the new URL into MPV.
          const desktop = (window as any).syncbizDesktop;
          void desktop.localMockTransport({ command: "NEXT" }).then(() =>
            desktop.localMockTransport({ command: "PLAY" })
          );
        }
      }
    : isControlMirror
      ? () => {
          console.log("[SyncBiz Audit] NEXT path resolved", {
            context: "remote_ui_control",
            deviceMode: deviceCtx?.deviceMode,
            isControlMirror,
            currentUrl: currentPlayUrl,
            trackType: currentTrack?.type,
            currentTrackIndex,
            intendedNextIndex: currentTrackIndex + 1,
            queueIndex,
            queueLength: queue.length,
          });
          crossfadeAbortRef.current = true;
          crossfadeCleanupRef.current?.();
          ytCrossfadeAbortRef.current = true;
          ytCrossfadeCleanupRef.current?.();
          endedHandledRef.current = true;
          deviceCtx!.nextOrSend();
        }
      : () => {
        console.log("[SyncBiz Audit] NEXT path resolved", {
          context: "local_ui",
          deviceMode: deviceCtx?.deviceMode,
          isControlMirror,
          currentUrl: currentPlayUrl,
          trackType: currentTrack?.type,
          currentTrackIndex,
          intendedNextIndex: currentTrackIndex + 1,
          queueIndex,
          queueLength: queue.length,
        });
        console.log("[SyncBiz Audit] runtime path step", {
          transport: "audio_player_manual_next",
          phase: "before_provider_next",
          auditTransportCase: null,
          currentPlayUrlSnapshot: currentPlayUrl?.slice(0, 200) ?? null,
          currentSourceId: currentSource?.id ?? null,
          currentTrackIndex,
          queueLength: queue.length,
        });
        crossfadeAbortRef.current = true;
        crossfadeCleanupRef.current?.();
        ytCrossfadeAbortRef.current = true;
        ytCrossfadeCleanupRef.current?.();
        endedHandledRef.current = true;
        syncbizAuditTransportTransitionStart({
          phase: "manual_ui_next_before_provider_next",
          caller: "audio_player_onNext",
          currentSourceId: currentSource?.id ?? null,
          queueIndex,
          queueLength: queue.length,
        });
        next();
      };
  const abortAllTransitions = useCallback(() => {
    crossfadeAbortRef.current = true;
    crossfadeCleanupRef.current?.();
    crossfadeCleanupRef.current = null;
    ytCrossfadeAbortRef.current = true;
    ytCrossfadeCleanupRef.current?.();
    ytCrossfadeCleanupRef.current = null;
    streamTransitionAbortRef.current?.();
    streamTransitionAbortRef.current = null;
    ytManualTransitionRef.current = false;
    ytSequentialActiveRef.current = false;
    ytNaturalSequentialStartedRef.current = false;
    scManualTransitionRef.current = false;
    deckTransitionLock.forceReset();
  }, [deckTransitionLock]);
  const onStop = isControlMirror
    ? () => {
        abortAllTransitions();
        deviceCtx!.stopOrSend();
      }
    : () => {
        abortAllTransitions();
        stop();
      };
  const onPlayPause = isControlMirror
    ? (displayStatus === "playing" ? deviceCtx!.pauseOrSend : deviceCtx!.playOrSend)
    : (status === "playing"
        ? () => {
            console.log("[SyncBiz Audit] PAUSE click", {
              context: "local_ui",
              status,
              currentSourceId: currentSource?.id ?? null,
            });
            pause();
          }
        : () => {
            console.log("[SyncBiz Audit] PLAY click", {
              context: "local_ui",
              status,
              currentSourceId: currentSource?.id ?? null,
              sourceOrigin: currentSource?.origin ?? null,
              // Direct URL on the source (covers ephemeral catalog-preview and DB source)
              sourceDirectUrl: currentSource?.url ?? null,
              // Track-level URL (only for playlist sources with loaded tracks)
              sourceTrackUrl: currentSource?.playlist?.tracks?.[0]?.url ?? null,
              hasPlaylistAttachment: !!currentSource?.playlist,
              catalogItemId: currentSource?.catalogItemId ?? null,
              isEphemeralCatalogPreview: currentSource?.id?.startsWith("catalog-preview-") ?? false,
              isBPath: !!(currentSource?.playlist?.id) || currentSource?.origin === "source",
            });
            if (status === "paused" && currentSource) play();
            else if (currentSource) playSource(currentSource);
            else console.warn("[SyncBiz Audit] PLAY blocked: no currentSource");
          });
  const onVolumeChange = isControlMirror ? deviceCtx!.setVolumeOrSend : setVolume;

  const canSeek =
    currentSource &&
    ((isYouTube && isYtPlayerReady(getYtActivePlayer())) ||
      (isSoundCloud && !!scWidgetRef.current) ||
      (isHtmlAudio && Number.isFinite(duration) && duration > 0));

  const seekTo = useCallback(
    (seconds: number) => {
      const sec = Math.max(0, seconds);
      if (isYouTube) {
        const p = getYtActivePlayer();
        if (isYtPlayerReady(p)) {
          safeSeekTo(p, sec, true);
          setPosition(sec);
        }
      } else if (isSoundCloud && scWidgetRef.current) {
        scWidgetRef.current.seekTo(sec * 1000);
        setPosition(sec);
      } else if (isHtmlAudio && audioRef.current) {
        audioRef.current.currentTime = sec;
        setPosition(sec);
      }
    },
    [isYouTube, isSoundCloud, isHtmlAudio]
  );

  const onSeekChange = useCallback(
    (pct: number) => {
      if (isDesktopMode) {
        if (displayDuration <= 0) return;
        void (window as any).syncbizDesktop.mpvSeekTo((pct / 100) * displayDuration);
      } else if (isControlMirror) {
        if (displayDuration <= 0) return;
        deviceCtx!.seekOrSend((pct / 100) * displayDuration);
      } else {
        if (!canSeek || duration <= 0) return;
        seekTo((pct / 100) * duration);
      }
    },
    [isDesktopMode, isControlMirror, deviceCtx, displayDuration, canSeek, duration, seekTo]
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

  const hoverTime =
    Number.isFinite(displayDuration) && displayDuration > 0
      ? (hoverPercent / 100) * displayDuration
      : 0;

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
      className={
        isSourcesLibraryDeck
          ? "audio-player-library-deck relative isolate flex h-full min-h-0 flex-col px-1.5 py-0.5 sm:px-2"
          : "sticky top-0 z-50 border-b border-slate-800/80 bg-slate-950/98 px-3 py-3 shadow-[0_4px_24px_rgba(0,0,0,0.4),0_0_0_1px_rgba(30,215,96,0.08)] overflow-hidden sm:px-4"
      }
      role="region"
      aria-label={t.playerControllerAria}
    >
      {isDesktopMode ? (
        <DesktopBackgroundModeToggle className="absolute right-2 top-2 z-[60]" />
      ) : null}
      {/* FRAMELESS deck (operator direction): no border, no hairlines, no colored
          strips — just the surface. The soft gradient stays (it dims the video bg). */}
      <div
        className={`player-hero-shell relative min-w-0 w-full flex-1 rounded-2xl px-2.5 py-2.5 sm:px-3.5 sm:py-3 ${
          displayStatus === "playing"
            ? "bg-gradient-to-b from-slate-800/38 to-slate-950/72"
            : "bg-gradient-to-b from-slate-900/32 to-slate-950/68"
        }`}
      >
      <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col">
        {/* Unified hero: vinyl · metadata + progress + transport · volume */}
        <div className="grid min-h-0 flex-1 grid-cols-[auto_minmax(0,1fr)_auto] items-stretch gap-3 sm:gap-4 lg:gap-5">
          <div className="flex shrink-0 items-center justify-center self-center">
            {/* Clean circle artwork — edge-to-edge cover, no vinyl ring/spin (operator direction). */}
            <div className="h-36 w-36 shrink-0 overflow-hidden rounded-full bg-[#101014] shadow-[0_10px_36px_-10px_rgba(0,0,0,0.7)] sm:h-40 sm:w-40">
              {displayThumbnailCover ? (
                <HydrationSafeImage src={displayThumbnailCover} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-[#3a3a3c]">
                  <svg className="h-10 w-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                    <path d="M9 18V5l12-2v13" />
                    <circle cx="6" cy="18" r="3" />
                    <circle cx="18" cy="16" r="3" />
                  </svg>
                </div>
              )}
            </div>
          </div>

          <div className="library-deck-controls-col flex min-h-0 min-w-0 w-full max-w-none flex-col justify-between gap-1.5 py-1 sm:gap-2">
            {(() => {
              const rawTitle = String(displayTitle ?? "");
              const titleSplit = rawTitle.match(/^(.+?)\s[–—-]\s(.+)$/);
              const heroArtist = titleSplit?.[1]?.trim() || null;
              const heroTitle = titleSplit?.[2]?.trim() || rawTitle;

              return (
                <div className="player-hero-metadata flex min-w-0 w-full flex-col gap-1.5 sm:gap-2">

                  {/* Eyebrow — fixed height slot */}
                  <div className="flex h-4 min-w-0 items-center gap-2">
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${displayStatus === "playing" ? "bg-cyan-400/70" : "bg-transparent"}`}
                      aria-hidden
                    />
                    <p
                      className={`shrink-0 text-[9px] font-medium uppercase tracking-[0.22em] ${
                        displayStatus === "playing"
                          ? isSourcesLibraryDeck ? "text-[color:var(--lib-accent)]" : "text-cyan-400/75"
                          : displayStatus === "paused"
                            ? "text-slate-500"
                            : "text-slate-600"
                      }`}
                      aria-label={displayStatusLabel}
                    >
                      {isUrlPreparing
                        ? "Preparing URL"
                        : isYtAwaitingEngine
                          ? "LOADING"
                          : displayStatus === "playing"
                            ? "NOW PLAYING"
                            : displayStatus === "paused"
                              ? "PAUSED"
                              : "READY"}
                    </p>
                  </div>

                  {/* Title — fixed min-height slot */}
                  <div ref={titleContainerRef} className="relative min-h-[2.75rem] min-w-0 w-full overflow-hidden lg:min-h-[2rem]">
                    <span ref={titleMeasureRef} className="invisible absolute whitespace-nowrap pointer-events-none" aria-hidden>
                      {heroTitle}
                    </span>
                    <p
                      className={`min-w-0 w-full line-clamp-2 lg:line-clamp-1 text-xl font-bold leading-[1.2] tracking-tight sm:text-2xl ${
                        isSourcesLibraryDeck ? "text-[color:var(--lib-text-primary)]" : "text-white"
                      } ${!displayHasContent ? "text-slate-500" : ""}`}
                      title={heroTitle}
                    >
                      {heroTitle}
                    </p>
                  </div>

                  <div className="player-hero-slot flex min-h-[1.25rem] min-w-0 flex-col justify-center">
                  {heroArtist ? (
                    <p
                      className={`min-w-0 truncate text-sm font-medium leading-snug sm:text-base ${
                        isSourcesLibraryDeck ? "text-[color:var(--lib-text-secondary)]" : "text-slate-300"
                      }`}
                      title={heroArtist}
                    >
                      {heroArtist}
                    </p>
                  ) : (
                    <span className="text-sm text-transparent select-none" aria-hidden>&nbsp;</span>
                  )}
                  </div>

                  <div className="player-hero-slot flex min-h-[1rem] min-w-0 flex-col justify-center">
                  {displaySource?.title ? (
                    <p
                      className={`min-w-0 truncate text-xs leading-snug sm:text-sm ${
                        isSourcesLibraryDeck ? "text-[color:var(--lib-text-muted)]" : "text-slate-500"
                      }`}
                      title={displaySource.title}
                    >
                      {displaySource.title}
                    </p>
                  ) : (
                    <span className="text-xs text-transparent select-none" aria-hidden>&nbsp;</span>
                  )}
                  </div>

                  <div className="player-hero-slot flex min-h-[1.25rem] min-w-0 items-baseline gap-2" title={displayNextLabel ? t.nextTrackColon : undefined}>
                    <span className={`shrink-0 text-[9px] font-medium uppercase tracking-[0.2em] ${isSourcesLibraryDeck ? "text-[color:var(--lib-text-muted)]" : "text-slate-600"}`} aria-hidden>
                      NEXT
                    </span>
                    <span
                      className={`min-w-0 flex-1 truncate text-xs leading-snug sm:text-sm ${
                        displayNextLabel
                          ? isSourcesLibraryDeck ? "text-[color:var(--lib-text-secondary)]" : "text-slate-400"
                          : "text-slate-600/50"
                      }`}
                      title={displayNextLabel ?? undefined}
                    >
                      {displayNextLabel ?? "—"}
                    </span>
                  </div>

                </div>
              );
            })()}

            {/* Progress — LCD time labels + precise hardware strip */}
            <div className="flex w-full min-w-0 shrink-0 items-center gap-3 sm:gap-4">
              <span
                className={`player-lcd-time w-14 shrink-0 text-right text-base font-semibold tabular-nums tracking-tight sm:w-16 sm:text-lg ${
                  isSourcesLibraryDeck ? "text-[color:var(--lib-text-secondary)]" : "text-slate-200"
                }`}
                aria-live="polite"
              >
                {formatTime(displayPosition)}
              </span>
            <div
              ref={timelineRef}
              role="slider"
              aria-label={t.trackProgressAria}
              aria-valuemin={0}
              aria-valuemax={Number.isFinite(displayDuration) ? displayDuration : 0}
              aria-valuenow={Number.isFinite(displayPosition) ? displayPosition : 0}
              aria-disabled={!displayCanSeek}
              tabIndex={displayCanSeek ? 0 : undefined}
              className={`relative flex flex-1 min-w-0 select-none py-2.5 ${displayCanSeek ? "cursor-pointer" : "cursor-default opacity-80"}`}
            onMouseMove={handleTimelineMouseMove}
            onMouseEnter={handleTimelineMouseEnter}
            onMouseLeave={handleTimelineMouseLeave}
            onMouseDown={handleSeekStart}
            onTouchStart={handleTouchStart}
          >
            <div
              className={`absolute inset-x-0 top-1/2 h-[5px] -translate-y-1/2 rounded-sm ${
                isSourcesLibraryDeck ? "bg-[color:var(--lib-border-muted)]/80" : "bg-[#1a1a1a]"
              }`}
            />
            {displayBufferedPercent > 0 && (
              <div
                className={`absolute left-0 top-1/2 h-[5px] -translate-y-1/2 rounded-sm transition-all duration-150 ${
                  isSourcesLibraryDeck ? "library-player-timeline-buffer" : "bg-neutral-700/50"
                }`}
                style={{ width: `${Math.min(displayBufferedPercent, 100)}%` }}
              />
            )}
            <div
              className={`absolute left-0 top-1/2 h-[5px] -translate-y-1/2 rounded-sm transition-all duration-100 ${
                isSourcesLibraryDeck ? "library-player-timeline-played" : "bg-gradient-to-r from-cyan-600/50 to-cyan-400/75"
              }`}
              style={{ width: `${displayProgressPercent}%` }}
            />
            <div
              className={`absolute top-1/2 h-3 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-sm transition-all duration-100 ${
                isSourcesLibraryDeck
                  ? "library-player-timeline-thumb bg-[color:var(--lib-accent)]"
                  : "bg-cyan-100/90"
              }`}
              style={{ left: `${Math.max(0, Math.min(100, displayProgressPercent))}%` }}
            />
            {isHoveringTimeline && displayDuration > 0 && (
              <div
                className="pointer-events-none absolute bottom-full z-10 mb-1 rounded-sm border border-white/10 bg-[#141414] px-2 py-0.5 text-xs font-mono tabular-nums text-slate-300"
                style={{ left: `${hoverPercent}%`, transform: "translate(-50%, -100%)" }}
              >
                {formatTime(hoverTime)}
              </div>
            )}
          </div>
              <span
                className={`player-lcd-time w-14 shrink-0 text-left text-base font-semibold tabular-nums tracking-tight sm:w-16 sm:text-lg ${
                  isSourcesLibraryDeck ? "text-[color:var(--lib-text-muted)]" : "text-slate-500"
                }`}
                aria-live="polite"
              >
                {formatTime(displayDuration)}
              </span>
            </div>

            {/* Transport — integrated dock at bottom of metadata column */}
            <div className="player-hero-transport-slot mt-auto shrink-0 pt-1">
            <PlayerDeckTransportSurface
              variant={isSourcesLibraryDeck ? "library-deck" : "default"}
              onPrev={() => {
                console.log("[SyncBiz Audit] PREV click", {
                  context: isControlMirror ? "remote_ui_control" : "local_ui",
                  deviceMode: deviceCtx?.deviceMode ?? null,
                  currentSourceId: currentSource?.id ?? null,
                  currentTrackIndex,
                  queueIndex,
                  queueLength: queue.length,
                });
                onPrev();
              }}
              onStop={onStop}
              onPlayPause={onPlayPause}
              onNext={() => {
                console.log("[SyncBiz Audit] NEXT click", {
                  context: isControlMirror ? "remote_ui_control" : "local_ui",
                  deviceMode: deviceCtx?.deviceMode ?? null,
                  currentSourceId: currentSource?.id ?? null,
                  currentTrackIndex,
                  queueIndex,
                  queueLength: queue.length,
                });
                onNext();
              }}
              prevNextDisabled={!displayHasPrevNext}
              contentDisabled={!displayHasContent}
              isPlaying={displayStatus === "playing"}
              onAutoMixToggle={() => {
                if (!isControlMirror) setAutoMix((a) => !a);
                else deviceCtx?.setAutoMixOrSend?.(!displayAutoMix);
              }}
              onShuffleToggle={() => {
                if (!isControlMirror) toggleShuffle();
                else deviceCtx?.setShuffleOrSend?.(!displayShuffle);
              }}
              displayAutoMix={displayAutoMix}
              displayShuffle={displayShuffle}
              displayVolume={displayVolume}
              onVolumeChange={onVolumeChange}
              onMuteToggle={() => {
                if (displayVolume > 0) {
                  volumeBeforeMuteRef.current = displayVolume;
                  onVolumeChange(0);
                } else {
                  onVolumeChange(volumeBeforeMuteRef.current);
                }
              }}
              onShareClick={() => setShareOpen(true)}
              shareDisabled={!displayHasContent || Boolean(isControlMirror)}
              editHref={
                displayHasContent
                  ? isControlMirror
                    ? (ms?.currentSource?.editHref ?? null)
                    : currentSource
                      ? editHrefForLibrarySource(currentSource)
                      : null
                  : null
              }
              onEditClick={
                !isControlMirror && displayHasContent && currentSource && isLibraryRoute
                  ? currentSource.origin === "playlist" && currentSource.playlist
                    ? () =>
                        setCenterModule({
                          kind: "edit-current",
                          target: { kind: "playlist", id: currentSource.playlist!.id },
                        })
                    : currentSource.origin === "source" && currentSource.source
                      ? () =>
                          setCenterModule({
                            kind: "edit-current",
                            target: { kind: "source", id: currentSource.source!.id },
                          })
                      : null
                  : null
              }
              labels={{
                previousTrack: t.previousTrack,
                stopPlayback: t.stopPlayback,
                play: t.play,
                pausePlayback: t.pausePlayback,
                next: t.next,
                autoMix: t.autoMix,
                random: t.random,
                unmute: t.unmute,
                mute: t.mute,
                volumeAria: t.volumeAria,
                share: t.share,
                edit: t.edit,
              }}
            />
            </div>
          </div>

          <div className="library-deck-volume-aside hidden h-full min-h-0 shrink-0 self-stretch sm:flex">
            <PlayerVerticalVolume
              value={displayVolume}
              onChange={onVolumeChange}
              isPlaying={displayStatus === "playing"}
              onMuteToggle={() => {
                if (displayVolume > 0) {
                  volumeBeforeMuteRef.current = displayVolume;
                  onVolumeChange(0);
                } else {
                  onVolumeChange(volumeBeforeMuteRef.current);
                }
              }}
              ariaLabel={t.volumeAria}
              muteLabel={displayVolume === 0 ? t.unmute : t.mute}
            />
          </div>
        </div>
      </div>
      </div>

      {/* Prewarm: hidden YT A/B decks stay mounted in browser MASTER so first URL skips container creation.
          When the video panel is open, THIS SAME wrapper docks bottom-right as a visible player —
          the iframes never remount, so audio is untouched. */}
      {canPrewarmYoutubeEmbed ? (() => {
        /* Video dock: fixed deck element — under the track text, before the
           volume column. No button: it simply IS there while YouTube plays,
           with the same bottom fade language as the library cards. */
        const videoDocked = isYouTube && (displayStatus === "playing" || displayStatus === "paused");
        /* NOTE: the YT API replaces these divs with the iframes — sizing/opacity
           for the iframes is applied directly in the videoActiveDeck poll effect
           (getIframe().style), not via classNames. `videoActiveDeck` read here
           keeps the wrapper re-rendering in sync with deck swaps. */
        void videoActiveDeck;
        return (
          <div
            className={
              videoDocked
                ? "pointer-events-none absolute -z-[1] inset-y-[5px] right-[9px] left-[42%] overflow-hidden rounded-r-[14px]"
                : "pointer-events-none absolute -left-[9999px] h-[180px] w-[320px] overflow-hidden opacity-0"
            }
            aria-hidden
          >
            <div ref={ytContainerRef} className="h-full w-full" />
            <div ref={ytContainerNextRef} className="h-full w-full" />
            {videoDocked ? (
              /* Card-fog language, horizontal: deck-dark on the left melting into the video. */
              <div
                className="absolute inset-y-0 left-0 z-[1] w-2/3 bg-gradient-to-r from-[#0b0f16] via-[#0b0f16]/75 to-transparent"
                aria-hidden
              />
            ) : null}
          </div>
        );
      })() : null}
      {/* DESKTOP player background — artwork (default) / video / static, per-device.
          Display-only; audio is always MPV. The clip appears only once MPV is
          actually progressing, and falls back to artwork on any trouble. */}
      {isDesktopMode ? (
        <DesktopPlayerBackground
          mode={desktopBgMode}
          cover={displayThumbnailCover ?? null}
          videoId={vid}
          mpvStatus={desktopMpvSnap?.status ?? "idle"}
          mpvPosition={desktopMpvSnap?.position ?? 0}
          currentPlayUrl={currentPlayUrl}
          deviceId={deviceCtx?.deviceId ?? null}
          deviceMode={deviceCtx?.deviceMode ?? null}
        />
      ) : null}
      {/* CONTROL mirror video — the control browser plays no audio (it mirrors
          the MASTER), so a MUTED YouTube iframe shows only the clip, synced to
          the mirrored position. Same audio-safe dock as desktop; same right-half
          placement + left fog. Shown only for YouTube tracks while MASTER plays. */}
      {isControlMirror && mirrorVid && (ms?.status === "playing" || ms?.status === "paused") ? (
        <div
          className="pointer-events-none absolute -z-[1] inset-y-[5px] right-[9px] left-[42%] overflow-hidden rounded-r-[14px]"
          aria-hidden
        >
          <DesktopVideoDock
            videoId={mirrorVid}
            mpvStatus={ms.status === "playing" ? "playing" : "paused"}
            mpvPosition={Number.isFinite(displayPosition) ? displayPosition : 0}
            className="absolute inset-0"
          />
          <div
            className="absolute inset-y-0 left-0 z-[1] w-2/3 bg-gradient-to-r from-[#0b0f16] via-[#0b0f16]/75 to-transparent"
            aria-hidden
          />
        </div>
      ) : null}
      {/* Off-screen SoundCloud embed — mount when active to avoid React removeChild conflict */}
      {isEmbedded || isYouTube || isSoundCloud ? (
        <div key={embedType ?? "none"} className="pointer-events-none absolute -left-[9999px] h-[180px] w-[320px] overflow-hidden opacity-0" aria-hidden>
          {!canPrewarmYoutubeEmbed ? (
            <div style={{ display: isYouTube ? "block" : "none" }} className="h-full w-full">
              <div ref={ytContainerRef} className="h-full w-full" />
              <div ref={ytContainerNextRef} className="h-full w-full" />
            </div>
          ) : null}
          <div style={{ display: isSoundCloud ? "block" : "none" }} className="h-full w-full">
            <iframe
              ref={scIframeRef}
              src={isSoundCloud && scEmbedUrl ? scEmbedUrl : "about:blank"}
              title={t.embedSoundCloudFrameTitle}
              className="h-[166px] w-full border-0"
              allow="autoplay"
            />
          </div>
        </div>
      ) : null}
      {/* A/B decks for stream URLs — true overlap crossfade between direct audio elements */}
      <audio ref={audioDeckARef} className="hidden" playsInline />
      <audio ref={audioDeckBRef} className="hidden" playsInline />

      {shareOpen && currentSource && (
        <ShareModal
          item={unifiedSourceToShareable(currentSource)}
          fallbackPlaylistId={currentSource.origin === "playlist" ? currentSource.id : undefined}
          fallbackRadioId={currentSource.origin === "radio" && currentSource.radio ? currentSource.radio.id : undefined}
          onClose={() => setShareOpen(false)}
        />
      )}
      <DesktopPlaybackDiagnostic
        isDesktop={isDesktopMode}
        isControlMirror={isControlMirror}
        intentStatus={status}
        mpvStatus={desktopMpvSnap?.status ?? null}
        engineReady={desktopMpvSnap?.engineReady ?? null}
        lastError={desktopMpvSnap?.lastError ?? null}
        position={desktopMpvSnap?.position ?? null}
        duration={desktopMpvSnap?.duration ?? null}
        currentPlayUrl={currentPlayUrl}
        dispatchedUrl={mpvLastUrlRef.current}
        chAStatus={mpvChAStatusRef.current}
        lastDispatchAt={mpvLastDispatchAtRef.current}
        selfHealAttempts={mpvFrozenForUrlRef.current === currentPlayUrl ? mpvFrozenAttemptsRef.current : 0}
      />
    </header>
  );
}
