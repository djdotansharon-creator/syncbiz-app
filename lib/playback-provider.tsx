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
import { initDeviceId } from "./device-id";
import type { Playlist } from "./playlist-types";
import type { UnifiedSource, SourceProviderType } from "./source-types";
import type { Source } from "./types";
import { getPlaylistTracks } from "./playlist-types";
import { canEmbedInCard } from "./playlist-utils";
import { supportsEmbedded, getSourceArtworkUrl } from "./player-utils";
import { getYouTubeThumbnail } from "./playlist-utils";
import { log as mvpLog } from "./mvp-logger";
import { isValidPlaybackUrl } from "./url-validation";

export type PlaybackStatus = "idle" | "playing" | "paused" | "stopped";

export type TrackSource = "youtube" | "soundcloud" | "spotify" | "local" | "stream-url" | "winamp";

/** Normalized track for playback - from playlist or standalone source */
export type PlaybackTrack = {
  id: string;
  title: string;
  type: TrackSource;
  url: string;
  cover: string | null;
};

function unifiedToPlaybackTrack(source: UnifiedSource, trackIndex = 0): PlaybackTrack {
  if (source.playlist) {
    const tracks = getPlaylistTracks(source.playlist);
    const t = tracks[trackIndex] ?? tracks[0];
    const title = t?.name ?? (t as { title?: string })?.title ?? source.title;
    const type = (t?.type ?? source.type) as TrackSource;
    const url = t?.url ?? source.url;
    const cover = t?.cover ?? source.cover ?? null;
    return {
      id: t?.id ?? `${source.id}-${trackIndex}`,
      title,
      type,
      url,
      cover,
    };
  }
  return {
    id: source.id,
    title: source.title,
    type: source.type as TrackSource,
    url: source.url,
    cover: source.cover,
  };
}

function sourceToUnified(s: Source): UnifiedSource {
  const target = (s.target ?? s.uriOrPath ?? "").trim();
  let type: SourceProviderType = "stream-url";
  if (target.includes("youtube") || target.includes("youtu.be")) type = "youtube";
  else if (target.includes("soundcloud")) type = "soundcloud";
  else if (target.includes("spotify")) type = "spotify";
  else if (target.match(/\.(m3u8?|pls)(\?|$)/i)) type = "winamp";
  else if (target.startsWith("http")) type = "stream-url";
  else type = "local";
  const cover = getSourceArtworkUrl(s) || getYouTubeThumbnail(target) || null;
  return {
    id: `src-${s.id}`,
    title: s.name,
    genre: "Mixed",
    cover,
    type,
    url: target,
    origin: "source",
    source: s,
  };
}

type PlaybackState = {
  currentPlaylist: Playlist | null;
  currentSource: UnifiedSource | null;
  currentTrackIndex: number;
  currentTrack: PlaybackTrack | null;
  status: PlaybackStatus;
  volume: number;
  shuffle: boolean;
  repeat: boolean;
  lastMessage: string | null;
  /** All playlists/sources for next/prev between items */
  queue: UnifiedSource[];
  queueIndex: number;
};

type PlaybackContextValue = PlaybackState & {
  play: () => void;
  pause: () => void;
  stop: () => void;
  prev: () => void;
  next: () => void;
  setVolume: (value: number) => void;
  setShuffle: (value: boolean) => void;
  toggleShuffle: () => void;
  setRepeat: (value: boolean) => void;
  toggleRepeat: () => void;
  setLastMessage: (message: string | null) => void;
  playSource: (source: UnifiedSource, trackIndex?: number) => void;
  playSourceFromDb: (source: Source) => void;
  playPlaylist: (playlist: Playlist, trackIndex?: number) => void;
  setQueue: (sources: UnifiedSource[]) => void;
  registerStopAllPlayers: (fn: () => void) => () => void;
  currentPlayUrl: string | null;
  isEmbedded: boolean;
};

const PlaybackContext = createContext<PlaybackContextValue | null>(null);

const STORAGE_KEY = "syncbiz-playback";

function loadPersistedPlayback(): { sourceId: string; trackIndex: number; status: PlaybackStatus; volume: number } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { sourceId?: string; trackIndex?: number; status?: string; volume?: number };
    if (parsed?.sourceId && (parsed.status === "playing" || parsed.status === "paused")) {
      return {
        sourceId: parsed.sourceId,
        trackIndex: typeof parsed.trackIndex === "number" ? parsed.trackIndex : 0,
        status: parsed.status as PlaybackStatus,
        volume: typeof parsed.volume === "number" ? Math.max(0, Math.min(100, parsed.volume)) : 80,
      };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function savePersistedPlayback(sourceId: string, trackIndex: number, status: PlaybackStatus, volume: number) {
  if (typeof window === "undefined") return;
  try {
    if (status === "playing" || status === "paused") {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ sourceId, trackIndex, status, volume }));
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* ignore */
  }
}

