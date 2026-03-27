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
import { canEmbedInCard, getYouTubeVideoId } from "./playlist-utils";
import { getShuffle, setShufflePreference } from "./mix-preferences";
import { supportsEmbedded, getSourceArtworkUrl } from "./player-utils";
import { getYouTubeThumbnail } from "./playlist-utils";
import { log as mvpLog } from "./mvp-logger";
import { isValidPlaybackUrl } from "./url-validation";
import { fetchUnifiedSourcesWithFallback } from "./unified-sources-client";
import { deviceModeAllowsLocalPlayback } from "./device-mode-guard";

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
  status: PlaybackStatus;
  volume: number;
  shuffle: boolean;
  repeat: boolean;
  lastMessage: string | null;
  /** All playlists/sources for next/prev between items */
  queue: UnifiedSource[];
  queueIndex: number;
};

/** Derived from currentSource + currentTrackIndex – single source of truth, never stored separately */
function deriveCurrentTrack(source: UnifiedSource | null, trackIndex: number): PlaybackTrack | null {
  return source ? unifiedToPlaybackTrack(source, trackIndex) : null;
}

type PlaybackContextValue = PlaybackState & {
  currentTrack: PlaybackTrack | null;
  play: () => void;
  pause: () => void;
  stop: () => void;
  prev: () => void;
  next: (opts?: { skipPlay?: boolean } | unknown) => void;
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
  replaceSource: (tempId: string, real: UnifiedSource) => void;
  registerStopAllPlayers: (fn: () => void) => () => void;
  /** Seek to position (seconds). Used by remote control. AudioPlayer registers implementation. */
  seekTo: (seconds: number) => void;
  registerSeekCallback: (fn: (seconds: number) => void) => () => void;
  reportRecoveryProgress: (seconds: number) => void;
  currentPlayUrl: string | null;
  isEmbedded: boolean;
  /** Next direct-audio URL for crossfade. Null if next is embedded or no next. */
  getNextStreamUrl: () => string | null;
  /** Next embedded source for YouTube AutoMix crossfade. Null if no next YouTube. YouTube only in Phase 1. */
  getNextEmbeddedSource: () => { type: "youtube"; url: string; videoId: string } | null;
};

const PlaybackContext = createContext<PlaybackContextValue | null>(null);

const STORAGE_KEY = "syncbiz-playback";
const RECOVERY_STORAGE_KEY = "syncbiz-playback-recovery-v2";
const RECOVERY_TTL_MS = 1000 * 60 * 60 * 24;
const RECOVERY_AUTOPLAY_WINDOW_MS = 1000 * 60 * 30;

type PersistedPlaybackV2 = {
  currentSourceId: string;
  queueIds: string[];
  queueIndex: number;
  trackIndex: number;
  status: PlaybackStatus;
  volume: number;
  positionSeconds: number;
  updatedAt: number;
};

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

function loadPersistedPlaybackV2(): PersistedPlaybackV2 | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(RECOVERY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedPlaybackV2>;
    if (!parsed?.currentSourceId || !Array.isArray(parsed.queueIds)) return null;
    const status = parsed.status;
    if (!(status === "playing" || status === "paused")) return null;
    const updatedAt = typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0;
    if (!updatedAt || Date.now() - updatedAt > RECOVERY_TTL_MS) return null;
    return {
      currentSourceId: parsed.currentSourceId,
      queueIds: parsed.queueIds.filter((x): x is string => typeof x === "string"),
      queueIndex: typeof parsed.queueIndex === "number" ? parsed.queueIndex : -1,
      trackIndex: typeof parsed.trackIndex === "number" ? parsed.trackIndex : 0,
      status,
      volume: typeof parsed.volume === "number" ? Math.max(0, Math.min(100, parsed.volume)) : 80,
      positionSeconds: typeof parsed.positionSeconds === "number" ? Math.max(0, parsed.positionSeconds) : 0,
      updatedAt,
    };
  } catch {
    return null;
  }
}

