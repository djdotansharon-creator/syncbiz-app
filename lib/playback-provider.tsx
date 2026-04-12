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
import {
  canEmbedInCard,
  canonicalYouTubeWatchUrlForPlayback,
  effectivePlaybackPlaylistAttachment,
  getYouTubeThumbnail,
  getYouTubeVideoId,
  isYouTubeMultiTrackUrl,
  unifiedPlaylistSourceId,
} from "./playlist-utils";
import { getShuffle, setShufflePreference } from "./mix-preferences";
import { supportsEmbedded, getSourceArtworkUrl } from "./player-utils";
import { log as mvpLog } from "./mvp-logger";
import {
  syncbizAuditCurrentSourceTransition,
  syncbizAuditNextInvoked,
  syncbizAuditPlaySourceInvoked,
  syncbizAuditQueueIndexTransition,
  syncbizAuditTrackChangedEmit,
  syncbizAuditTransportTransitionStart,
} from "./syncbiz-transport-audit";
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
  const plAttach = effectivePlaybackPlaylistAttachment(source);
  if (plAttach) {
    const tracks = getPlaylistTracks(plAttach);
    const t = tracks[trackIndex] ?? tracks[0];
    const title = t?.name ?? (t as { title?: string })?.title ?? source.title;
    const type = (t?.type ?? source.type) as TrackSource;
    const url = canonicalYouTubeWatchUrlForPlayback(t?.url ?? source.url);
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
    url: canonicalYouTubeWatchUrlForPlayback(source.url),
    cover: source.cover,
  };
}

