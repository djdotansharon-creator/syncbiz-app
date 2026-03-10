"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLibraryPlayback } from "@/lib/library-playback-context";
import { getLibraryItemName, getLibraryItemCover, isPlaylist } from "@/lib/library-types";
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
  safeSeekTo,
  type YTPlayerAPI,
} from "@/lib/yt-player-utils";
import {
  ActionButtonPlay,
  ActionButtonStop,
  ActionButtonPause,
  ActionButtonPrev,
  ActionButtonNext,
} from "@/components/ui/action-buttons";

interface SCWidget {
  play: () => void;
  pause: () => void;
  seekTo: (ms: number) => void;
  setVolume: (vol: number) => void;
  getPosition: (cb: (ms: number) => void) => void;
  getDuration: (cb: (ms: number) => void) => void;
  bind: (event: string, cb: () => void) => void;
}

function getEmbedType(url: string): "youtube" | "soundcloud" | null {
  const u = url.toLowerCase();
  if (u.includes("youtube") || u.includes("youtu.be")) return "youtube";
  if (u.includes("soundcloud")) return "soundcloud";
  return null;
}

export function SyncBizPlayer() {
  const {
    currentItem,
    currentTrackIndex,
    currentPlayUrl,
    isEmbedded,
    status,
    volume,
    playItem,
    pause,
    stop,
    prev,
    next,
    setVolume,
    items,
  } = useLibraryPlayback();

  const ytContainerRef = useRef<HTMLDivElement>(null);
  const scIframeRef = useRef<HTMLIFrameElement>(null);
  const ytPlayerRef = useRef<YTPlayerAPI | null>(null);
  const currentVidRef = useRef<string | null>(null);
  const scWidgetRef = useRef<SCWidget | null>(null);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loading, setLoading] = useState(true);

  const embedType = currentPlayUrl ? getEmbedType(currentPlayUrl) : null;
  const isYouTube = embedType === "youtube";
  const isSoundCloud = embedType === "soundcloud" && currentPlayUrl && isSoundCloudUrl(currentPlayUrl);
  const vid = isYouTube && currentPlayUrl ? getYouTubeVideoId(currentPlayUrl) : null;
  const scEmbedUrl = isSoundCloud && currentPlayUrl ? getSoundCloudEmbedUrl(currentPlayUrl) : null;

  const loadYouTube = useCallback(() => {
    if (!vid || !ytContainerRef.current) return;
    ytPlayerRef.current = null;
    currentVidRef.current = vid;
    const loadYT = () => {
      if (!window.YT?.Player || !ytContainerRef.current || currentVidRef.current !== vid) return;
      new window.YT.Player(ytContainerRef.current, {
        videoId: vid,
        width: 640,
        height: 360,
        playerVars: {
          enablejsapi: 1,
          origin: typeof window !== "undefined" ? window.location.origin : "",
        },
        events: {
          onReady(evt) {
            if (currentVidRef.current !== vid) return;
            const target = evt.target;
            if (!isYtPlayerReady(target)) return;
            ytPlayerRef.current = target;
            if (process.env.NODE_ENV === "development") console.log("[YT] Player ready");
            safeSetVolume(target, volume);
            if (status === "playing") safePlayVideo(target);
            setLoading(false);
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
        setLoading(false);
        if (status === "playing") widget.play();
      });
      widget.bind("finish", () => next());
    };
    if (window.SC) {
      loadSC();
      return;
    }
    const tag = document.createElement("script");
    tag.src = "https://w.soundcloud.com/player/api.js";
    tag.onload = loadSC;
    document.body.appendChild(tag);
  }, [scEmbedUrl, volume, status, next]);

  useEffect(() => {
    if (isYouTube) loadYouTube();
    else if (isSoundCloud) loadSoundCloud();
    else setLoading(false);
  }, [isYouTube, isSoundCloud, loadYouTube, loadSoundCloud]);

  useEffect(() => {
    return () => {
      if (isYouTube) {
        const p = ytPlayerRef.current;
        if (isYtPlayerReady(p)) safeStopVideo(p);
        ytPlayerRef.current = null;
        if (process.env.NODE_ENV === "development") console.log("[YT] Source switched, player cleaned");
      }
      if (isSoundCloud && scWidgetRef.current) {
        try {
          scWidgetRef.current.pause();
          scWidgetRef.current.seekTo(0);
        } catch {
          /* ignore */
        }
        scWidgetRef.current = null;
      }
    };
  }, [isYouTube, isSoundCloud]);

  useEffect(() => {
    if (status !== "playing" && status !== "paused") return;
    const tick = () => {
      const p = ytPlayerRef.current;
      if (isYtPlayerReady(p) && isYouTube) {
        const state = safeGetPlayerState(p);
        if (state === window.YT!.PlayerState.ENDED) {
          next();
        } else {
          setPosition(safeGetCurrentTime(p));
          setDuration(safeGetDuration(p));
        }
      } else if (scWidgetRef.current && isSoundCloud) {
        scWidgetRef.current.getPosition((ms) => setPosition(ms / 1000));
        scWidgetRef.current.getDuration((ms) => setDuration(ms / 1000));
      }
    };
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [status, isYouTube, isSoundCloud, next]);

  useEffect(() => {
    const p = ytPlayerRef.current;
    if (isYtPlayerReady(p) && isYouTube) safeSetVolume(p, volume);
    else if (scWidgetRef.current && isSoundCloud) scWidgetRef.current.setVolume(volume);
  }, [volume, isYouTube, isSoundCloud]);

  useEffect(() => {
    const p = ytPlayerRef.current;
    if (status === "playing") {
      if (isYtPlayerReady(p) && isYouTube) safePlayVideo(p);
      else if (scWidgetRef.current && isSoundCloud) scWidgetRef.current.play();
    } else if (status === "paused" || status === "stopped") {
      if (isYtPlayerReady(p) && isYouTube) {
        if (status === "stopped") {
          safeStopVideo(p);
          setPosition(0);
        } else safePauseVideo(p);
      } else if (scWidgetRef.current && isSoundCloud) {
        scWidgetRef.current.pause();
        if (status === "stopped") {
          scWidgetRef.current.seekTo(0);
          setPosition(0);
        }
      }
    }
  }, [status, isYouTube, isSoundCloud]);

  const handleSeek = useCallback(
    (sec: number) => {
      const p = ytPlayerRef.current;
      if (isYtPlayerReady(p) && isYouTube) {
        safeSeekTo(p, sec, true);
        setPosition(sec);
      } else if (scWidgetRef.current && isSoundCloud) {
        scWidgetRef.current.seekTo(sec * 1000);
        setPosition(sec);
      }
    },
    [isYouTube, isSoundCloud],
  );

  const hasPrevNext = items.length > 1;

  if (!currentItem) {
    return (
      <div className="rounded-2xl border border-slate-800/80 bg-slate-950/60 p-8 text-center">
        <p className="text-sm text-slate-500">No track selected. Click Play on any item to start.</p>
      </div>
    );
  }

  const name = getLibraryItemName(currentItem);
  const cover = getLibraryItemCover(currentItem);
  const genre = isPlaylist(currentItem) ? currentItem.data.genre : null;

  return (
    <div className="rounded-2xl border border-slate-800/80 bg-gradient-to-b from-slate-900/95 to-slate-950/95 p-6 shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
      <div className="flex flex-col items-center gap-5 lg:flex-row lg:items-center">
        <div className="relative flex-shrink-0">
          <div className="aspect-square w-40 overflow-hidden rounded-2xl bg-slate-900 shadow-[0_4px_20px_rgba(0,0,0,0.4)] ring-1 ring-slate-800/80 sm:w-44">
            {cover ? (
              <img src={cover} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-slate-500">
                <svg className="h-16 w-16 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M9 18V5l12-2v13" />
                  <circle cx="6" cy="18" r="3" />
                  <circle cx="18" cy="16" r="3" />
                </svg>
              </div>
            )}
          </div>
        </div>
        <div className="min-w-0 flex-1 text-center lg:text-left">
          <h2 className="truncate text-xl font-semibold text-slate-100">{name}</h2>
          {genre && (
            <p className="mt-1 text-sm font-medium uppercase tracking-wider text-slate-500">{genre}</p>
          )}
          <p
            className={`mt-3 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${
              status === "playing"
                ? "bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30"
                : status === "paused"
                  ? "bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/30"
                  : "bg-slate-800 text-slate-500"
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                status === "playing" ? "bg-emerald-400 animate-pulse" : status === "paused" ? "bg-amber-400" : "bg-slate-500"
              }`}
            />
            {status}
          </p>
        </div>
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-4" role="group" aria-label="Player controls">
        {hasPrevNext && <ActionButtonPrev onClick={prev} size="md" title="Previous" aria-label="Previous" />}
        <ActionButtonStop onClick={stop} size="md" title="Stop" aria-label="Stop" />
        <ActionButtonPlay
          onClick={() => currentItem && playItem(currentItem)}
          size="xl"
          title="Play"
          aria-label="Play"
        />
        <ActionButtonPause onClick={pause} size="md" title="Pause" aria-label="Pause" />
        {hasPrevNext && <ActionButtonNext onClick={next} size="md" title="Next" aria-label="Next" />}
      </div>

      <div className="mt-6 flex items-center gap-4">
        <span className="w-8 text-xs font-medium uppercase tracking-wider text-slate-500">Vol</span>
        <input
          type="range"
          min={0}
          max={100}
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          className="h-2.5 flex-1 max-w-[200px] rounded-full bg-slate-800 accent-[#1db954]"
          aria-label="Volume"
        />
        <span className="w-10 text-right text-sm font-medium tabular-nums text-slate-400">{volume}</span>
      </div>

      {isEmbedded && !loading && (
        <div className="mt-5">
          <div className="mb-1.5 flex justify-between text-xs font-medium text-slate-500">
            <span>{formatTime(position)}</span>
            <span>{formatTime(duration)}</span>
          </div>
          <input
            type="range"
            min={0}
            max={duration || 1}
            value={position}
            onChange={(e) => handleSeek(Number(e.target.value))}
            className="h-2.5 w-full cursor-pointer rounded-full bg-slate-800 accent-[#1db954]"
            aria-label="Track progress"
          />
        </div>
      )}

      {isEmbedded && (
        <div className="mt-4 overflow-hidden rounded-xl bg-black">
          {isYouTube && <div ref={ytContainerRef} className="aspect-video w-full" />}
          {isSoundCloud && (
            <iframe
              ref={scIframeRef}
              src={scEmbedUrl!}
              title="SoundCloud"
              className="h-[166px] w-full border-0"
              allow="autoplay"
            />
          )}
        </div>
      )}

      {!isEmbedded && currentItem && (
        <p className="mt-4 text-center text-sm text-slate-500">
          Local playback. Use system player or Winamp.
        </p>
      )}
    </div>
  );
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
