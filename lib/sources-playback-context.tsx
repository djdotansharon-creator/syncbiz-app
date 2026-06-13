"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { UnifiedSource } from "./source-types";
import { canEmbedInCard } from "./playlist-utils";
import { supportsEmbedded } from "./player-utils";
import { getPlaylistTracks } from "./playlist-types";
import { usePlaybackOptional } from "./playback-provider";
import { useDevicePlayer } from "./device-player-context";

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

/**
 * Rail-level "what is highlighted as playing" state. Audio output is OWNED by the
 * global `PlaybackProvider` (lib/playback-provider.tsx) so the Desktop internal MPV
 * engine (or browser HTMLAudio / YT embed) drives playback. This provider used to
 * POST `/api/commands/play-local`, which shelled out `cmd /c start "" "<path>"` —
 * that opens the OS default app (Winamp) for a single file and breaks 50-track
 * playlist playback. We never call that route from here anymore; instead we
 * delegate to `PlaybackProvider.playSource` (full queue) or, when this tab is
 * CONTROL, route the source to the branch MASTER via WS `PLAY_SOURCE`.
 */
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

  const playback = usePlaybackOptional();
  const device = useDevicePlayer();

  // Only sync when IDs actually change (avoids render loop from unstable initialSources ref)
  const prevIdsRef = useRef<string>("");
  useEffect(() => {
    const ids = initialSources.map((s) => s.id).join(",");
    if (ids === prevIdsRef.current) return;
    prevIdsRef.current = ids;
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

  const routeToPlayback = useCallback(
    (item: UnifiedSource, trackIndex: number) => {
      if (device?.isBranchConnected && device.deviceMode === "CONTROL") {
        device.playSourceOrSend(item, trackIndex);
        return;
      }
      playback?.playSource(item, trackIndex);
    },
    [playback, device],
  );

  const playSource = useCallback(
    (item: UnifiedSource, trackIndex = 0) => {
      setCurrentSource(item);
      setCurrentTrackIndex(trackIndex);
      setStatus("playing");
      routeToPlayback(item, trackIndex);
    },
    [routeToPlayback],
  );

  const pause = useCallback(() => {
    setStatus("paused");
    if (device?.isBranchConnected && device.deviceMode === "CONTROL") {
      device.pauseOrSend();
      return;
    }
    playback?.pause();
  }, [playback, device]);

  const stop = useCallback(() => {
    setStatus("stopped");
    if (device?.isBranchConnected && device.deviceMode === "CONTROL") {
      device.stopOrSend();
      return;
    }
    playback?.stop();
  }, [playback, device]);

  const prev = useCallback(() => {
    if (!currentSource) return;
    const idx = sources.findIndex((s) => s === currentSource);
    if (idx <= 0) return;
    const prevItem = sources[idx - 1];
    playSource(prevItem);
  }, [currentSource, sources, playSource]);

  const next = useCallback(() => {
    if (!currentSource) return;
    if (currentSource.playlist) {
      const tracks = getPlaylistTracks(currentSource.playlist);
      if (tracks.length > 1 && currentTrackIndex < tracks.length - 1) {
        playSource(currentSource, currentTrackIndex + 1);
        return;
      }
    }
    const idx = sources.findIndex((s) => s === currentSource);
    const nextIdx = idx < 0 ? 0 : idx >= sources.length - 1 ? 0 : idx + 1;
    const nextItem = sources[nextIdx];
    if (nextItem) playSource(nextItem);
  }, [currentSource, currentTrackIndex, sources, playSource]);

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