export function sourceToUnified(s: Source): UnifiedSource {
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

/** AUDIT: scheduled non-embedded play vs first natural auto-advance — stale queue proof (no behavior change). */
function logScheduledQueueReuseProof(
  snap: Pick<PlaybackState, "currentSource" | "currentPlaylist" | "queue" | "queueIndex" | "currentTrackIndex">,
  payload: {
    reason: "scheduled_non_embedded_start" | "after_first_natural_auto_advance";
    sourceHasPlaylistPayload: boolean | null;
    fromScheduledPlay: boolean;
    nextSelectedSourceId: string | null;
  },
) {
  console.log("[SyncBiz Audit] scheduled_queue_reuse_proof", {
    reason: payload.reason,
    currentSourceId: snap.currentSource?.id ?? null,
    currentPlaylistId: snap.currentPlaylist?.id ?? null,
    currentPlaylistName: snap.currentPlaylist?.name ?? null,
    queueIds: snap.queue.map((q) => q.id),
    queueLength: snap.queue.length,
    queueIndex: snap.queueIndex,
    currentTrackIndex: snap.currentTrackIndex,
    sourceHasPlaylistPayload: payload.sourceHasPlaylistPayload,
    fromScheduledPlay: payload.fromScheduledPlay,
    nextSelectedSourceId: payload.nextSelectedSourceId,
  });
}

/**
 * Session bounds for NEXT/PREV: `fromSource` = effective attachment on current source;
 * `snap` = `currentPlaylist`. If both exist, ids match, and snap has more resolved tracks
 * than fromSource, return snap; else fromSource if present, else snap.
 */
function getActivePlaylist(s: Pick<PlaybackState, "currentSource" | "currentPlaylist">): Playlist | null {
  const fromSource = s.currentSource ? effectivePlaybackPlaylistAttachment(s.currentSource) : null;
  const snap = s.currentPlaylist ?? null;
  const fromLen = fromSource ? getPlaylistTracks(fromSource).length : 0;
  const snapLen = snap ? getPlaylistTracks(snap).length : 0;
  const idsMatch = !!(fromSource && snap && fromSource.id === snap.id);
  const snapRawTracksArrayLen = snap?.tracks?.length ?? 0;
  const snapOrderLen = snap?.order?.length ?? 0;
  let snapOrderIdsMissingFromTracks = 0;
  if (snap?.tracks && snap.tracks.length > 0 && snap.order && snap.order.length > 0) {
    const idSet = new Set(snap.tracks.map((t) => t.id));
    for (const id of snap.order) {
      if (!idSet.has(id)) snapOrderIdsMissingFromTracks += 1;
    }
  }
  const fromRawTracksArrayLen = fromSource?.tracks?.length ?? 0;

  let chosen: Playlist | null;
  let reasonChosen: string;
  if (fromSource && snap && fromSource.id === snap.id && snapLen > fromLen) {
    chosen = snap;
    reasonChosen = "reconcile_snap_richer_same_id";
  } else if (fromSource) {
    chosen = fromSource;
    if (!snap) reasonChosen = "prefer_fromSource_no_snap";
    else if (!idsMatch) reasonChosen = "prefer_fromSource_id_mismatch";
    else reasonChosen = "prefer_fromSource_snap_not_richer";
  } else {
    chosen = snap;
    reasonChosen = snap ? "snap_only" : "null";
  }

  const chosenLabel = chosen === snap ? "snap" : chosen === fromSource ? "fromSource" : "null";

  console.log("[SyncBiz Audit] getActivePlaylist decision", {
    fromSourceExists: !!fromSource,
    snapExists: !!snap,
    fromSourceId: fromSource?.id ?? null,
    snapId: snap?.id ?? null,
    idsMatch,
    reconcileWouldApply: !!(fromSource && snap && idsMatch && snapLen > fromLen),
  });
  console.log("[SyncBiz Audit] getActivePlaylist candidate lengths", {
    getPlaylistTracksFromSourceLen: fromLen,
    getPlaylistTracksSnapLen: snapLen,
    fromRawTracksArrayLen,
    snapRawTracksArrayLen,
    totalRawTracksArrayLen: snapRawTracksArrayLen,
    snapOrderLen,
    snapOrderIdsMissingFromTracks,
    snapHasResolvedTracksGt1: snapLen > 1,
    snapTracksArrayGt1: snapRawTracksArrayLen > 1,
    fromShellLikely: fromRawTracksArrayLen === 0 && fromLen <= 1,
    snapShellLikely: snapRawTracksArrayLen === 0 && snapLen <= 1,
  });
  console.log("[SyncBiz Audit] getActivePlaylist chosen source", {
    chosen: chosenLabel,
    chosenId: chosen?.id ?? null,
    reasonChosen,
  });

  return chosen;
}

function getPlaylistSessionTracks(s: Pick<PlaybackState, "currentSource" | "currentPlaylist">) {
  const pl = getActivePlaylist(s);
  return pl ? getPlaylistTracks(pl) : [];
}

type SessionNextKind = "advance" | "restart" | "exhausted";

/**
 * Next index within the active playlist session only. No global queue / no jump to another top-level source.
 * Session always loops at end; exhausted only when trackCount is 0.
 * UI repeat flag does not disable session loop (passed for API compatibility).
 */
function computeSessionNextTrackIndex(
  trackCount: number,
  currentIndex: number,
  shuffle: boolean,
  _repeat: boolean,
  getShuffledIndex: (len: number, current: number) => number,
): { kind: SessionNextKind; nextIndex: number } {
  if (trackCount < 1) return { kind: "exhausted", nextIndex: 0 };
  const safeCount = trackCount;
  const capped = Math.min(Math.max(0, currentIndex), safeCount - 1);

  if (safeCount === 1) {
    return { kind: "restart", nextIndex: 0 };
  }

  if (capped < safeCount - 1) {
    const nextIdx = shuffle ? getShuffledIndex(safeCount, capped) : capped + 1;
    return { kind: "advance", nextIndex: nextIdx };
  }

  const nextIdx = shuffle ? getShuffledIndex(safeCount, capped) : 0;
  return { kind: "restart", nextIndex: nextIdx };
}

/**
 * Product contract: autonomous transport never leaves the active playlist/session for another queued
 * top-level source. Global queue is not used for next/prev (schedule takeover uses stop + playSource).
 * @deprecated Kept only so audit call sites stay readable; always false.
 */
function preferQueueTransportOverCollapsedSession(
  _s: PlaybackState,
  _sessionTrackCount: number,
  _direction: "next" | "prev",
): boolean {
  return false;
}

/** TEMP audit: mirrors reasons in `effectivePlaybackPlaylistAttachment` (playlist-utils). */
function effectiveAttachmentAuditReason(source: UnifiedSource | null): string {
  if (!source?.playlist) return "no_playlist_on_source";
  if (source.origin === "playlist") return "uses_source.playlist_origin_playlist";
  const url = source.url ?? "";
  if (String(source.type) === "playlist_url") return "suppress_type_playlist_url";
  if (/youtube\.com\/playlist/i.test(url)) return "suppress_youtube_playlist_page";
  if (isYouTubeMultiTrackUrl(url)) return "suppress_youtube_multi_track";
  return "uses_source.playlist_non_playlist_origin";
}

function emitPlaylistSessionAudit(
  s: PlaybackState,
  ctx: {
    transport: "prev" | "next";
    auditTransportCase?: "ended_auto";
    skipPlay?: boolean;
  }
) {
  const playbackStatus = s.status;
  let transportCase: string;
  if (ctx.transport === "prev") {
    transportCase =
      s.status === "paused"
        ? "manual_prev_paused"
        : s.status === "playing"
          ? "manual_prev_playing"
          : `manual_prev_${s.status}`;
  } else if (ctx.auditTransportCase === "ended_auto") {
    transportCase = "natural_end_auto_advance";
  } else if (s.status === "paused") {
    transportCase = "manual_next_paused";
  } else if (s.status === "playing") {
    transportCase = "manual_next_playing";
  } else {
    transportCase = `manual_next_${s.status}`;
  }

  const eff = s.currentSource ? effectivePlaybackPlaylistAttachment(s.currentSource) : null;
  const snap = s.currentPlaylist;
  const effReason = effectiveAttachmentAuditReason(s.currentSource);
  const active = getActivePlaylist(s);

  console.log("[SyncBiz Audit] playlist resolution source", {
    playbackStatus,
    transportCase,
    transport: ctx.transport,
    skipPlay: ctx.skipPlay ?? false,
    currentSourceId: s.currentSource?.id ?? null,
    origin: s.currentSource?.origin ?? null,
    sourceUrlSnippet: s.currentSource?.url?.slice(0, 120) ?? null,
    playlistObjectOnSourceId: s.currentSource?.playlist?.id ?? null,
    rawTracksOnSourcePlaylist: s.currentSource?.playlist?.tracks?.length ?? 0,
    effectiveAttachmentResultId: eff?.id ?? null,
    effectiveAttachmentResolvedLen: eff ? getPlaylistTracks(eff).length : 0,
    attachmentAuditReason: effReason,
  });

  console.log("[SyncBiz Audit] playlist snapshot resolution", {
    playbackStatus,
    transportCase,
    currentPlaylistSnapshotId: snap?.id ?? null,
    snapshotRawTracksLen: snap?.tracks?.length ?? 0,
    snapshotOrderLen: snap?.order?.length ?? 0,
    snapshotResolvedLen: snap ? getPlaylistTracks(snap).length : 0,
  });

  const pickedFrom =
    eff != null ? "effective_attachment_wins" : snap != null ? "snapshot_only" : "none";
  console.log("[SyncBiz Audit] session source builder", {
    playbackStatus,
    transportCase,
    activePlaylistId: active?.id ?? null,
    currentPlaylistSnapshotId: snap?.id ?? null,
    currentSourceId: s.currentSource?.id ?? null,
    pickedFrom,
    effectiveVsSnapshotSameId: eff?.id === snap?.id,
    effectiveVsSnapshotBothPresent: !!eff && !!snap,
    noteIfMismatch:
      eff && snap && eff.id !== snap.id
        ? "getActivePlaylist_prefers_attachment_id_over_snapshot"
        : null,
  });

  if (active) {
    const raw = active.tracks?.length ?? 0;
    const resolved = getPlaylistTracks(active);
    const legacy = !(active.tracks && active.tracks.length > 0);
    const orderMismatch =
      raw > 0 && resolved.length < raw ? "order_references_missing_track_ids" : null;
    console.log("[SyncBiz Audit] sessionTracks build result", {
      playbackStatus,
      transportCase,
      playlistIdUsedForSession: active.id,
      currentSourceId: s.currentSource?.id ?? null,
      totalRawTracksArrayLen: raw,
      legacySingleTrackShell: legacy,
      tracksCountAfterMapping: resolved.length,
      orderArrayLen: active.order?.length ?? 0,
      possibleExclusion: orderMismatch ?? (legacy ? "legacy_fallback_single_synthetic_track" : null),
      firstThree: resolved.slice(0, 3).map((t) => ({
        id: t.id,
        url: typeof t.url === "string" ? t.url.slice(0, 100) : "",
      })),
    });
  } else {
    console.log("[SyncBiz Audit] sessionTracks build result", {
      playbackStatus,
      transportCase,
      playlistIdUsedForSession: null,
      currentSourceId: s.currentSource?.id ?? null,
      totalRawTracksArrayLen: 0,
      legacySingleTrackShell: null,
      tracksCountAfterMapping: 0,
      possibleExclusion: "no_active_playlist_object",
      firstThree: [] as { id: string; url: string }[],
    });
  }
}

type PlaybackContextValue = PlaybackState & {
  currentTrack: PlaybackTrack | null;
  play: () => void;
  pause: () => void;
  stop: () => void;
  /**
   * Clears this tab’s queue/embeds like `stop()` but does not POST `/api/commands/stop-local`.
   * Used when this tab becomes branch CONTROL so a co-located MASTER’s OS/shell playback is not killed.
   */
  stopForControlHandoff: () => void;
  prev: () => void;
  next: (opts?: { skipPlay?: boolean; auditTransportCase?: "ended_auto" } | unknown) => void;
  setVolume: (value: number) => void;
  setShuffle: (value: boolean) => void;
  toggleShuffle: () => void;
  setRepeat: (value: boolean) => void;
  toggleRepeat: () => void;
  setLastMessage: (message: string | null) => void;
  playSource: (source: UnifiedSource, trackIndex?: number) => void;
  playSourceFromDb: (source: Source, opts?: { auditScheduledNonEmbedded?: boolean }) => void;
  playPlaylist: (playlist: Playlist, trackIndex?: number) => void;
  setQueue: (sources: UnifiedSource[], opts?: { force?: boolean }) => void;
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
      syncbizAuditTrackChangedEmit({
        id: currentSource?.id ?? null,
        trackIndex: currentTrackIndex,
        trackKey,
        prevTrackKey: prevTrackKeyRef.current,
      });
    }
    prevStatusRef.current = status;
    prevTrackKeyRef.current = trackKey;
  }, [state]);

  const getPlayUrl = useCallback((source: UnifiedSource, trackIdx: number): string | null => {
    if (source.playlist) {
      const tracks = getPlaylistTracks(source.playlist);
      const t = tracks[trackIdx] ?? tracks[0];
      const raw = t?.url ?? source.url ?? null;
      return raw ? canonicalYouTubeWatchUrlForPlayback(raw) : null;
    }
    return canonicalYouTubeWatchUrlForPlayback(source.url);
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

  /** TEMP: one-screen runtime audit for transport — pair `*_entry_state_before` with `*_state_after_transition`. */
  const logRuntimePlaybackAudit = useCallback(
    (
      snapshot: PlaybackState,
      step: {
        transport: "next";
        phase: string;
        auditTransportCase?: "ended_auto" | null;
        extra?: Record<string, unknown>;
      },
    ) => {
      const ap = getActivePlaylist(snapshot);
      const st = getPlaylistSessionTracks(snapshot);
      const cpu = snapshot.currentSource ? getPlayUrl(snapshot.currentSource, snapshot.currentTrackIndex) : null;
      console.log("[SyncBiz Audit] runtime path step", {
        transport: step.transport,
        phase: step.phase,
        auditTransportCase: step.auditTransportCase ?? null,
        playbackStatus: snapshot.status,
        ...step.extra,
      });
      console.log("[SyncBiz Audit] runtime currentSource", {
        id: snapshot.currentSource?.id ?? null,
        origin: snapshot.currentSource?.origin ?? null,
        sourcePlaylistId: snapshot.currentSource?.playlist?.id ?? null,
      });
      console.log("[SyncBiz Audit] runtime currentPlaylist", {
        id: snapshot.currentPlaylist?.id ?? null,
        rawTracksLen: snapshot.currentPlaylist?.tracks?.length ?? 0,
      });
      console.log("[SyncBiz Audit] runtime activePlaylist", {
        id: ap?.id ?? null,
        getPlaylistTracksLen: ap ? getPlaylistTracks(ap).length : 0,
      });
      console.log("[SyncBiz Audit] runtime sessionTracks final", {
        len: st.length,
        firstThreeIds: st.slice(0, 3).map((t) => t.id),
      });
      console.log("[SyncBiz Audit] runtime currentPlayUrl final", {
        url: cpu ? cpu.slice(0, 200) : null,
      });
    },
    [getPlayUrl],
  );

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
  /** Pre-invocation playback snapshot for audits (e.g. schedule Play now before playSource mutates state). */
  const playbackStateForAuditRef = useRef(state);
  playbackStateForAuditRef.current = state;
  /** When true, next `ended_auto` transport logs one post-schedule advance proof then clears. */
  const scheduledQueueReuseAuditPendingRef = useRef(false);

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
    const target = canonicalYouTubeWatchUrlForPlayback(url);
    // play-local runs on server and opens URL there – useless on mobile
    if (typeof window !== "undefined" && window.location.pathname === "/mobile") {
      window.open(target, "_blank");
      return;
    }
    fetch("/api/commands/play-local", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: target, browserPreference: browserPreference ?? "default" }),
    }).catch(() => {});
  }, []);

  const playSource = useCallback(
    (source: UnifiedSource, trackIndex = 0) => {
      if (!deviceModeAllowsLocalPlayback.current) return;
      syncbizAuditPlaySourceInvoked({
        sourceId: source.id,
        trackIndex,
        via: "playSource",
      });

      const needsShellHydration =
        source.origin === "playlist" &&
        !!source.playlist?.id &&
        !(source.playlist.tracks && source.playlist.tracks.length > 0);

      console.log("[SyncBiz Audit] playSource shell hydration check", {
        sourceId: source.id,
        origin: source.origin,
        playlistId: source.playlist?.id ?? null,
        sourcePlaylistTracksLen: source.playlist?.tracks?.length ?? 0,
        needsShellHydration,
      });

      const runPlay = (
        resolved: UnifiedSource,
        hydrationPath: "sync" | "merged" | "shell_fallback" = "sync",
      ) => {
        const playlist = effectivePlaybackPlaylistAttachment(resolved);
        const tracks = playlist ? getPlaylistTracks(playlist) : [];
        console.log("[SyncBiz Audit] playSource runPlay session playlist snapshot", {
          hydrationPath,
          runPlayVariant: hydrationPath === "merged" ? "runPlay(merged)" : "runPlay(source)",
          resolvedSourceId: resolved.id,
          sessionPlaylistId: playlist?.id ?? null,
          getPlaylistTracksLen: tracks.length,
          rawTracksArrayLenOnPlaylist: playlist?.tracks?.length ?? 0,
        });
        console.log("[SyncBiz Audit] runtime path step", {
          transport: "playSource",
          phase: "runPlay",
          hydrationPath,
          resolvedSourceId: resolved.id,
          origin: resolved.origin,
        });
        let idx = Math.min(trackIndex, Math.max(0, tracks.length - 1));
        let track = tracks[idx] ?? null;
        const rawTrackIn = track?.url?.trim() ?? "";
        const rawResolved = resolved.url?.trim() ?? "";
        const rawTrack = rawTrackIn.startsWith("local://") ? "" : rawTrackIn;
        const rawRes = rawResolved.startsWith("local://") ? "" : rawResolved;
        let url = canonicalYouTubeWatchUrlForPlayback(rawTrack || rawRes);

        const urlPlayable = (u: string) =>
          !!u && !u.startsWith("local://") && isValidPlaybackUrl(u);

        if (!urlPlayable(url) && playlist && tracks.length > 0) {
          for (let i = 0; i < tracks.length; i++) {
            const raw = tracks[i]?.url?.trim() ?? "";
            if (!raw || raw.startsWith("local://")) continue;
            const cand = canonicalYouTubeWatchUrlForPlayback(raw);
            if (urlPlayable(cand)) {
              url = cand;
              idx = i;
              track = tracks[i] ?? null;
              break;
            }
          }
        }

        if (playlist && tracks.length === 0) {
          mvpLog("empty_playlist", { id: resolved.id, title: resolved.title });
          setState((s) => ({ ...s, lastMessage: "Playlist is empty" }));
          return;
        }

        if (!urlPlayable(url)) {
          mvpLog("invalid_url", { url: url || "(empty)", id: resolved.id, title: resolved.title });
          setState((s) => ({ ...s, lastMessage: "Invalid playback URL" }));
          return;
        }

        const isRadioOrStream =
          resolved.origin === "radio" ||
          (resolved.type === "stream-url" && url?.startsWith("http"));
        const embedded =
          isRadioOrStream ||
          (playlist && track ? canEmbedInCard(track.type) : resolved.type === "youtube" || resolved.type === "soundcloud");

        stopAllBeforePlay();

        setState((s) => {
          console.log("[SyncBiz Audit] playlist load start", {
            sourceId: resolved.id,
            origin: resolved.origin,
            playlistId: playlist?.id,
            trackIndex,
            resolvedTrackIndex: idx,
            queueLenBefore: s.queue.length,
            currentSourceId: s.currentSource?.id ?? null,
            isHydration: hasRestoredRef.current,
          });
          let queue =
            s.queue.length > 0 ? s.queue.map((q) => (q.id === resolved.id ? resolved : q)) : [resolved];
          let qi = queue.findIndex((x) => x.id === resolved.id);
          if (qi < 0) {
            mvpLog("playsource_queue_miss", {
              sourceId: resolved.id,
              queueLenBefore: queue.length,
            });
            console.log("[SyncBiz Audit] queue source miss", {
              sourceId: resolved.id,
              queueLenBefore: queue.length,
              queueIds: queue.map((q) => q.id),
            });
            queue = [...queue, resolved];
            qi = queue.length - 1;
          }
          console.log("[SyncBiz Audit] queue source resolve", {
            sourceId: resolved.id,
            playlistId: playlist?.id,
            queueLenAfter: queue.length,
            queueIndex: qi,
            currentTrackIndex: idx,
          });
          console.log("[SyncBiz Audit] persisted_playlist_to_session_proof", {
            playlistId: playlist?.id ?? null,
            title: playlist?.name ?? resolved.title,
            hasTracksArray: Array.isArray(playlist?.tracks),
            tracksCount: playlist?.tracks?.length ?? 0,
            resolvedLeafCount: tracks.length,
            queueLengthAfterConversion: queue.length,
            sessionAttachmentThin: !(
              playlist &&
              Array.isArray(playlist.tracks) &&
              playlist.tracks.length > 0
            ),
          });
          syncbizAuditQueueIndexTransition({
            from: s.queueIndex,
            to: qi,
            via: "playSource_runPlay_setState",
            extra: { resolvedSourceId: resolved.id },
          });
          syncbizAuditCurrentSourceTransition({
            fromId: s.currentSource?.id ?? null,
            toId: resolved.id,
            via: "playSource_runPlay_setState",
          });
          return {
            ...s,
            currentPlaylist: playlist,
            currentSource: resolved,
            currentTrackIndex: idx,
            status: "playing",
            queue,
            queueIndex: qi,
            lastMessage: null,
          };
        });

        if (!embedded && url) {
          const browserPref = resolved.source?.browserPreference ?? "default";
          playLocal(url, browserPref);
        }
      };

      if (needsShellHydration) {
        const pid = source.playlist!.id;
        const fetchUrl = `/api/playlists/${encodeURIComponent(pid)}`;
        void (async () => {
          if (!deviceModeAllowsLocalPlayback.current) return;
          try {
            console.log("[SyncBiz Audit] playSource shell hydration fetch_start", {
              fetchUrl,
              playlistId: pid,
              sourceId: source.id,
            });
            const res = await fetch(fetchUrl, {
              credentials: "include",
              cache: "no-store",
            });
            if (!res.ok) {
              console.log("[SyncBiz Audit] playSource shell hydration fetch_result", {
                fetchUrl,
                responseOk: res.ok,
                responseStatus: res.status,
                returnedPlaylistId: null as string | null,
                returnedTracksArrayLen: null as number | null,
              });
              console.log("[SyncBiz Audit] playSource shell hydration failed", {
                reason: "fetch_not_ok",
              });
              setState((s) => ({
                ...s,
                lastMessage: "Failed to load playlist for playback.",
              }));
              return;
            }
            let full: Playlist;
            try {
              full = (await res.json()) as Playlist;
            } catch {
              console.log("[SyncBiz Audit] playSource shell hydration fetch_result", {
                fetchUrl,
                responseOk: true,
                responseStatus: res.status,
                returnedPlaylistId: null,
                returnedTracksArrayLen: null,
                parseError: true,
              });
              console.log("[SyncBiz Audit] playSource shell hydration failed", {
                reason: "json_parse_failed",
              });
              setState((s) => ({
                ...s,
                lastMessage: "Failed to load playlist for playback.",
              }));
              return;
            }
            console.log("[SyncBiz Audit] playSource shell hydration fetch_result", {
              fetchUrl,
              responseOk: res.ok,
              responseStatus: res.status,
              returnedPlaylistId: full?.id ?? null,
              returnedTracksArrayLen: full?.tracks?.length ?? 0,
            });
            if (!full?.id) {
              console.log("[SyncBiz Audit] playSource shell hydration failed", {
                reason: "missing_playlist_id_in_body",
              });
              setState((s) => ({
                ...s,
                lastMessage: "Failed to load playlist for playback.",
              }));
              return;
            }
            const merged: UnifiedSource = { ...source, playlist: full };
            console.log("[SyncBiz Audit] playSource shell hydration applied", {
              runPlay: "runPlay(merged)",
              returnedPlaylistId: full.id,
              returnedTracksArrayLen: full.tracks?.length ?? 0,
              getPlaylistTracksLenAfterMerge: getPlaylistTracks(full).length,
            });
            runPlay(merged, "merged");
          } catch (e) {
            console.log("[SyncBiz Audit] playSource shell hydration failed", {
              reason: "fetch_exception",
              error: String(e),
            });
            setState((s) => ({
              ...s,
              lastMessage: "Failed to load playlist for playback.",
            }));
          }
        })();
        return;
      }

      runPlay(source, "sync");
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
      console.log("[SyncBiz Audit] hydration source map", {
        count: items.length,
        idsSample: items.slice(0, 10).map((i) => i.id),
      });
      if (persistedV2) {
        const restoredQueue = persistedV2.queueIds.map((id) => byId.get(id)).filter((s): s is UnifiedSource => !!s);
        const source =
          byId.get(persistedV2.currentSourceId) ??
          (persistedV2.queueIndex >= 0 ? restoredQueue[persistedV2.queueIndex] : undefined) ??
          restoredQueue[0];
        console.log("[SyncBiz Audit] current source lookup", {
          phase: "persistedV2",
          persistedCurrentSourceId: persistedV2.currentSourceId,
          persistedQueueIds: persistedV2.queueIds,
          restoredQueueLen: restoredQueue.length,
          foundSourceId: source?.id ?? null,
        });
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
        id: unifiedPlaylistSourceId(playlist.id),
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

  const stopForControlHandoff = useCallback(() => {
    try {
      stopAllPlayersRef.current?.();
    } catch {
      /* ignore */
    }
    setState((s) => ({
      ...s,
      status: "stopped" as const,
      currentSource: null,
      currentPlaylist: null,
      currentTrackIndex: 0,
      queueIndex: -1,
    }));
  }, []);

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
      const prevSourceId = s.currentSource?.id ?? null;
      const prevTrackIndex = s.currentTrackIndex;
      const prevQueueIndex = s.queueIndex;
      const prevQueueLength = s.queue.length;
      console.log("[SyncBiz Audit] PREV provider invoked", {
        phase: "before_prev",
        branch: "unknown",
        playbackStatus: s.status,
        currentSourceId: prevSourceId,
        currentTrackIndex: prevTrackIndex,
        queueIndex: prevQueueIndex,
        queueLength: prevQueueLength,
      });
      if (!s.currentSource) {
        transportLockRef.current = false;
        return s;
      }
      emitPlaylistSessionAudit(s, { transport: "prev" });
      const sessionTracks = getPlaylistSessionTracks(s);
      const curTrkPrev = sessionTracks[s.currentTrackIndex] ?? sessionTracks[0];
      if (
        sessionTracks.length > 0 &&
        !preferQueueTransportOverCollapsedSession(s, sessionTracks.length, "prev")
      ) {
        const trackCount = sessionTracks.length;
        const prevIdx =
          trackCount === 1
            ? 0
            : s.currentTrackIndex > 0
              ? s.currentTrackIndex - 1
              : trackCount - 1;
        console.log("[SyncBiz Audit] prev index calculation", {
          playbackStatus: s.status,
          currentSourceId: s.currentSource?.id ?? null,
          currentTrackIndex: s.currentTrackIndex,
          queueIndex: s.queueIndex,
          queueLength: s.queue.length,
          trackCount,
          sessionTracksLen: sessionTracks.length,
          prevIdx,
          indexUnchanged: prevIdx === s.currentTrackIndex,
          onlyOneSessionTrack: trackCount <= 1,
          firstThreeIds: sessionTracks.slice(0, 3).map((t) => (t as { id?: string }).id ?? "n/a"),
          selectedDiffersFromCurrent:
            trackCount > 0
              ? (sessionTracks[prevIdx] as { id?: string; url?: string } | undefined)?.id !==
                  (curTrkPrev as { id?: string } | undefined)?.id ||
                (sessionTracks[prevIdx] as { url?: string } | undefined)?.url !==
                  (curTrkPrev as { url?: string } | undefined)?.url
              : false,
        });
        const track = sessionTracks[prevIdx];
        const url = track?.url ?? s.currentSource.url;
        const embedded = track ? canEmbedInCard(track.type) : false;
        mvpLog("playback_prev", {
          scope: "playlist",
          playlistId: getActivePlaylist(s)?.id,
          trackCount,
          fromIndex: s.currentTrackIndex,
          toIndex: prevIdx,
        });
        console.log("[SyncBiz Audit] PREV provider invoked", {
          phase: "within_playlist_back",
          branch: "within_playlist_back",
          prevSourceId,
          nextSourceId: s.currentSource.id,
          prevTrackIndex,
          nextTrackIndex: prevIdx,
          prevQueueIndex,
          nextQueueIndex: s.queueIndex,
          queueLength: s.queue.length,
        });
        if (!embedded && url) {
          stopAllBeforePlay();
          playLocal(url);
        }
        transportLockRef.current = false;
        return getAdvanceState(s, prevIdx);
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
        transportLockRef.current = false;
        console.log("[SyncBiz Audit] PREV provider invoked", {
          phase: "playlist_fallback_back",
          branch: "playlist_fallback_back",
          prevSourceId,
          nextSourceId: s.currentSource.id,
          prevTrackIndex,
          nextTrackIndex: nextIdx,
          prevQueueIndex,
          nextQueueIndex: s.queueIndex,
          queueLength: s.queue.length,
        });
        return getAdvanceState(s, nextIdx);
      }

      mvpLog("playback_prev", { scope: "noop" });
      transportLockRef.current = false;
      console.log("[SyncBiz Audit] PREV provider invoked", {
        phase: "noop",
        branch: "noop",
        prevSourceId,
        nextSourceId: s.currentSource?.id ?? null,
        prevTrackIndex,
        nextTrackIndex: s.currentTrackIndex,
        prevQueueIndex,
        nextQueueIndex: s.queueIndex,
        queueLength: s.queue.length,
      });
      return s;
    });
  }, [stopAllBeforePlay, playLocal, playSource, getAdvanceState]);

  const next = useCallback((opts?: { skipPlay?: boolean; auditTransportCase?: "ended_auto" } | unknown) => {
    if (!deviceModeAllowsLocalPlayback.current) return;
    if (transportLockRef.current) return;
    const skipPlay: boolean =
      !!(opts && typeof opts === "object" && "skipPlay" in opts && (opts as { skipPlay?: boolean }).skipPlay === true);
    const auditRaw =
      opts && typeof opts === "object" && "auditTransportCase" in opts
        ? (opts as { auditTransportCase?: unknown }).auditTransportCase
        : undefined;
    const auditTransportCase: "ended_auto" | undefined = auditRaw === "ended_auto" ? "ended_auto" : undefined;
    transportLockRef.current = true;
    syncbizAuditTransportTransitionStart({
      phase: "next_callback_entry",
      auditTransportCase: auditTransportCase ?? null,
      skipPlay,
    });
    setState((s) => {
      const prevSourceId = s.currentSource?.id ?? null;
      const prevTrackIndex = s.currentTrackIndex;
      const prevQueueIndex = s.queueIndex;
      const prevQueueLength = s.queue.length;
      const emitScheduledQueueEndedAutoProof = (nextSelectedSourceId: string | null) => {
        if (auditTransportCase !== "ended_auto") return;
        if (!scheduledQueueReuseAuditPendingRef.current) return;
        scheduledQueueReuseAuditPendingRef.current = false;
        logScheduledQueueReuseProof(s, {
          reason: "after_first_natural_auto_advance",
          sourceHasPlaylistPayload: !!s.currentSource?.playlist,
          fromScheduledPlay: true,
          nextSelectedSourceId,
        });
      };
      const sessionLenForAudit = getPlaylistSessionTracks(s).length;
      syncbizAuditNextInvoked({
        currentSourceId: prevSourceId,
        queueIndex: prevQueueIndex,
        queueLength: prevQueueLength,
        sessionTracksLen: sessionLenForAudit,
        preferQueueCollapsed:
          sessionLenForAudit > 0 &&
          preferQueueTransportOverCollapsedSession(s, sessionLenForAudit, "next"),
        auditTransportCase: auditTransportCase ?? null,
        skipPlay,
      });
      console.log("[SyncBiz Audit] queue advance result", {
        phase: "before_next",
        branch: "unknown",
        playbackStatus: s.status,
        auditTransportCase: auditTransportCase ?? null,
        currentSourceId: prevSourceId,
        currentTrackIndex: prevTrackIndex,
        queueIndex: prevQueueIndex,
        queueLength: prevQueueLength,
        skipPlay,
      });
      if (!s.currentSource) {
        transportLockRef.current = false;
        return s;
      }

      logRuntimePlaybackAudit(s, {
        transport: "next",
        phase: "next_entry_state_before",
        auditTransportCase,
      });

      emitPlaylistSessionAudit(s, { transport: "next", auditTransportCase, skipPlay });
      const sessionTracks = getPlaylistSessionTracks(s);
      const plSnap = s.currentPlaylist;
      const plTracksForNext = plSnap ? getPlaylistTracks(plSnap) : [];
      const currentPlayUrlSnapshot = getPlayUrl(s.currentSource, s.currentTrackIndex);
      console.log("[SyncBiz Audit] next_transport_decision_snapshot", {
        auditTransportCase: auditTransportCase ?? null,
        skipPlay,
        currentSourceId: s.currentSource.id,
        currentSourceType: s.currentSource.type,
        currentPlaylistId: plSnap?.id ?? null,
        currentPlaylistTrackCount: plTracksForNext.length,
        queueLength: s.queue.length,
        currentTrackIndex: s.currentTrackIndex,
        queueIndex: s.queueIndex,
        currentPlayUrl: currentPlayUrlSnapshot,
        nextTrackExistsFromQueue:
          s.queue.length > 1 && s.queueIndex >= 0 && s.queueIndex < s.queue.length - 1,
        nextTrackExistsFromCurrentPlaylist:
          plTracksForNext.length > 1 && s.currentTrackIndex < plTracksForNext.length - 1,
        sessionCollapsedToOne: sessionTracks.length <= 1,
        isAutoMixing: null,
        overlapActive: null,
      });
      const curTrkNext = sessionTracks[s.currentTrackIndex] ?? sessionTracks[0];
      if (
        sessionTracks.length > 0 &&
        !preferQueueTransportOverCollapsedSession(s, sessionTracks.length, "next")
      ) {
        const trackCount = sessionTracks.length;
        const sessionStep = computeSessionNextTrackIndex(
          trackCount,
          s.currentTrackIndex,
          s.shuffle,
          s.repeat,
          getShuffledIndex,
        );

        if (sessionStep.kind === "exhausted") {
          transportLockRef.current = false;
          emitScheduledQueueEndedAutoProof(null);
          return s;
        }

        const nextIdx = sessionStep.nextIndex;
        const branch: "advance" | "restart" =
          sessionStep.kind === "advance" ? "advance" : "restart";
        console.log("[SyncBiz Audit] next index calculation", {
          playbackStatus: s.status,
          auditTransportCase: auditTransportCase ?? null,
          currentSourceId: s.currentSource?.id ?? null,
          currentTrackIndex: s.currentTrackIndex,
          queueIndex: s.queueIndex,
          queueLength: s.queue.length,
          trackCount,
          sessionTracksLen: sessionTracks.length,
          branch,
          shuffle: s.shuffle,
          nextIdx,
          indexUnchanged: nextIdx === s.currentTrackIndex,
          onlyOneSessionTrack: trackCount <= 1,
          firstThreeIds: sessionTracks.slice(0, 3).map((t) => (t as { id?: string }).id ?? "n/a"),
          selectedDiffersFromCurrent:
            trackCount > 0
              ? (sessionTracks[nextIdx] as { id?: string; url?: string } | undefined)?.id !==
                  (curTrkNext as { id?: string } | undefined)?.id ||
                (sessionTracks[nextIdx] as { url?: string } | undefined)?.url !==
                  (curTrkNext as { url?: string } | undefined)?.url
              : false,
        });
        const track = sessionTracks[nextIdx];
        const url = track?.url ?? s.currentSource.url;
        const embedded = track ? canEmbedInCard(track.type) : false;
        mvpLog("playback_next", {
          scope: "playlist",
          branch,
          playlistId: getActivePlaylist(s)?.id,
          trackCount,
          shuffle: s.shuffle,
          fromIndex: s.currentTrackIndex,
          toIndex: nextIdx,
          skipPlay,
        });
        console.log("[SyncBiz Audit] queue advance result", {
          phase: "playlist_session",
          branch,
          playbackStatus: s.status,
          auditTransportCase: auditTransportCase ?? null,
          prevSourceId,
          nextSourceId: s.currentSource.id,
          prevTrackIndex,
          nextTrackIndex: nextIdx,
          prevQueueIndex,
          nextQueueIndex: s.queueIndex,
          queueLength: s.queue.length,
          skipPlay,
        });
        console.log("[SyncBiz Audit] queue advance", {
          scope: "playlist",
          playbackStatus: s.status,
          auditTransportCase: auditTransportCase ?? null,
          fromIndex: s.currentTrackIndex,
          toIndex: nextIdx,
          queueIndex: s.queueIndex,
          queueLength: s.queue.length,
          sourceId: s.currentSource.id,
        });
        if (!skipPlay && !embedded && url) {
          stopAllBeforePlay();
          playLocal(url);
        }
        transportLockRef.current = false;
        const nextState = getAdvanceState(s, nextIdx);
        logRuntimePlaybackAudit(nextState, {
          transport: "next",
          phase: "playlist_session_state_after_transition",
          auditTransportCase,
          extra: {
            branch,
            fromIndex: s.currentTrackIndex,
            toIndex: nextIdx,
            skipPlay,
          },
        });
        emitScheduledQueueEndedAutoProof(s.currentSource.id);
        return nextState;
      }

      const playlist = s.currentPlaylist;
      const tracks = playlist ? getPlaylistTracks(playlist) : [];
      if (tracks.length === 0) {
        transportLockRef.current = false;
        emitScheduledQueueEndedAutoProof(null);
        return s;
      }

      const fbStep = computeSessionNextTrackIndex(
        tracks.length,
        s.currentTrackIndex,
        s.shuffle,
        s.repeat,
        getShuffledIndex,
      );
      if (fbStep.kind === "exhausted") {
        transportLockRef.current = false;
        emitScheduledQueueEndedAutoProof(null);
        return s;
      }
      const nextIdx = fbStep.nextIndex;
      const branch: "advance" | "restart" = fbStep.kind === "advance" ? "advance" : "restart";
      const track = tracks[nextIdx];
      const url = track?.url ?? s.currentSource.url;
      const embedded = track ? canEmbedInCard(track.type) : false;
      if (!skipPlay && !embedded && url) {
        stopAllBeforePlay();
        playLocal(url);
      }
      transportLockRef.current = false;
      mvpLog("playback_next", { scope: "playlist", branch: `fallback_${branch}`, skipPlay });
      console.log("[SyncBiz Audit] queue advance result", {
        phase: "playlist_fallback",
        branch,
        prevSourceId,
        nextSourceId: s.currentSource.id,
        prevTrackIndex,
        nextTrackIndex: nextIdx,
        prevQueueIndex,
        nextQueueIndex: s.queueIndex,
        queueLength: s.queue.length,
        skipPlay,
      });
      emitScheduledQueueEndedAutoProof(s.currentSource.id);
      return getAdvanceState(s, nextIdx);
    });
  }, [
    stopAllBeforePlay,
    playLocal,
    playSource,
    getShuffledIndex,
    getAdvanceState,
    logRuntimePlaybackAudit,
    emitPlaylistSessionAudit,
    getPlayUrl,
  ]);

  const getNextStreamUrl = useCallback((): string | null => {
    return (() => {
      const s = state;
      if (!s.currentSource) return null;

      const sessionTracks = getPlaylistSessionTracks(s);
      if (
        sessionTracks.length > 0 &&
        !preferQueueTransportOverCollapsedSession(s, sessionTracks.length, "next")
      ) {
        const step = computeSessionNextTrackIndex(
          sessionTracks.length,
          s.currentTrackIndex,
          s.shuffle,
          s.repeat,
          getShuffledIndex,
        );
        if (step.kind === "exhausted") return null;
        const track = sessionTracks[step.nextIndex];
        const url = canonicalYouTubeWatchUrlForPlayback(track?.url ?? s.currentSource.url);
        const embedded = track ? canEmbedInCard(track.type) : false;
        const out = !embedded && url ? url : null;
        if (out) {
          mvpLog("playback_get_next_stream", {
            scope: "playlist",
            playlistId: getActivePlaylist(s)?.id,
            nextIdx: step.nextIndex,
          });
        }
        return out;
      }

      const playlist = s.currentPlaylist;
      const tracks = playlist ? getPlaylistTracks(playlist) : [];
      if (tracks.length === 0) return null;

      const step = computeSessionNextTrackIndex(
        tracks.length,
        s.currentTrackIndex,
        s.shuffle,
        s.repeat,
        getShuffledIndex,
      );
      if (step.kind === "exhausted") return null;
      const track = tracks[step.nextIndex];
      const url = canonicalYouTubeWatchUrlForPlayback(track?.url ?? s.currentSource.url);
      const embedded = track ? canEmbedInCard(track.type) : false;
      return !embedded && url ? url : null;
    })();
  }, [state, getShuffledIndex]);

  /** Next embedded source for YouTube AutoMix. Returns YouTube only (Phase 1). */
  const getNextEmbeddedSource = useCallback((): { type: "youtube"; url: string; videoId: string } | null => {
    const s = state;
    if (!s.currentSource) return null;

    const sessionTracks = getPlaylistSessionTracks(s);
    if (
      sessionTracks.length > 0 &&
      !preferQueueTransportOverCollapsedSession(s, sessionTracks.length, "next")
    ) {
      const step = computeSessionNextTrackIndex(
        sessionTracks.length,
        s.currentTrackIndex,
        s.shuffle,
        s.repeat,
        getShuffledIndex,
      );
      if (step.kind === "exhausted") return null;
      const track = sessionTracks[step.nextIndex];
      const url = canonicalYouTubeWatchUrlForPlayback(track?.url ?? s.currentSource.url);
      const embedded = track ? canEmbedInCard(track.type) : false;
      let result: { type: "youtube"; url: string; videoId: string } | null = null;
      if (embedded && url && track?.type === "youtube") {
        const videoId = getYouTubeVideoId(url);
        result = videoId ? { type: "youtube", url, videoId } : null;
      }
      if (result) {
        mvpLog("playback_get_next_embedded", {
          scope: "playlist",
          playlistId: getActivePlaylist(s)?.id,
          nextIdx: step.nextIndex,
        });
      }
      return result;
    }

    const playlist = s.currentPlaylist;
    const tracks = playlist ? getPlaylistTracks(playlist) : [];
    if (tracks.length === 0) return null;

    const step = computeSessionNextTrackIndex(
      tracks.length,
      s.currentTrackIndex,
      s.shuffle,
      s.repeat,
      getShuffledIndex,
    );
    if (step.kind === "exhausted") return null;
    const track = tracks[step.nextIndex];
    const url = canonicalYouTubeWatchUrlForPlayback(track?.url ?? s.currentSource.url);
    const embedded = track ? canEmbedInCard(track.type) : false;
    if (embedded && url && track?.type === "youtube") {
      const videoId = getYouTubeVideoId(url);
      return videoId ? { type: "youtube", url, videoId } : null;
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
    (source: Source, opts?: { auditScheduledNonEmbedded?: boolean }) => {
      const unified = sourceToUnified(source);
      if (opts?.auditScheduledNonEmbedded) {
        scheduledQueueReuseAuditPendingRef.current = true;
        const snap = playbackStateForAuditRef.current;
        logScheduledQueueReuseProof(snap, {
          reason: "scheduled_non_embedded_start",
          sourceHasPlaylistPayload: !!unified.playlist,
          fromScheduledPlay: true,
          nextSelectedSourceId: null,
        });
      }
      playSource(unified);
    },
    [playSource],
  );

  const setQueue = useCallback((sources: UnifiedSource[], opts?: { force?: boolean }) => {
    setState((s) => {
      if (
        !opts?.force &&
        s.queue.length > 0 &&
        (s.status === "playing" || s.status === "paused") &&
        s.currentSource &&
        !sources.some((x) => x.id === s.currentSource!.id)
      ) {
        console.log("[SyncBiz Audit] setQueue skip to preserve currentSource", {
          currentSourceId: s.currentSource.id,
          status: s.status,
          existingQueueLen: s.queue.length,
          incomingQueueLen: sources.length,
          incomingIds: sources.map((x) => x.id),
        });
        return s;
      }
      const qi = s.currentSource ? sources.findIndex((x) => x.id === s.currentSource!.id) : -1;
      console.log("[SyncBiz Audit] queue item created", {
        currentSourceId: s.currentSource?.id ?? null,
        queueLen: sources.length,
        queueIndex: qi,
        queueIds: sources.map((x) => x.id),
      });
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
      stopForControlHandoff,
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
      stopForControlHandoff,
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
