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
import type { UnifiedSource } from "./source-types";
import { canEmbedInCard } from "./playlist-utils";
import { supportsEmbedded } from "./player-utils";
import { getPlaylistTracks } from "./playlist-types";

export type SourcesPlaybackStatus = "idle" | "playing" | "paused" | "stopped";

type SourcesPlaybackState = {
  currentSource: UnifiedSource | null;
  currentTrackIndex: number;
  status: SourcesPlaybackStatus;
  volume: number;
  sources: UnifiedSource[];
};

type SourcesPlaybackContextValue = SourcesPlaybackState & {
  playSource: (source: UnifiedSource, trackIndex?: number) => void;
  pause: () => void;
  stop: () => void;
  prev: () => void;
  next: () => void;
  setVolume: (v: number) => void;
  setSources: React.Dispatch<React.SetStateAction<UnifiedSource[]>>;
  isActive: (source: UnifiedSource) => boolean;
  currentPlayUrl: string | null;
  isEmbedded: boolean;
};

const SourcesPlaybackContext = createContext<SourcesPlaybackContextValue | null>(null);

export function SourcesPlaybackProvider({
  children,
  sources: initialSources,
}: {
  children: ReactNode;
  sources: UnifiedSource[];
}) {
  const [sources, setSourcesState] = useState(initialSources);
  const [currentSource, setCurrentSource] = useState<UnifiedSource | null>(null);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const [status, setStatus] = useState<SourcesPlaybackStatus>("idle");
  const [volume, setVolumeState] = useState(80);

  useEffect(() => {
    setSourcesState(initialSources);
  }, [initialSources]);

  const getPlayUrl = useCallback((item: UnifiedSource, trackIdx: number): string | null => {
    if (item.playlist) {
      const tracks = getPlaylistTracks(item.playlist);
      const track = tracks[trackIdx];
      return track?.url ?? item.url ?? null;
    }
    return item.url;
  }, []);

  const isEmbeddedSource = useCallback((item: UnifiedSource, trackIdx?: number): boolean => {
    if (item.playlist) {
      const tracks = getPlaylistTracks(item.playlist);
      const idx = trackIdx ?? (item === currentSource ? currentTrackIndex : 0);
      const track = tracks[idx] ?? tracks[0];
      return track ? canEmbedInCard(track.type) : canEmbedInCard(item.type as "youtube" | "soundcloud");
    }
    if (item.source) return supportsEmbedded(item.source);
    return item.type === "youtube" || item.type === "soundcloud";
  }, [currentSource, currentTrackIndex]);

  const currentPlayUrl = currentSource ? getPlayUrl(currentSource, currentTrackIndex) : null;
  const isEmbedded = currentSource ? isEmbeddedSource(currentSource) : false;

  const stopPrevious = useCallback(() => {
    fetch("/api/commands/stop-local", { method: "POST" }).catch(() => {});
  }, []);

  const playSource = useCallback(
    (item: UnifiedSource, trackIndex = 0) => {
      setCurrentSource(item);
      setCurrentTrackIndex(trackIndex);
      setStatus("playing");

      if (item.playlist) {
        const tracks = getPlaylistTracks(item.playlist);
        const track = tracks[trackIndex];
        const url = track?.url ?? item.url;
        if (track && canEmbedInCard(track.type)) {
          stopPrevious();
          return;
        }
        stopPrevious();
        fetch("/api/commands/play-local", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target: url }),
        }).catch(() => {});
      } else if (item.source) {
        const target = item.source.target ?? item.source.uriOrPath ?? item.url;
        if (supportsEmbedded(item.source)) {
          stopPrevious();
          return;
        }
        stopPrevious();
        fetch("/api/commands/play-local", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            target,
            browserPreference: item.source.browserPreference ?? "default",
          }),
        }).catch(() => {});
      } else {
        if (item.type === "youtube" || item.type === "soundcloud") {
          stopPrevious();
        } else {
          stopPrevious();
          fetch("/api/commands/play-local", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ target: item.url }),
          }).catch(() => {});
        }
      }
    },
    [stopPrevious],
  );

  const pause = useCallback(() => setStatus("paused"), []);
  const stop = useCallback(() => {
    setStatus("stopped");
    fetch("/api/commands/stop-local", { method: "POST" }).catch(() => {});
  }, []);

  const playLocalForCurrent = useCallback(() => {
    if (!currentSource) return;
    const url = getPlayUrl(currentSource, currentTrackIndex);
    if (!url) return;
    fetch("/api/commands/play-local", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: url }),
    }).catch(() => {});
  }, [currentSource, currentTrackIndex, getPlayUrl]);

  useEffect(() => {
    if (!currentSource || status !== "playing") return;
    if (isEmbeddedSource(currentSource)) return;
    playLocalForCurrent();
  }, [currentSource, currentTrackIndex, status, isEmbeddedSource, playLocalForCurrent]);

  const prev = useCallback(() => {
    if (!currentSource) return;
    const idx = sources.findIndex((s) => s === currentSource);
    if (idx <= 0) return;
    const prevItem = sources[idx - 1];
    playSource(prevItem);
  }, [currentSource, sources, playSource]);

  const next = useCallback(() => {
    if (!currentSource) return;
    const idx = sources.findIndex((s) => s === currentSource);
    if (idx < 0 || idx >= sources.length - 1) return;
    const nextItem = sources[idx + 1];
    playSource(nextItem);
  }, [currentSource, sources, playSource]);

  const setVolume = useCallback((v: number) => {
    setVolumeState(Math.max(0, Math.min(100, v)));
  }, []);

  const setSources = useCallback((updater: React.SetStateAction<UnifiedSource[]>) => {
    setSourcesState(updater);
  }, []);

  const isActive = useCallback(
    (item: UnifiedSource) => currentSource === item,
    [currentSource],
  );

  const value = useMemo<SourcesPlaybackContextValue>(
    () => ({
      sources,
      currentSource,
      currentTrackIndex,
      status,
      volume,
      playSource,
      pause,
      stop,
      prev,
      next,
      setVolume,
      setSources,
      isActive,
      currentPlayUrl,
      isEmbedded,
    }),
    [
      sources,
      currentSource,
      currentTrackIndex,
      status,
      volume,
      playSource,
      pause,
      stop,
      prev,
      next,
      setVolume,
      setSources,
      isActive,
      currentPlayUrl,
      isEmbedded,
    ],
  );

  return (
    <SourcesPlaybackContext.Provider value={value}>
      {children}
    </SourcesPlaybackContext.Provider>
  );
}

export function useSourcesPlayback() {
  const ctx = useContext(SourcesPlaybackContext);
  if (!ctx) throw new Error("useSourcesPlayback must be used within SourcesPlaybackProvider");
  return ctx;
}
