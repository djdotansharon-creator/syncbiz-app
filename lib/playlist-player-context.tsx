"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Playlist } from "./playlist-types";

type PlaybackStatus = "playing" | "paused" | "stopped" | "idle";

type PlaylistPlayerState = {
  playlists: Playlist[];
  currentIndex: number | null;
  status: PlaybackStatus;
  volume: number;
};

type PlaylistPlayerContextValue = PlaylistPlayerState & {
  currentPlaylist: Playlist | null;
  isActive: (index: number) => boolean;
  play: (index: number) => void;
  pause: () => void;
  stop: () => void;
  prev: () => void;
  next: () => void;
  setVolume: (v: number) => void;
  setPlaylists: (p: Playlist[]) => void;
};

const PlaylistPlayerContext = createContext<PlaylistPlayerContextValue | null>(null);

export function PlaylistPlayerProvider({
  children,
  playlists: initialPlaylists,
}: {
  children: ReactNode;
  playlists: Playlist[];
}) {
  const [playlists, setPlaylistsState] = useState(initialPlaylists);

  useEffect(() => {
    setPlaylistsState(initialPlaylists);
  }, [initialPlaylists]);
  const [currentIndex, setCurrentIndex] = useState<number | null>(null);
  const [status, setStatus] = useState<PlaybackStatus>("idle");
  const [volume, setVolumeState] = useState(80);

  const currentPlaylist = currentIndex !== null ? playlists[currentIndex] ?? null : null;

  const isActive = useCallback(
    (index: number) => currentIndex === index,
    [currentIndex],
  );

  const play = useCallback((index: number) => {
    setCurrentIndex(index);
    setStatus("playing");
  }, []);

  const pause = useCallback(() => {
    setStatus("paused");
  }, []);

  const stop = useCallback(() => {
    setStatus("stopped");
  }, []);

  const prev = useCallback(() => {
    if (playlists.length <= 1) return;
    const idx = currentIndex ?? 0;
    const nextIdx = idx <= 0 ? playlists.length - 1 : idx - 1;
    setCurrentIndex(nextIdx);
    setStatus("playing");
  }, [currentIndex, playlists.length]);

  const next = useCallback(() => {
    if (playlists.length <= 1) return;
    const idx = currentIndex ?? 0;
    const nextIdx = idx >= playlists.length - 1 ? 0 : idx + 1;
    setCurrentIndex(nextIdx);
    setStatus("playing");
  }, [currentIndex, playlists.length]);

  const setVolume = useCallback((v: number) => {
    setVolumeState(Math.max(0, Math.min(100, v)));
  }, []);

  const setPlaylists = useCallback((p: Playlist[]) => {
    setPlaylistsState(p);
  }, []);

  const value = useMemo<PlaylistPlayerContextValue>(
    () => ({
      playlists,
      currentIndex,
      status,
      volume,
      currentPlaylist,
      isActive,
      play,
      pause,
      stop,
      prev,
      next,
      setVolume,
      setPlaylists,
    }),
    [
      playlists,
      currentIndex,
      status,
      volume,
      currentPlaylist,
      isActive,
      play,
      pause,
      stop,
      prev,
      next,
      setVolume,
      setPlaylists,
    ],
  );

  return (
    <PlaylistPlayerContext.Provider value={value}>
      {children}
    </PlaylistPlayerContext.Provider>
  );
}

export function usePlaylistPlayer() {
  const ctx = useContext(PlaylistPlayerContext);
  if (!ctx) throw new Error("usePlaylistPlayer must be used within PlaylistPlayerProvider");
  return ctx;
}