export function PlaybackProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PlaybackState>({
    currentPlaylist: null,
    currentSource: null,
    currentTrackIndex: 0,
    currentTrack: null,
    status: "idle",
    volume: 80,
    shuffle: false,
    repeat: false,
    lastMessage: null,
    queue: [],
    queueIndex: -1,
  });

  useEffect(() => {
    initDeviceId();
  }, []);

  // Persist playback state for restore on refresh
  useEffect(() => {
    const { currentSource, currentTrackIndex, status, volume } = state;
    if (currentSource && (status === "playing" || status === "paused")) {
      savePersistedPlayback(currentSource.id, currentTrackIndex, status, volume);
    } else if (typeof window !== "undefined") {
      try {
        sessionStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
    }
  }, [state.currentSource?.id, state.currentTrackIndex, state.status, state.volume]);

  const hasRestoredRef = useRef(false);
  const prevStatusRef = useRef<PlaybackStatus>("idle");
  const prevTrackKeyRef = useRef<string>("");
  useEffect(() => {
    const { status, currentSource, currentTrackIndex, currentTrack } = state;
    const trackKey = currentSource ? `${currentSource.id}-${currentTrackIndex}` : "";
    if (status === "playing" && prevStatusRef.current !== "playing") {
      mvpLog("playback_started", { id: currentSource?.id, title: currentTrack?.title });
    }
    if (status === "paused" && prevStatusRef.current === "playing") {
      mvpLog("playback_paused", { id: currentSource?.id, title: currentTrack?.title });
    }
    if (trackKey && trackKey !== prevTrackKeyRef.current && (status === "playing" || status === "paused")) {
      mvpLog("track_changed", { id: currentSource?.id, trackIndex: currentTrackIndex, title: currentTrack?.title });
    }
    prevStatusRef.current = status;
    prevTrackKeyRef.current = trackKey;
  }, [state]);

  const getPlayUrl = useCallback((source: UnifiedSource, trackIdx: number): string | null => {
    if (source.playlist) {
      const tracks = getPlaylistTracks(source.playlist);
      const t = tracks[trackIdx] ?? tracks[0];
      return t?.url ?? source.url ?? null;
    }
    return source.url;
  }, []);

  const isEmbeddedSource = useCallback((source: UnifiedSource, trackIdx: number): boolean => {
    if (source.playlist) {
      const tracks = getPlaylistTracks(source.playlist);
      const t = tracks[trackIdx] ?? tracks[0];
      return t ? canEmbedInCard(t.type) : canEmbedInCard(source.type as "youtube" | "soundcloud");
    }
    if (source.source) return supportsEmbedded(source.source);
    return source.type === "youtube" || source.type === "soundcloud";
  }, []);

  const currentPlayUrl = state.currentSource
    ? getPlayUrl(state.currentSource, state.currentTrackIndex)
    : null;
  const isEmbedded = state.currentSource
    ? isEmbeddedSource(state.currentSource, state.currentTrackIndex)
    : false;

  const stopAllPlayersRef = useRef<(() => void) | null>(null);

  const registerStopAllPlayers = useCallback((fn: () => void) => {
    stopAllPlayersRef.current = fn;
    return () => {
      if (stopAllPlayersRef.current === fn) stopAllPlayersRef.current = null;
    };
  }, []);

  /** Stop all known players: embedded YT/SC, local Winamp. Call before starting new source. */
  const stopAllBeforePlay = useCallback(() => {
    try {
      stopAllPlayersRef.current?.();
    } catch {
      /* ignore */
    }
    fetch("/api/commands/stop-local", { method: "POST" }).catch(() => {});
  }, []);

  const playLocal = useCallback((url: string, browserPreference?: string) => {
    fetch("/api/commands/play-local", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: url, browserPreference: browserPreference ?? "default" }),
    }).catch(() => {});
  }, []);

  const playSource = useCallback(
    (source: UnifiedSource, trackIndex = 0) => {
      const playlist = source.playlist ?? null;
      const tracks = playlist ? getPlaylistTracks(playlist) : [];
      const idx = Math.min(trackIndex, Math.max(0, tracks.length - 1));
      const track = tracks[idx] ?? null;
      const url = track?.url ?? source.url;

      if (playlist && tracks.length === 0) {
        mvpLog("empty_playlist", { id: source.id, title: source.title });
        setState((s) => ({ ...s, lastMessage: "Playlist is empty" }));
        return;
      }

      if (url && !isValidPlaybackUrl(url)) {
        mvpLog("invalid_url", { url, id: source.id, title: source.title });
        setState((s) => ({ ...s, lastMessage: "Invalid playback URL" }));
        return;
      }

      const isRadioOrStream =
        source.origin === "radio" ||
        (source.type === "stream-url" && url?.startsWith("http"));
      const embedded =
        isRadioOrStream ||
        (playlist && track ? canEmbedInCard(track.type) : source.type === "youtube" || source.type === "soundcloud");

      stopAllBeforePlay();

      setState((s) => {
        const queue = s.queue.length > 0 ? s.queue : [source];
        const qi = queue.findIndex((x) => x.id === source.id);
        return {
          ...s,
          currentPlaylist: playlist,
          currentSource: source,
          currentTrackIndex: idx,
          currentTrack: unifiedToPlaybackTrack(source, idx),
          status: "playing",
          queue,
          queueIndex: qi >= 0 ? qi : 0,
          lastMessage: null,
        };
      });

      if (!embedded && url) {
        const browserPref = source.source?.browserPreference ?? "default";
        playLocal(url, browserPref);
      }
    },
    [stopAllBeforePlay, playLocal],
  );

  // Restore playback state from sessionStorage after refresh (e.g. Radio station)
  useEffect(() => {
    if (hasRestoredRef.current || state.currentSource) return;
    const persisted = loadPersistedPlayback();
    if (!persisted) return;
    hasRestoredRef.current = true;
    let cancelled = false;
    fetch("/api/sources/unified", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : []))
      .then((items: UnifiedSource[]) => {
        if (cancelled) return;
        const source = items.find((s) => s.id === persisted.sourceId);
        if (source) {
          setState((s) => ({ ...s, volume: persisted.volume }));
          playSource(source, persisted.trackIndex);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [playSource, state.currentSource]);

  const playPlaylist = useCallback(
    (playlist: Playlist, trackIndex = 0) => {
      const source: UnifiedSource = {
        id: `pl-${playlist.id}`,
        title: playlist.name,
        genre: playlist.genre || "Mixed",
        cover: playlist.thumbnail || playlist.cover || null,
        type: (playlist.tracks?.[trackIndex]?.type ?? playlist.type) as UnifiedSource["type"],
        url: playlist.url,
        origin: "playlist",
        playlist,
      };
      playSource(source, trackIndex);
    },
    [playSource],
  );

  const play = useCallback(() => {
    setState((s) => (s.currentSource ? { ...s, status: "playing" as const } : s));
  }, []);

  const pause = useCallback(() => {
    setState((s) => (s.currentSource ? { ...s, status: "paused" as const } : s));
  }, []);

  const stop = useCallback(() => {
    stopAllBeforePlay();
    setState((s) => ({
      ...s,
      status: "stopped" as const,
      currentSource: null,
      currentPlaylist: null,
      currentTrack: null,
      currentTrackIndex: 0,
      queueIndex: -1,
    }));
  }, [stopAllBeforePlay]);

  const getShuffledIndex = useCallback((len: number, current: number): number => {
    if (len <= 1) return 0;
    let next = Math.floor(Math.random() * len);
    while (next === current && len > 1) next = Math.floor(Math.random() * len);
    return next;
  }, []);

  const prev = useCallback(() => {
    setState((s) => {
      if (!s.currentSource) return s;
      const playlist = s.currentPlaylist;
      const tracks = playlist ? getPlaylistTracks(playlist) : [];
      const trackCount = tracks.length || 1;

      if (trackCount > 1 && s.currentTrackIndex > 0) {
        stopAllBeforePlay();
        const nextIdx = s.currentTrackIndex - 1;
        const track = tracks[nextIdx];
        const url = track?.url ?? s.currentSource.url;
        const embedded = track ? canEmbedInCard(track.type) : false;
        if (!embedded && url) {
          playLocal(url);
        }
        return {
          ...s,
          currentTrackIndex: nextIdx,
          currentTrack: unifiedToPlaybackTrack(s.currentSource, nextIdx),
          status: "playing" as const,
        };
      }

      if (s.queue.length > 1 && s.queueIndex > 0) {
        const prevSource = s.queue[s.queueIndex - 1];
        stopAllBeforePlay();
        playSource(prevSource);
        return s;
      }
      return s;
    });
  }, [stopAllBeforePlay, playLocal, playSource]);

  const next = useCallback(() => {
    setState((s) => {
      if (!s.currentSource) return s;
      const playlist = s.currentPlaylist;
      const tracks = playlist ? getPlaylistTracks(playlist) : [];
      const trackCount = tracks.length || 1;

      if (trackCount > 1 && s.currentTrackIndex < trackCount - 1) {
        stopAllBeforePlay();
        const nextIdx = s.shuffle ? getShuffledIndex(trackCount, s.currentTrackIndex) : s.currentTrackIndex + 1;
        const track = tracks[nextIdx];
        const url = track?.url ?? s.currentSource.url;
        const embedded = track ? canEmbedInCard(track.type) : false;
        if (!embedded && url) {
          playLocal(url);
        }
        return {
          ...s,
          currentTrackIndex: nextIdx,
          currentTrack: unifiedToPlaybackTrack(s.currentSource, nextIdx),
          status: "playing" as const,
        };
      }

      const atLastTrack = s.currentTrackIndex >= trackCount - 1;
      const atLastInQueue = s.queueIndex >= s.queue.length - 1 || s.queue.length <= 1;

      if (atLastTrack && s.repeat && trackCount >= 1) {
        stopAllBeforePlay();
        const track = tracks[0];
        const url = track?.url ?? s.currentSource.url;
        const embedded = track ? canEmbedInCard(track.type) : false;
        if (!embedded && url) {
          playLocal(url);
        }
        return {
          ...s,
          currentTrackIndex: 0,
          currentTrack: unifiedToPlaybackTrack(s.currentSource, 0),
          status: "playing" as const,
        };
      }

      if (s.queue.length >= 1 && atLastTrack) {
        const nextQueueIdx = s.shuffle
          ? getShuffledIndex(s.queue.length, atLastInQueue ? -1 : s.queueIndex)
          : atLastInQueue
            ? 0
            : s.queueIndex + 1;
        const nextSource = s.queue[nextQueueIdx % s.queue.length];
        if (nextSource) {
          stopAllBeforePlay();
          playSource(nextSource);
        }
        return s;
      }
      return s;
    });
  }, [stopAllBeforePlay, playLocal, playSource, getShuffledIndex]);

  const setVolume = useCallback((value: number) => {
    setState((s) => ({ ...s, volume: Math.max(0, Math.min(100, value)) }));
  }, []);

  const setShuffle = useCallback((value: boolean) => {
    setState((s) => ({ ...s, shuffle: value }));
  }, []);

  const toggleShuffle = useCallback(() => {
    setState((s) => ({ ...s, shuffle: !s.shuffle }));
  }, []);

  const setRepeat = useCallback((value: boolean) => {
    setState((s) => ({ ...s, repeat: value }));
  }, []);

  const toggleRepeat = useCallback(() => {
    setState((s) => ({ ...s, repeat: !s.repeat }));
  }, []);

  const setLastMessage = useCallback((message: string | null) => {
    setState((s) => ({ ...s, lastMessage: message }));
  }, []);

  const playSourceFromDb = useCallback(
    (source: Source) => {
      playSource(sourceToUnified(source));
    },
    [playSource],
  );

  const setQueue = useCallback((sources: UnifiedSource[]) => {
    setState((s) => ({ ...s, queue: sources }));
  }, []);

  const value = useMemo<PlaybackContextValue>(
    () => ({
      ...state,
      play,
      pause,
      stop,
      prev,
      next,
      setVolume,
      setShuffle,
      toggleShuffle,
      setRepeat,
      toggleRepeat,
      setLastMessage,
      playSource,
      playSourceFromDb,
      playPlaylist,
      setQueue,
      registerStopAllPlayers,
      currentPlayUrl,
      isEmbedded,
    }),
    [
      state,
      play,
      pause,
      stop,
      prev,
      next,
      setVolume,
      setShuffle,
      toggleShuffle,
      setRepeat,
      toggleRepeat,
      setLastMessage,
      playSource,
      playSourceFromDb,
      playPlaylist,
      setQueue,
      registerStopAllPlayers,
      currentPlayUrl,
      isEmbedded,
    ],
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
