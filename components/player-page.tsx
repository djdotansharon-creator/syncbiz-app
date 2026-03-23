"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Device, Source } from "@/lib/types";
import {
  getYouTubeVideoId,
  getSoundCloudEmbedUrl,
  isSoundCloudUrl,
  resolveSourcePlayerInfo,
  supportsEmbedded,
  getSourceArtworkUrl,
  getSourceIconType,
} from "@/lib/player-utils";
import { SourceIconBadge } from "@/components/source-icon-badge";
import { usePlaybackOptional } from "@/lib/playback-provider";
import type { UnifiedSource } from "@/lib/source-types";

type Props = {
  devices: Device[];
};

type RuntimeStatus = "playing" | "paused" | "stopped" | "loading" | "idle";

interface YTPlayer {
  playVideo: () => void;
  pauseVideo: () => void;
  stopVideo: () => void;
  setVolume: (vol: number) => void;
  getVolume: () => number;
  getPlayerState: () => number;
  getCurrentTime: () => number;
  getDuration: () => number;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
}

interface SCWidget {
  play: () => void;
  pause: () => void;
  seekTo: (ms: number) => void;
  setVolume: (vol: number) => void;
  getVolume: (cb: (vol: number) => void) => void;
  bind: (event: string, cb: () => void) => void;
  unbind: (event: string) => void;
  getPosition: (cb: (ms: number) => void) => void;
  getDuration: (cb: (ms: number) => void) => void;
}

function DefaultMusicArtwork() {
  return (
    <div
      className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-700 to-slate-900 text-slate-500"
      aria-hidden
    >
      <svg
        className="h-16 w-16 opacity-50"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>
    </div>
  );
}

/** Convert playlist to source-like object for the player. */
function playlistToSource(playlist: { id: string; name: string; url: string; thumbnail: string; type: string }): Source {
  const provider = playlist.type === "youtube" ? "youtube" : playlist.type === "soundcloud" ? "soundcloud" : "external";
  return {
    id: playlist.id,
    name: playlist.name,
    target: playlist.url,
    uriOrPath: playlist.url,
    artworkUrl: playlist.thumbnail || undefined,
    provider,
    playerMode: provider === "external" ? "external" : "embedded",
    accountId: "",
    branchId: "",
    type: "stream_url",
  } as Source;
}

/** Convert UnifiedSource (from PlaybackProvider) to Source for PlayerPage display. */
function unifiedSourceToPlayerSource(u: UnifiedSource): Source {
  const target = u.source?.target ?? u.url ?? u.playlist?.url ?? u.radio?.url ?? "";
  const provider = u.type === "youtube" ? "youtube" : u.type === "soundcloud" ? "soundcloud" : "external";
  const playerMode = provider === "external" ? "external" : "embedded";
  return {
    id: u.id,
    name: u.title,
    target,
    uriOrPath: target,
    artworkUrl: u.cover ?? u.source?.artworkUrl ?? undefined,
    provider,
    playerMode,
    accountId: "",
    branchId: "",
    type: "stream_url",
  } as Source;
}

