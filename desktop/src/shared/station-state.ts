/**
 * Subset of `lib/remote-control/types` StationPlaybackState — wire format for WS STATE_UPDATE.
 * Kept in desktop/ to avoid coupling the Electron bundle to the Next app.
 */
export type StationPlaybackState = {
  status: "idle" | "playing" | "paused" | "stopped";
  currentTrack: { title: string; cover: string | null } | null;
  /** Local station selection (branch library item). Optional `origin` for desktop UI only. */
  currentSource: {
    id: string;
    title: string;
    cover: string | null;
    origin?: "playlist" | "radio" | "source";
    /** Provider hint from unified API (`BranchLibraryItem.type`). */
    sourceType?: string;
    /** Direct playback URL — forwarded to MPV Channel A when PLAY has no explicit URL in its command payload. */
    url?: string;
  } | null;
  currentTrackIndex: number;
  queue: Array<{ id: string; title: string; cover: string | null }>;
  queueIndex: number;
  shuffle?: boolean;
  autoMix?: boolean;
  position?: number;
  duration?: number;
  positionAt?: number;
  volume?: number;
  /** Desktop: MPV channel reports running + IPC; omitted on web. */
  mpvEngineReady?: boolean;
  /** Desktop: last load/IPC/process/binary issue for operators (not optimistic). */
  mpvEngineError?: string | null;
};

export function createInitialStationState(): StationPlaybackState {
  const now = Date.now();
  return {
    status: "idle",
    currentTrack: null,
    currentSource: null,
    currentTrackIndex: 0,
    queue: [],
    queueIndex: 0,
    volume: 80,
    position: 0,
    duration: 0,
    positionAt: now,
  };
}
