"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { usePlayback, type PlaybackTrack, type TrackSource } from "@/lib/playback-provider";
import { useTranslations } from "@/lib/locale-context";
import { ShareModal } from "@/components/share-modal";
import { getYouTubeVideoId } from "@/lib/playlist-utils";
import { getSoundCloudEmbedUrl, isSoundCloudUrl } from "@/lib/player-utils";
import {
  isYtPlayerReady,
  safeGetPlayerState,
  safeGetCurrentTime,
  safeGetDuration,
  safeSetVolume,
  safePlayVideo,
  safePauseVideo,
  safeStopVideo,
  type YTPlayerAPI,
} from "@/lib/yt-player-utils";
import { NeonControlButton } from "@/components/ui/neon-control-button";
import type { SCWidget } from "@/types/yt-sc";

function isHlsUrl(url: string | null): boolean {
  return !!url && (url.includes(".m3u8") || url.includes("m3u8?"));
}

function getEmbedType(url: string): "youtube" | "soundcloud" | null {
  const u = url.toLowerCase();
  if (u.includes("youtube") || u.includes("youtu.be")) return "youtube";
  if (u.includes("soundcloud")) return "soundcloud";
  return null;
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

function getShareUrl(source: NonNullable<ReturnType<typeof usePlayback>["currentSource"]>): { shareUrl: string; shareUrlWeb?: string } {
  if (source.origin === "radio" && source.radio) {
    return {
      shareUrl: `syncbiz://radio/${source.radio.id}`,
      shareUrlWeb: typeof window !== "undefined" ? `${window.location.origin}/radio?station=${encodeURIComponent(source.radio.id)}` : undefined,
    };
  }
  const base = typeof window !== "undefined" ? window.location.origin : "";
  return {
    shareUrl: `${base}/sources?playlist=${encodeURIComponent(source.id)}`,
  };
}

export function AudioPlayer() {
  const { t } = useTranslations();
  const [shareOpen, setShareOpen] = useState(false);
  const {
    currentTrack,
    currentSource,
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
    registerStopAllPlayers,
    currentPlayUrl,
    isEmbedded,
    queue,
  } = usePlayback();

  const ytContainerRef = useRef<HTMLDivElement>(null);
  const scIframeRef = useRef<HTMLIFrameElement>(null);
  const ytPlayerRef = useRef<YTPlayerAPI | null>(null);
  const scWidgetRef = useRef<SCWidget | null>(null);
  const currentVidRef = useRef<string | null>(null);

  const embedType = currentPlayUrl ? getEmbedType(currentPlayUrl) : null;
  const isYouTube = embedType === "youtube";
  const isSoundCloud = embedType === "soundcloud" && currentPlayUrl && isSoundCloudUrl(currentPlayUrl);
  const isStreamUrl = currentPlayUrl && !isYouTube && !isSoundCloud && (currentTrack?.type === "stream-url" || currentSource?.origin === "radio");
  const vid = isYouTube && currentPlayUrl ? getYouTubeVideoId(currentPlayUrl) : null;
  const scEmbedUrl = isSoundCloud && currentPlayUrl ? getSoundCloudEmbedUrl(currentPlayUrl) : null;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hlsRef = useRef<import("hls.js").default | null>(null);

  const loadYouTube = useCallback(() => {
    if (!vid || !ytContainerRef.current) return;
    const oldPlayer = ytPlayerRef.current;
    if (isYtPlayerReady(oldPlayer)) safeStopVideo(oldPlayer);
    ytPlayerRef.current = null;
    currentVidRef.current = vid;
    const loadYT = () => {
      if (!window.YT?.Player || !ytContainerRef.current || currentVidRef.current !== vid) return;
      new window.YT.Player(ytContainerRef.current, {
        videoId: vid,
        width: 320,
        height: 180,
        playerVars: { enablejsapi: 1, origin: typeof window !== "undefined" ? window.location.origin : "" },
        events: {
          onReady(evt) {
            if (currentVidRef.current !== vid) return;
            const target = evt.target;
            if (!isYtPlayerReady(target)) return;
            ytPlayerRef.current = target;
            safeSetVolume(target, volume);
            if (status === "playing") safePlayVideo(target);
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
  }, [vid, volume, status]);

  const loadSoundCloud = useCallback(() => {
    if (!scEmbedUrl || !scIframeRef.current) return;
    const loadSC = () => {
      if (!scIframeRef.current || !window.SC) return;
      const widget = window.SC.Widget(scIframeRef.current);
      scWidgetRef.current = widget;
      widget.setVolume(volume);
      widget.bind("ready", () => {
        if (status === "playing") widget.play();
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
  }, [scEmbedUrl, volume, status]);

  useEffect(() => {
    if (isYouTube) loadYouTube();
    else if (isSoundCloud) loadSoundCloud();
  }, [isYouTube, isSoundCloud, loadYouTube, loadSoundCloud]);

  // HTML5 audio for stream-url (radio, m3u, etc.)
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !isStreamUrl) return;
    if (status === "playing") {
      audio.play().catch(() => {});
    } else {
      audio.pause();
      if (status === "stopped") audio.currentTime = 0;
    }
  }, [status, isStreamUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !isStreamUrl) return;
    audio.volume = volume / 100;
  }, [volume, isStreamUrl]);

  const stopAllEmbedded = useCallback(() => {
    if (ytPlayerRef.current && isYtPlayerReady(ytPlayerRef.current)) {
      safeStopVideo(ytPlayerRef.current);
      ytPlayerRef.current = null;
    }
    if (scWidgetRef.current) {
      try {
        scWidgetRef.current.pause();
        scWidgetRef.current.seekTo(0);
      } catch {
        /* ignore */
      }
      scWidgetRef.current = null;
    }
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
    return () => {
      stopAllEmbedded();
    };
  }, [isYouTube, isSoundCloud, stopAllEmbedded]);

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
  }, [status, isYouTube, isSoundCloud]);

  // Set audio src when stream URL changes (with HLS.js for .m3u8)
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!isStreamUrl || !currentPlayUrl) {
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

    const useHls = isHlsUrl(currentPlayUrl);

    if (useHls) {
      import("hls.js").then(({ default: Hls }) => {
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
          hls.loadSource(currentPlayUrl);
          hls.attachMedia(audio);
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (status === "playing") audio.play().catch(() => {});
          });
        } else if (audio.canPlayType("application/vnd.apple.mpegurl")) {
          audio.src = currentPlayUrl;
          if (status === "playing") audio.play().catch(() => {});
        } else {
          audio.src = currentPlayUrl;
          if (status === "playing") audio.play().catch(() => {});
        }
      });
    } else {
      if (hlsRef.current) {
        try {
          hlsRef.current.destroy();
        } catch {
          /* ignore */
        }
        hlsRef.current = null;
      }
      audio.src = currentPlayUrl;
      if (status === "playing") audio.play().catch(() => {});
    }
  }, [isStreamUrl, currentPlayUrl, status]);

  useEffect(() => {
    const p = ytPlayerRef.current;
    if (isYtPlayerReady(p) && isYouTube) safeSetVolume(p, volume);
    else if (scWidgetRef.current && isSoundCloud) scWidgetRef.current.setVolume(volume);
  }, [volume, isYouTube, isSoundCloud]);

  useEffect(() => {
    if (status !== "playing" && status !== "paused") return;
    const tick = () => {
      const p = ytPlayerRef.current;
      if (isYtPlayerReady(p) && isYouTube) {
        const state = safeGetPlayerState(p);
        if (state === window.YT!.PlayerState.ENDED) next();
      }
    };
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [status, isYouTube, next]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !isStreamUrl) return;
    const onEnded = () => next();
    audio.addEventListener("ended", onEnded);
    return () => audio.removeEventListener("ended", onEnded);
  }, [isStreamUrl, next]);

  const hasPrevNext = (currentSource && queue.length > 1) || (currentSource?.playlist && (currentSource.playlist.tracks?.length ?? 0) > 1);
  const thumbnailCover = currentTrack?.cover ?? currentSource?.cover ?? null;

  return (
    <header
      className="sticky top-0 z-50 border-b border-slate-800/80 bg-slate-950/98 px-4 py-3 shadow-[0_4px_24px_rgba(0,0,0,0.4),0_0_0_1px_rgba(30,215,96,0.08)] backdrop-blur-md"
      role="region"
      aria-label="Player controller"
    >
      <div className="mx-auto flex max-w-6xl flex-nowrap items-center gap-3 overflow-x-auto py-2 sm:gap-6 md:overflow-visible">
        {/* Thumbnail – playlist image, YouTube thumbnail, radio logo, or subtle empty state */}
        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-slate-800 ring-1 ring-slate-700/60 shadow-[0_0_16px_rgba(0,0,0,0.4),0_0_0_1px_rgba(30,215,96,0.12)]">
          {thumbnailCover ? (
            <img src={thumbnailCover} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900" aria-hidden />
          )}
        </div>

        {/* Track title + source icon (right-aligned, large) */}
        <div className="flex min-w-0 flex-1 shrink items-center gap-4">
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold text-slate-100">
              {currentTrack?.title ?? "No track selected"}
            </p>
            <span
              className={`mt-0.5 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
                status === "playing"
                  ? "bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30"
                  : status === "paused"
                    ? "bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/30"
                    : "bg-slate-800 text-slate-500"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${status === "playing" ? "bg-emerald-400 animate-pulse" : status === "paused" ? "bg-amber-400" : "bg-slate-500"}`} />
              {status}
            </span>
          </div>
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-800/80 ring-1 ring-slate-700/60 shadow-[0_0_12px_rgba(30,215,96,0.1)]" title={currentSource?.origin === "radio" ? "Radio" : currentTrack?.type ?? "Local"}>
            <SourceIcon type={currentTrack?.type ?? "local"} origin={currentSource?.origin} size="lg" />
          </div>
        </div>

        {/* Transport – Shuffle | Random | Repeat (small, secondary) | Prev | Stop | Play | Next | Share | Volume */}
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-1 rounded-lg border border-cyan-400/25 bg-slate-900/50 px-1 py-0.5 shadow-[0_0_8px_rgba(34,211,238,0.08)]">
            <NeonControlButton size="xs" variant="cyan" onClick={toggleShuffle} active={shuffle} aria-label="Shuffle" title="Shuffle">
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
              </svg>
            </NeonControlButton>
            <NeonControlButton size="xs" variant="cyan" onClick={toggleShuffle} active={shuffle} aria-label="Random" title="Random">
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </NeonControlButton>
            <NeonControlButton size="xs" variant="cyan" onClick={toggleRepeat} active={repeat} aria-label="Repeat" title="Repeat">
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 1l4 4-4 4" />
                <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                <path d="M7 23l-4-4 4-4" />
                <path d="M21 13v2a4 4 0 0 1-4 4H3" />
              </svg>
            </NeonControlButton>
          </div>
          <div className="h-6 w-px bg-slate-700/80" aria-hidden />
          <NeonControlButton size="lg" onClick={prev} disabled={!hasPrevNext} aria-label="Previous" title="Previous">
            <svg className="h-7 w-7" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
            </svg>
          </NeonControlButton>
          <NeonControlButton size="lg" onClick={stop} disabled={!currentSource} aria-label="Stop" title="Stop">
            <svg className="h-7 w-7" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 6h12v12H6z" />
            </svg>
          </NeonControlButton>
          {status === "playing" ? (
            <NeonControlButton size="lg" onClick={pause} active aria-label="Pause" title="Pause">
              <svg className="h-7 w-7" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
              </svg>
            </NeonControlButton>
          ) : (
            <NeonControlButton
              size="lg"
              onClick={() => (status === "paused" && currentSource ? play() : currentSource ? playSource(currentSource) : undefined)}
              disabled={!currentSource}
              aria-label="Play"
              title="Play"
            >
              <svg className="h-7 w-7 ml-0.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7L8 5z" />
              </svg>
            </NeonControlButton>
          )}
          <NeonControlButton size="lg" onClick={next} disabled={!hasPrevNext} aria-label="Next" title="Next">
            <svg className="h-7 w-7 ml-0.5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 18V6h2v12H6zm11-6l-7 6V6l7 6z" />
            </svg>
          </NeonControlButton>
          <div className="h-8 w-px bg-slate-700/80" aria-hidden />
          <NeonControlButton size="lg" onClick={() => setShareOpen(true)} disabled={!currentSource} aria-label={t.share} title={t.share}>
            <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="5" r="3" />
              <circle cx="6" cy="12" r="3" />
              <circle cx="18" cy="19" r="3" />
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
            </svg>
          </NeonControlButton>
        </div>

        {/* Volume – centered vertically, prominent neon knob */}
        <div className="flex min-w-[120px] shrink-0 items-center justify-center gap-3 rounded-2xl border-2 border-[#1ed760]/30 bg-slate-900/80 px-4 py-2 shadow-[0_0_20px_rgba(30,215,96,0.12),inset_0_1px_0_rgba(255,255,255,0.05)] sm:min-w-[160px]">
          <svg className="h-6 w-6 shrink-0 text-[#1ed760]/90" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
          </svg>
          <div className="flex flex-1 items-center">
            <input
              type="range"
              min={0}
              max={100}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              className="player-volume-slider h-2.5 w-full"
              aria-label="Volume"
            />
          </div>
          <span className="w-9 shrink-0 text-end text-sm font-bold tabular-nums text-[#1ed760]">{volume}</span>
        </div>
      </div>

      {/* Off-screen embeds for YouTube/SoundCloud – volume control via APIs */}
      {isEmbedded && (
        <div className="pointer-events-none absolute -left-[9999px] h-[180px] w-[320px] overflow-hidden opacity-0" aria-hidden>
          {isYouTube && <div ref={ytContainerRef} className="h-full w-full" />}
          {isSoundCloud && <iframe ref={scIframeRef} src={scEmbedUrl!} title="SoundCloud" className="h-[166px] w-full border-0" allow="autoplay" />}
        </div>
      )}
      {/* HTML5 audio for stream URLs (radio, m3u, etc.) – always mounted so ref stays valid */}
      <audio ref={audioRef} className="hidden" playsInline />

      {shareOpen && currentSource && (
        <ShareModal
          title={currentSource.title}
          shareUrl={getShareUrl(currentSource).shareUrl}
          shareUrlWeb={getShareUrl(currentSource).shareUrlWeb}
          onClose={() => setShareOpen(false)}
        />
      )}
    </header>
  );
}
