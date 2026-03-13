"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getYouTubeVideoId, getYouTubePlaylistId, isYouTubeMixUrl } from "@/lib/playlist-utils";
import { getSoundCloudEmbedUrl, isSoundCloudUrl } from "@/lib/player-utils";
import type { Playlist } from "@/lib/playlist-types";
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

// SCWidget matches types/yt-sc.d.ts
interface SCWidget {
  play: () => void;
  pause: () => void;
  seekTo: (ms: number) => void;
  setVolume: (vol: number) => void;
  getPosition: (cb: (ms: number) => void) => void;
  getDuration: (cb: (ms: number) => void) => void;
  bind: (event: string, cb: () => void) => void;
}


type Props = {
  playlist: Playlist;
  status: "playing" | "paused" | "stopped" | "idle";
  volume: number;
  onStatusChange?: (status: "playing" | "paused" | "stopped") => void;
  onTrackEnd?: () => void;
  onVolumeChange?: (v: number) => void;
  onPositionChange?: (position: number, duration: number) => void;
  onSeek?: (sec: number) => void;
};

export function EmbeddedPlayer({
  playlist,
  status,
  volume,
  onStatusChange,
  onTrackEnd,
  onVolumeChange,
  onPositionChange,
  onSeek,
}: Props) {
  const ytContainerRef = useRef<HTMLDivElement>(null);
  const scIframeRef = useRef<HTMLIFrameElement>(null);
  const ytPlayerRef = useRef<YTPlayerAPI | null>(null);
  const currentVidRef = useRef<string | null>(null);
  const scWidgetRef = useRef<SCWidget | null>(null);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loading, setLoading] = useState(true);

  const isYouTube = playlist.type === "youtube";
  const isSoundCloud = playlist.type === "soundcloud" && isSoundCloudUrl(playlist.url);

  const vid = isYouTube ? getYouTubeVideoId(playlist.url) : null;
  const ytPlaylistId = isYouTube ? getYouTubePlaylistId(playlist.url) : null;
  const isYouTubeMix = isYouTube ? isYouTubeMixUrl(playlist.url) : false;
  const scEmbedUrl = isSoundCloud ? getSoundCloudEmbedUrl(playlist.url) : null;

  const statusRef = useRef(status);
  const volumeRef = useRef(volume);
  statusRef.current = status;
  volumeRef.current = volume;

  const loadYouTube = useCallback(() => {
    if (!vid || !ytContainerRef.current) return;
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
            if (process.env.NODE_ENV === "development") console.log("[YT] Player ready");
            safeSetVolume(target, volumeRef.current);
            if (statusRef.current === "playing") safePlayVideo(target);
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
  }, [vid, ytPlaylistId]);

  const loadSoundCloud = useCallback(() => {
    if (!scEmbedUrl || !scIframeRef.current) return;
    const loadSC = () => {
      if (!scIframeRef.current || !window.SC) return;
      const widget = window.SC.Widget(scIframeRef.current);
      scWidgetRef.current = widget;
      widget.setVolume(volumeRef.current);
      widget.bind("ready", () => {
        setLoading(false);
        if (statusRef.current === "playing") widget.play();
      });
      widget.bind("finish", () => {
        onTrackEnd?.();
        if (!onTrackEnd) onStatusChange?.("stopped");
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
  }, [scEmbedUrl, onTrackEnd, onStatusChange]);

  useEffect(() => {
    if (isYouTube) loadYouTube();
    else if (isSoundCloud) loadSoundCloud();
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
          if (!isYouTubeMix) {
            onTrackEnd?.();
            if (!onTrackEnd) onStatusChange?.("stopped");
          }
        } else {
          const pos = safeGetCurrentTime(p);
          const dur = safeGetDuration(p);
          setPosition(pos);
          setDuration(dur);
          onPositionChange?.(pos, dur);
        }
      } else if (scWidgetRef.current && isSoundCloud) {
        scWidgetRef.current.getPosition((ms) => {
          const s = ms / 1000;
          setPosition(s);
          onPositionChange?.(s, duration);
        });
        scWidgetRef.current.getDuration((ms) => {
          const d = ms / 1000;
          setDuration(d);
        });
      }
    };
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [status, isYouTube, isSoundCloud, isYouTubeMix, duration, onStatusChange, onTrackEnd, onPositionChange]);

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
      onSeek?.(sec);
    },
    [isYouTube, isSoundCloud, onSeek],
  );

  if (!isYouTube && !isSoundCloud) return null;

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl bg-black">
        {isYouTube && <div ref={ytContainerRef} className="aspect-video w-full" />}
        {isSoundCloud && scEmbedUrl && (
          <iframe
            ref={scIframeRef}
            src={scEmbedUrl}
            title="SoundCloud"
            className="h-[166px] w-full border-0"
            allow="autoplay"
          />
        )}
      </div>
      {!loading && (
        <>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">{formatTime(position)}</span>
            <input
              type="range"
              min={0}
              max={duration || 1}
              value={position}
              onChange={(e) => handleSeek(Number(e.target.value))}
              className="h-2 flex-1 rounded-full bg-slate-800 accent-[#1db954]"
              aria-label="Progress"
            />
            <span className="text-xs text-slate-500">{formatTime(duration)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">VOL</span>
            <input
              type="range"
              min={0}
              max={100}
              value={volume}
              onChange={(e) => onVolumeChange?.(Number(e.target.value))}
              className="h-2 flex-1 rounded-full bg-slate-800 accent-[#1db954]"
              aria-label="Volume"
            />
            <span className="w-8 text-right text-xs text-slate-500">{volume}</span>
          </div>
        </>
      )}
    </div>
  );
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