function clearPersistedPlaybackV2() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(RECOVERY_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function savePersistedPlaybackV2(payload: PersistedPlaybackV2) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(RECOVERY_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

export function PlaybackProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PlaybackState>({
    currentPlaylist: null,
    currentSource: null,
    currentTrackIndex: 0,
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

  useEffect(() => {
    const saved = getShuffle();
    setState((s) => (s.shuffle !== saved ? { ...s, shuffle: saved } : s));
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
  const currentTrack = deriveCurrentTrack(state.currentSource, state.currentTrackIndex);
  useEffect(() => {
    const { status, currentSource, currentTrackIndex } = state;
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
  const seekCallbackRef = useRef<((seconds: number) => void) | null>(null);
  const pendingSeekOnRestoreRef = useRef<number | null>(null);
  const recoveryPositionRef = useRef<number>(0);
  const lastRecoveryWriteAtRef = useRef<number>(0);
  const transportLockRef = useRef(false);

  useEffect(() => {
    transportLockRef.current = false;
  }, [state.currentTrackIndex, state.currentSource?.id, state.queueIndex]);

  const registerStopAllPlayers = useCallback((fn: () => void) => {
    stopAllPlayersRef.current = fn;
    return () => {
      if (stopAllPlayersRef.current === fn) stopAllPlayersRef.current = null;
    };
  }, []);

  const registerSeekCallback = useCallback((fn: (seconds: number) => void) => {
    seekCallbackRef.current = fn;
    if (pendingSeekOnRestoreRef.current != null) {
      fn(pendingSeekOnRestoreRef.current);
      pendingSeekOnRestoreRef.current = null;
    }
    return () => {
      if (seekCallbackRef.current === fn) seekCallbackRef.current = null;
    };
  }, []);

  const seekTo = useCallback((seconds: number) => {
    seekCallbackRef.current?.(seconds);
  }, []);

  const persistRecoverySnapshot = useCallback((overridePositionSeconds?: number) => {
    const src = state.currentSource;
    if (!src || (state.status !== "playing" && state.status !== "paused")) {
      clearPersistedPlaybackV2();
      return;
    }
    const pos = Number.isFinite(overridePositionSeconds)
      ? (overridePositionSeconds as number)
      : recoveryPositionRef.current;
    savePersistedPlaybackV2({
      currentSourceId: src.id,
      queueIds: state.queue.map((q) => q.id),
      queueIndex: state.queueIndex,
      trackIndex: state.currentTrackIndex,
      status: state.status,
      volume: state.volume,
      positionSeconds: Math.max(0, pos),
      updatedAt: Date.now(),
    });
  }, [state.currentSource, state.queue, state.queueIndex, state.currentTrackIndex, state.status, state.volume]);

  const reportRecoveryProgress = useCallback((seconds: number) => {
    if (!Number.isFinite(seconds)) return;
    recoveryPositionRef.current = Math.max(0, seconds);
    const now = Date.now();
    if (now - lastRecoveryWriteAtRef.current < 2000) return;
    lastRecoveryWriteAtRef.current = now;
    persistRecoverySnapshot(recoveryPositionRef.current);
  }, [persistRecoverySnapshot]);

  useEffect(() => {
    persistRecoverySnapshot();
  }, [persistRecoverySnapshot]);

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
    // play-local runs on server and opens URL there – useless on mobile
    if (typeof window !== "undefined" && window.location.pathname === "/mobile") {
      window.open(url, "_blank");
      return;
    }
    fetch("/api/commands/play-local", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: url, browserPreference: browserPreference ?? "default" }),
    }).catch(() => {});
  }, []);

  const playSource = useCallback(
    (source: UnifiedSource, trackIndex = 0) => {
      if (!deviceModeAllowsLocalPlayback.current) return;
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
    const persistedV2 = loadPersistedPlaybackV2();
    const persistedV1 = loadPersistedPlayback();
    if (!persistedV2 && !persistedV1) return;
    hasRestoredRef.current = true;
    let cancelled = false;
    fetchUnifiedSourcesWithFallback().then((items) => {
      if (cancelled) return;
      if (!deviceModeAllowsLocalPlayback.current) return;
      const byId = new Map(items.map((i) => [i.id, i] as const));
      if (persistedV2) {
        const restoredQueue = persistedV2.queueIds.map((id) => byId.get(id)).filter((s): s is UnifiedSource => !!s);
        const source =
          byId.get(persistedV2.currentSourceId) ??
          (persistedV2.queueIndex >= 0 ? restoredQueue[persistedV2.queueIndex] : undefined) ??
          restoredQueue[0];
        if (!source) {
          clearPersistedPlaybackV2();
          return;
        }
        recoveryPositionRef.current = persistedV2.positionSeconds;
        pendingSeekOnRestoreRef.current = persistedV2.positionSeconds;
        setState((s) => ({
          ...s,
          volume: persistedV2.volume,
          queue: restoredQueue.length > 0 ? restoredQueue : [source],
          queueIndex: restoredQueue.findIndex((q) => q.id === source.id),
          currentSource: source,
          currentPlaylist: source.playlist ?? null,
          currentTrackIndex: persistedV2.trackIndex,
          status: "paused",
        }));
        const shouldAutoplay =
          persistedV2.status === "playing" && Date.now() - persistedV2.updatedAt <= RECOVERY_AUTOPLAY_WINDOW_MS;
        if (shouldAutoplay) {
          setTimeout(() => {
            if (cancelled) return;
            playSource(source, persistedV2.trackIndex);
            setTimeout(() => {
              if (cancelled) return;
              const pending = pendingSeekOnRestoreRef.current;
              if (pending != null) {
                seekTo(pending);
                pendingSeekOnRestoreRef.current = null;
              }
            }, 350);
          }, 0);
        }
        return;
      }

      const source = items.find((s) => s.id === persistedV1!.sourceId);
      if (source) {
        setState((s) => ({ ...s, volume: persistedV1!.volume }));
        playSource(source, persistedV1!.trackIndex);
      } else if (typeof window !== "undefined") {
        try {
          sessionStorage.removeItem(STORAGE_KEY);
        } catch {
          /* ignore */
        }
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [playSource, seekTo, state.currentSource]);

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
    if (!deviceModeAllowsLocalPlayback.current) return;
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

  /**
   * Returns the state update for a within-playlist track change.
   * Single atomic transition – ensures currentTrackIndex + status (playback intent) update together.
   */
  const getAdvanceState = useCallback((s: PlaybackState, trackIndex: number): PlaybackState => ({
    ...s,
    currentTrackIndex: trackIndex,
    status: "playing" as const,
  }), []);

  const prev = useCallback(() => {
    if (!deviceModeAllowsLocalPlayback.current) return;
    if (transportLockRef.current) return;
    transportLockRef.current = true;
    setState((s) => {
      if (!s.currentSource) {
        transportLockRef.current = false;
        return s;
      }
      const playlist = s.currentPlaylist;
      const tracks = playlist ? getPlaylistTracks(playlist) : [];
      const trackCount = tracks.length || 1;

      if (trackCount > 1 && s.currentTrackIndex > 0) {
        const nextIdx = s.currentTrackIndex - 1;
        const track = tracks[nextIdx];
        const url = track?.url ?? s.currentSource.url;
        const embedded = track ? canEmbedInCard(track.type) : false;
        if (!embedded && url) {
          stopAllBeforePlay();
          playLocal(url);
        }
        return getAdvanceState(s, nextIdx);
      }

      if (s.queue.length > 1 && s.queueIndex > 0) {
        const prevSource = s.queue[s.queueIndex - 1];
        queueMicrotask(() => {
          try {
            playSource(prevSource);
          } finally {
            transportLockRef.current = false;
          }
        });
        return s;
      }
      transportLockRef.current = false;
      return s;
    });
  }, [stopAllBeforePlay, playLocal, playSource, getAdvanceState]);

  const next = useCallback((opts?: { skipPlay?: boolean } | unknown) => {
    if (!deviceModeAllowsLocalPlayback.current) return;
    if (transportLockRef.current) return;
    const skipPlay = opts && typeof opts === "object" && "skipPlay" in opts && (opts as { skipPlay?: boolean }).skipPlay === true;
    transportLockRef.current = true;
    setState((s) => {
      if (!s.currentSource) {
        transportLockRef.current = false;
        return s;
      }
      const playlist = s.currentPlaylist;
      const tracks = playlist ? getPlaylistTracks(playlist) : [];
      const trackCount = tracks.length || 1;

      if (trackCount > 1 && s.currentTrackIndex < trackCount - 1) {
        const nextIdx = s.shuffle ? getShuffledIndex(trackCount, s.currentTrackIndex) : s.currentTrackIndex + 1;
        const track = tracks[nextIdx];
        const url = track?.url ?? s.currentSource.url;
        const embedded = track ? canEmbedInCard(track.type) : false;
        if (!skipPlay && !embedded && url) {
          stopAllBeforePlay();
          playLocal(url);
        }
        transportLockRef.current = false;
        return getAdvanceState(s, nextIdx);
      }

      const atLastTrack = s.currentTrackIndex >= trackCount - 1;
      const atLastInQueue = s.queueIndex >= s.queue.length - 1 || s.queue.length <= 1;

      if (atLastTrack && s.repeat && trackCount >= 1) {
        const track = tracks[0];
        const url = track?.url ?? s.currentSource.url;
        const embedded = track ? canEmbedInCard(track.type) : false;
        if (!skipPlay && !embedded && url) {
          stopAllBeforePlay();
          playLocal(url);
        }
        transportLockRef.current = false;
        return getAdvanceState(s, 0);
      }

      if (s.queue.length >= 1 && atLastTrack) {
        const nextQueueIdx = s.shuffle
          ? getShuffledIndex(s.queue.length, atLastInQueue ? -1 : s.queueIndex)
          : atLastInQueue
            ? 0
            : s.queueIndex + 1;
        const nextSource = s.queue[nextQueueIdx % s.queue.length];
        if (nextSource) {
          if (nextSource.id === s.currentSource.id && !s.repeat) {
            stop();
            transportLockRef.current = false;
            return s;
          }
          if (!skipPlay) {
            queueMicrotask(() => {
              try {
                playSource(nextSource);
              } finally {
                transportLockRef.current = false;
              }
            });
          } else {
            transportLockRef.current = false;
            return {
              ...s,
              currentSource: nextSource,
              currentPlaylist: nextSource.playlist ?? s.currentPlaylist,
              currentTrackIndex: 0,
              queueIndex: nextQueueIdx % s.queue.length,
              status: "playing" as const,
            };
          }
        }
        return s;
      }
      transportLockRef.current = false;
      return s;
    });
  }, [stopAllBeforePlay, playLocal, playSource, getShuffledIndex, getAdvanceState, stop]);

  const getNextStreamUrl = useCallback((): string | null => {
    return (() => {
      const s = state;
      if (!s.currentSource) return null;
      const playlist = s.currentPlaylist;
      const tracks = playlist ? getPlaylistTracks(playlist) : [];
      const trackCount = tracks.length || 1;

      if (trackCount > 1 && s.currentTrackIndex < trackCount - 1) {
        const nextIdx = s.shuffle ? getShuffledIndex(trackCount, s.currentTrackIndex) : s.currentTrackIndex + 1;
        const track = tracks[nextIdx];
        const url = track?.url ?? s.currentSource.url;
        const embedded = track ? canEmbedInCard(track.type) : false;
        return !embedded && url ? url : null;
      }

      const atLastTrack = s.currentTrackIndex >= trackCount - 1;
      const atLastInQueue = s.queueIndex >= s.queue.length - 1 || s.queue.length <= 1;

      if (atLastTrack && s.repeat && trackCount >= 1) {
        const track = tracks[0];
        const url = track?.url ?? s.currentSource.url;
        const embedded = track ? canEmbedInCard(track.type) : false;
        return !embedded && url ? url : null;
      }

      if (s.queue.length >= 1 && atLastTrack) {
        const nextQueueIdx = s.shuffle
          ? getShuffledIndex(s.queue.length, atLastInQueue ? -1 : s.queueIndex)
          : atLastInQueue
            ? 0
            : s.queueIndex + 1;
        const nextSource = s.queue[nextQueueIdx % s.queue.length];
        if (nextSource && nextSource.id !== s.currentSource.id) {
          const t = unifiedToPlaybackTrack(nextSource, 0);
          const embedded = t ? canEmbedInCard(t.type) : false;
          return !embedded && t?.url ? t.url : null;
        }
      }
      return null;
    })();
  }, [state, getShuffledIndex]);

  /** Next embedded source for YouTube AutoMix. Returns YouTube only (Phase 1). */
  const getNextEmbeddedSource = useCallback((): { type: "youtube"; url: string; videoId: string } | null => {
    const s = state;
    if (!s.currentSource) return null;
    const playlist = s.currentPlaylist;
    const tracks = playlist ? getPlaylistTracks(playlist) : [];
    const trackCount = tracks.length || 1;

    if (trackCount > 1 && s.currentTrackIndex < trackCount - 1) {
      const nextIdx = s.shuffle ? getShuffledIndex(trackCount, s.currentTrackIndex) : s.currentTrackIndex + 1;
      const track = tracks[nextIdx];
      const url = track?.url ?? s.currentSource.url;
      const embedded = track ? canEmbedInCard(track.type) : false;
      if (embedded && url && track?.type === "youtube") {
        const videoId = getYouTubeVideoId(url);
        return videoId ? { type: "youtube", url, videoId } : null;
      }
      return null;
    }

    const atLastTrack = s.currentTrackIndex >= trackCount - 1;
    const atLastInQueue = s.queueIndex >= s.queue.length - 1 || s.queue.length <= 1;

    if (atLastTrack && s.repeat && trackCount >= 1) {
      const track = tracks[0];
      const url = track?.url ?? s.currentSource.url;
      const embedded = track ? canEmbedInCard(track.type) : false;
      if (embedded && url && track?.type === "youtube") {
        const videoId = getYouTubeVideoId(url);
        return videoId ? { type: "youtube", url, videoId } : null;
      }
      return null;
    }

    if (s.queue.length >= 1 && atLastTrack) {
      const nextQueueIdx = s.shuffle
        ? getShuffledIndex(s.queue.length, atLastInQueue ? -1 : s.queueIndex)
        : atLastInQueue
          ? 0
          : s.queueIndex + 1;
      const nextSource = s.queue[nextQueueIdx % s.queue.length];
      if (nextSource && nextSource.id !== s.currentSource.id) {
        const t = unifiedToPlaybackTrack(nextSource, 0);
        const embedded = t ? canEmbedInCard(t.type) : false;
        if (embedded && t?.url && t.type === "youtube") {
          const videoId = getYouTubeVideoId(t.url);
          return videoId ? { type: "youtube", url: t.url, videoId } : null;
        }
      }
    }
    return null;
  }, [state, getShuffledIndex]);

  const setVolume = useCallback((value: number) => {
    setState((s) => ({ ...s, volume: Math.max(0, Math.min(100, value)) }));
  }, []);

  const setShuffle = useCallback((value: boolean) => {
    setShufflePreference(value);
    setState((s) => ({ ...s, shuffle: value }));
  }, []);

  const toggleShuffle = useCallback(() => {
    setState((s) => {
      const next = !s.shuffle;
      setShufflePreference(next);
      return { ...s, shuffle: next };
    });
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
    setState((s) => {
      if (
        s.queue.length > 0 &&
        (s.status === "playing" || s.status === "paused") &&
        s.currentSource &&
        !sources.some((x) => x.id === s.currentSource!.id)
      ) {
        return s;
      }
      const qi = s.currentSource ? sources.findIndex((x) => x.id === s.currentSource!.id) : -1;
      return {
        ...s,
        queue: sources,
        queueIndex: qi >= 0 ? qi : -1,
      };
    });
  }, []);

  /** Replace a temp source with the real one (e.g. after API create). Atomic update for queue + currentSource. */
  const replaceSource = useCallback((tempId: string, real: UnifiedSource) => {
    setState((s) => {
      const newQueue = s.queue.map((x) => (x.id === tempId ? real : x));
      const newCurrentSource = s.currentSource?.id === tempId ? real : s.currentSource;
      const qi = newCurrentSource ? newQueue.findIndex((x) => x.id === newCurrentSource.id) : -1;
      return {
        ...s,
        currentSource: newCurrentSource ?? s.currentSource,
        queue: newQueue,
        queueIndex: qi >= 0 ? qi : s.queueIndex,
      };
    });
  }, []);

  const value = useMemo<PlaybackContextValue>(
    () => ({
      ...state,
      currentTrack,
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
      replaceSource,
      registerStopAllPlayers,
      seekTo,
      registerSeekCallback,
      reportRecoveryProgress,
      currentPlayUrl,
      isEmbedded,
      getNextStreamUrl,
      getNextEmbeddedSource,
    }),
    [
      state,
      currentTrack,
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
      replaceSource,
      registerStopAllPlayers,
      seekTo,
      registerSeekCallback,
      reportRecoveryProgress,
      currentPlayUrl,
      isEmbedded,
      getNextStreamUrl,
      getNextEmbeddedSource,
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
