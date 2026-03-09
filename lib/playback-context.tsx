"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Source } from "@/lib/types";

export type PlaybackStatus = "idle" | "playing" | "paused" | "stopped";

export type PlaybackSourceKind = "youtube" | "stream" | "web" | "unsupported";

export function getPlaybackKind(source: Source): PlaybackSourceKind {
  const url = (source.target ?? source.uriOrPath ?? "").trim().toLowerCase();
  if (!url) return "unsupported";
  if (
    source.type === "app_target" ||
    source.type === "tts" ||
    source.type === "playlist_url" ||
    source.type === "local_playlist"
  )
    return "unsupported";
  if (
    url.includes("youtube.com/watch") ||
    url.includes("youtu.be/") ||
    url.includes("youtube.com/embed/")
  )
    return "youtube";
  if (source.type === "stream_url") return "stream";
  if (source.type === "web_url" || source.type === "browser_target") return "web";
  if (url.match(/\.(m3u8|mp3|aac|ogg|wav|mp4|webm)(\?|$)/i)) return "stream";
  return "web";
}

export function isSupportedForPlayback(source: Source): boolean {
  return getPlaybackKind(source) !== "unsupported";
}

function extractYouTubeVideoId(url: string): string | null {
  const u = url.trim();
  const m = u.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\s?/]+)/i);
  return m ? m[1] : null;
}

type PlaybackState = {
  currentSource: Source | null;
  status: PlaybackStatus;
  volume: number;
  queue: Source[];
  /** For unsupported: show message after "play" (e.g. command sent) */
  lastMessage: string | null;
};

type PlaybackContextValue = PlaybackState & {
  playSource: (source: Source) => boolean;
  play: () => void;
  pause: () => void;
  stop: () => void;
  prev: () => void;
  next: () => void;
  setVolume: (value: number) => void;
  setStatus: (status: PlaybackStatus) => void;
  /** Set feedback message (e.g. after play-local success/error) */
  setLastMessage: (message: string | null) => void;
};

const PlaybackContext = createContext<PlaybackContextValue | null>(null);

export function PlaybackProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PlaybackState>({
    currentSource: null,
    status: "idle",
    volume: 80,
    queue: [],
    lastMessage: null,
  });

  const playSource = useCallback((source: Source) => {
    const kind = getPlaybackKind(source);
    if (kind === "unsupported") {
      setState((s) => ({
        ...s,
        lastMessage:
          source.type === "local_playlist"
            ? "Command sent to agent (local playlist)"
            : "Command sent (unsupported in-browser playback)",
      }));
      return false;
    }
    setState((s) => ({
      ...s,
      currentSource: source,
      status: "playing",
      queue: [source, ...s.queue.filter((x) => x.id !== source.id)].slice(0, 20),
      lastMessage: null,
    }));
    return true;
  }, []);

  const play = useCallback(() => {
    setState((s) => (s.currentSource ? { ...s, status: "playing" as const } : s));
  }, []);

  const pause = useCallback(() => {
    setState((s) => (s.currentSource ? { ...s, status: "paused" as const } : s));
  }, []);

  const stop = useCallback(() => {
    setState((s) => ({
      ...s,
      status: "stopped" as const,
      currentSource: null,
    }));
  }, []);

  const prev = useCallback(() => {
    setState((s) => {
      if (s.queue.length < 2) return s;
      const idx = s.queue.findIndex((x) => x.id === s.currentSource?.id);
      const nextIdx = idx <= 0 ? s.queue.length - 1 : idx - 1;
      const nextSource = s.queue[nextIdx];
      return {
        ...s,
        currentSource: nextSource,
        status: "playing" as const,
      };
    });
  }, []);

  const next = useCallback(() => {
    setState((s) => {
      if (s.queue.length < 2) return s;
      const idx = s.queue.findIndex((x) => x.id === s.currentSource?.id);
      const nextIdx = idx < 0 || idx >= s.queue.length - 1 ? 0 : idx + 1;
      const nextSource = s.queue[nextIdx];
      return {
        ...s,
        currentSource: nextSource,
        status: "playing" as const,
      };
    });
  }, []);

  const setVolume = useCallback((value: number) => {
    setState((s) => ({ ...s, volume: Math.max(0, Math.min(100, value)) }));
  }, []);

  const setStatus = useCallback((status: PlaybackStatus) => {
    setState((s) => ({ ...s, status }));
  }, []);

  const setLastMessage = useCallback((message: string | null) => {
    setState((s) => ({ ...s, lastMessage: message }));
  }, []);

  const value = useMemo<PlaybackContextValue>(
    () => ({
      ...state,
      playSource,
      play,
      pause,
      stop,
      prev,
      next,
      setVolume,
      setStatus,
      setLastMessage,
    }),
    [state, playSource, play, pause, stop, prev, next, setVolume, setStatus, setLastMessage],
  );

  return (
    <PlaybackContext.Provider value={value}>{children}</PlaybackContext.Provider>
  );
}

export function usePlayback() {
  const ctx = useContext(PlaybackContext);
  if (!ctx) throw new Error("usePlayback must be used within PlaybackProvider");
  return ctx;
}

export function usePlaybackOptional() {
  return useContext(PlaybackContext);
}

export { extractYouTubeVideoId };