export function PlayerPage({ devices }: Props) {
  const searchParams = useSearchParams();
  const sourceId = searchParams.get("sourceId");
  const playlistId = searchParams.get("playlistId");
  const playback = usePlaybackOptional();

  const [urlSource, setUrlSource] = useState<Source | null>(null);
  const [status, setStatus] = useState<RuntimeStatus>("idle");
  const [volume, setVolume] = useState(80);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ytContainerRef = useRef<HTMLDivElement>(null);
  const scIframeRef = useRef<HTMLIFrameElement>(null);
  const ytPlayerRef = useRef<YTPlayer | null>(null);
  const scWidgetRef = useRef<SCWidget | null>(null);
  const positionIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /** Prefer live playback state (controller-driven) over URL-driven source. */
  const source = useMemo(() => {
    if (playback?.currentSource) return unifiedSourceToPlayerSource(playback.currentSource);
    return urlSource;
  }, [playback?.currentSource, urlSource]);

  const { provider } = source ? resolveSourcePlayerInfo(source) : { provider: "external" as const };
  const artworkUrl = source ? getSourceArtworkUrl(source) : null;
  const iconType = source ? getSourceIconType(source) : "external";
  const isEmbedded = source ? supportsEmbedded(source) : false;

  const fetchSource = useCallback(async (id: string) => {
    setError(null);
    setFeedback(null);
    try {
      const res = await fetch(`/api/sources/${id}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? "Source not found");
      }
      const data: Source = await res.json();
      setUrlSource(data);
      setStatus("loading");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load source");
      setUrlSource(null);
      setStatus("idle");
    }
  }, []);

  const fetchPlaylist = useCallback(async (id: string) => {
    setError(null);
    setFeedback(null);
    try {
      const res = await fetch(`/api/playlists/${id}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? "Playlist not found");
      }
      const data = await res.json();
      setUrlSource(playlistToSource(data));
      setStatus("loading");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load playlist");
      setUrlSource(null);
      setStatus("idle");
    }
  }, []);

  /** URL-driven load: only when no live playback and URL has sourceId/playlistId. */
  useEffect(() => {
    if (playback?.currentSource) return;
    if (sourceId) void fetchSource(sourceId);
    else if (playlistId) void fetchPlaylist(playlistId);
    else {
      setUrlSource(null);
      setStatus("idle");
    }
  }, [sourceId, playlistId, fetchSource, fetchPlaylist, playback?.currentSource]);

  /** When live playback provides source (or source changes), trigger embed load so iframe loads. */
  const prevDisplaySourceIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!source || !isEmbedded) return;
    const displayId = source.id;
    if (prevDisplaySourceIdRef.current !== displayId) {
      prevDisplaySourceIdRef.current = displayId;
      setStatus("loading");
    }
  }, [source, isEmbedded]);

  const loadYouTubePlayer = useCallback(() => {
    if (!source || provider !== "youtube") return;
    const vid = getYouTubeVideoId(source.target);
    if (!vid || !ytContainerRef.current) return;

    const loadYT = () => {
      if (!window.YT || !ytContainerRef.current) return;
      const player = new window.YT.Player(ytContainerRef.current, {
        videoId: vid,
        width: 640,
        height: 360,
        playerVars: {
          enablejsapi: 1,
          origin: typeof window !== "undefined" ? window.location.origin : "",
        },
        events: {
          onReady(evt) {
            ytPlayerRef.current = evt.target;
            evt.target.setVolume(volume);
            evt.target.playVideo();
            setStatus("playing");
            setFeedback(null);
          },
        },
      });
      ytPlayerRef.current = player as YTPlayer;
    };

    if (window.YT?.Player) {
      loadYT();
      return;
    }
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    const first = document.getElementsByTagName("script")[0];
    first?.parentNode?.insertBefore(tag, first);
    window.onYouTubeIframeAPIReady = () => {
      loadYT();
    };
  }, [source, provider, volume]);

  const loadSoundCloudWidget = useCallback(() => {
    if (!source || provider !== "soundcloud") return;
    if (!isSoundCloudUrl(source.target)) return;

    const loadSC = () => {
      if (!scIframeRef.current || !window.SC) return;
      const widget = window.SC.Widget(scIframeRef.current);
       scWidgetRef.current = widget as SCWidget;
      widget.setVolume(volume);
      widget.bind("ready", () => {
        widget.play();
        setStatus("playing");
        setFeedback(null);
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
  }, [source, provider, volume]);

  useEffect(() => {
    if (!source || status !== "loading") return;
    if (provider === "youtube") loadYouTubePlayer();
    else if (provider === "soundcloud") loadSoundCloudWidget();
    else setStatus("idle");
  }, [source, status, provider, loadYouTubePlayer, loadSoundCloudWidget]);

  useEffect(() => {
    if (status !== "playing" && status !== "paused") return;
    const tick = () => {
      if (ytPlayerRef.current && provider === "youtube") {
        const state = ytPlayerRef.current.getPlayerState();
        if (state === window.YT!.PlayerState.ENDED) setStatus("stopped");
        else {
          setPosition(ytPlayerRef.current.getCurrentTime());
          setDuration(ytPlayerRef.current.getDuration());
        }
      } else if (scWidgetRef.current && provider === "soundcloud") {
        scWidgetRef.current.getPosition((ms) => setPosition(ms / 1000));
        scWidgetRef.current.getDuration((ms) => setDuration(ms / 1000));
      }
    };
    const id = setInterval(tick, 500);
    positionIntervalRef.current = id;
    return () => {
      if (positionIntervalRef.current) clearInterval(positionIntervalRef.current);
    };
  }, [status, provider]);

  const handlePlay = () => {
    if (ytPlayerRef.current && provider === "youtube") {
      ytPlayerRef.current.playVideo();
      setStatus("playing");
    } else if (scWidgetRef.current && provider === "soundcloud") {
      scWidgetRef.current.play();
      setStatus("playing");
    }
  };

  const handlePause = () => {
    if (ytPlayerRef.current && provider === "youtube") {
      ytPlayerRef.current.pauseVideo();
      setStatus("paused");
    } else if (scWidgetRef.current && provider === "soundcloud") {
      scWidgetRef.current.pause();
      setStatus("paused");
    }
  };

  const handleStop = () => {
    if (ytPlayerRef.current && provider === "youtube") {
      ytPlayerRef.current.stopVideo();
      setStatus("stopped");
      setPosition(0);
    } else if (scWidgetRef.current && provider === "soundcloud") {
      scWidgetRef.current.pause();
      scWidgetRef.current.seekTo(0);
      setStatus("stopped");
      setPosition(0);
    }
  };

  const handleVolume = (val: number) => {
    setVolume(val);
    if (ytPlayerRef.current && provider === "youtube") ytPlayerRef.current.setVolume(val);
    else if (scWidgetRef.current && provider === "soundcloud") scWidgetRef.current.setVolume(val);
  };

  const handleSeek = (sec: number) => {
    if (ytPlayerRef.current && provider === "youtube") {
      ytPlayerRef.current.seekTo(sec, true);
      setPosition(sec);
    } else if (scWidgetRef.current && provider === "soundcloud") {
      scWidgetRef.current.seekTo(sec * 1000);
      setPosition(sec);
    }
  };

  const handlePrev = () => {
    setFeedback("Previous not available for single track");
  };

  const handleNext = () => {
    setFeedback("Next not available for single track");
  };

  const providerLabel =
    provider === "youtube" ? "YouTube" : provider === "soundcloud" ? "SoundCloud" : "External";

  if (error) {
    return (
      <div className="mx-auto max-w-2xl rounded-2xl border border-red-900/50 bg-slate-950/80 p-8 text-center">
        <p className="text-red-400">{error}</p>
        <p className="mt-2 text-sm text-slate-500">
          Select a source from the Sources page and click Play to open it here.
        </p>
      </div>
    );
  }

  if (!source) {
    return (
      <div className="mx-auto max-w-2xl rounded-2xl border border-slate-800/80 bg-slate-950/60 p-12 text-center">
        <h1 className="text-xl font-semibold text-slate-200">SyncBiz Player</h1>
        <p className="mt-2 text-slate-500">
          Select a YouTube or SoundCloud source from the Sources page and click Play to open it here.
        </p>
        <p className="mt-1 text-sm text-slate-600">
          External sources will continue to open in your browser.
        </p>
      </div>
    );
  }

  if (!isEmbedded) {
    return (
      <div className="mx-auto max-w-2xl rounded-2xl border border-slate-800/80 bg-slate-950/60 p-8 text-center">
        <h1 className="text-xl font-semibold text-slate-200">{source.name}</h1>
        <p className="mt-1 text-sm text-slate-500">{providerLabel}</p>
        <p className="mt-4 text-slate-400">
          This source uses external playback. Use the Play button on the source card to open it in
          your browser.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="rounded-2xl border border-slate-800/80 bg-slate-950/80 p-6 shadow-xl">
        <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
          <div className="relative flex-shrink-0">
            <div className="aspect-square w-48 overflow-hidden rounded-xl bg-slate-900 shadow-lg">
              {artworkUrl ? (
                <img
                  src={artworkUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                <DefaultMusicArtwork />
              )}
            </div>
            <div className="absolute bottom-0 right-0 p-2">
              <SourceIconBadge type={iconType} size="md" />
            </div>
          </div>
          <div className="min-w-0 flex-1 text-center sm:text-left">
            <h1 className="truncate text-xl font-semibold text-slate-100">{source.name}</h1>
            <p className="mt-1 text-sm font-medium uppercase tracking-wider text-slate-500">
              {providerLabel}
            </p>
            <p
              className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                status === "playing"
                  ? "bg-emerald-500/20 text-emerald-400"
                  : status === "paused"
                    ? "bg-amber-500/20 text-amber-400"
                    : status === "loading"
                      ? "bg-sky-500/20 text-sky-400"
                      : "bg-slate-700 text-slate-500"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  status === "playing"
                    ? "bg-emerald-400 animate-pulse"
                    : status === "paused"
                      ? "bg-amber-400"
                      : "bg-slate-500"
                }`}
              />
              {status === "loading" ? "Loading…" : status}
            </p>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button
            onClick={handlePrev}
            className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-700 bg-slate-900/80 text-slate-300 transition hover:bg-slate-800 disabled:opacity-40"
            title="Previous"
          >
            <span className="text-sm font-bold">⏮</span>
          </button>
          <button
            onClick={handleStop}
            className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-700 bg-slate-900/80 text-slate-300 transition hover:bg-slate-800"
            title="Stop"
          >
            <span className="text-sm font-bold">■</span>
          </button>
          <button
            onClick={handlePlay}
            disabled={status === "loading"}
            className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#1db954] text-white shadow-lg transition hover:bg-[#1ed760] disabled:opacity-50"
            title="Play"
          >
            <span className="text-xl font-bold">▶</span>
          </button>
          <button
            onClick={handlePause}
            disabled={status === "loading"}
            className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-700 bg-slate-900/80 text-slate-300 transition hover:bg-slate-800 disabled:opacity-40"
            title="Pause"
          >
            <span className="text-sm font-bold">⏸</span>
          </button>
          <button
            onClick={handleNext}
            className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-700 bg-slate-900/80 text-slate-300 transition hover:bg-slate-800 disabled:opacity-40"
            title="Next"
          >
            <span className="text-sm font-bold">⏭</span>
          </button>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <span className="text-xs font-medium text-slate-500">VOL</span>
          <input
            type="range"
            min={0}
            max={100}
            value={volume}
            onChange={(e) => handleVolume(Number(e.target.value))}
            className="h-2 flex-1 rounded-full bg-slate-800 accent-[#1db954]"
          />
          <span className="w-8 text-right text-xs text-slate-500">{volume}</span>
        </div>

        {(provider === "youtube" || provider === "soundcloud") && (
          <div className="mt-4">
            <div className="mb-1 flex justify-between text-xs text-slate-500">
              <span>{Math.floor(position)}s</span>
              <span>{Math.floor(duration)}s</span>
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

        {feedback && (
          <p className="mt-3 text-center text-sm text-slate-400">{feedback}</p>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900/40">
        {provider === "youtube" && (
          <div ref={ytContainerRef} className="aspect-video w-full bg-black" />
        )}
        {provider === "soundcloud" && (
          <iframe
            ref={scIframeRef}
            src={getSoundCloudEmbedUrl(source.target)}
            title="SoundCloud"
            className="h-[166px] w-full border-0"
            allow="autoplay"
          />
        )}
      </div>
    </div>
  );
}
