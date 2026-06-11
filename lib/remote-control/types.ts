/**
 * Shared types for remote control MVP.
 * Used by both the WebSocket server and the frontend.
 */

import type { UnifiedSourceFoundation } from "@/lib/source-types";
import type { PlaybackEngineType } from "@/lib/types";
import type { SyncBizRegistrationIntent } from "@/lib/syncbiz-device-model";

export type RemoteCommand =
  | "PLAY"
  | "PAUSE"
  | "STOP"
  | "NEXT"
  | "PREV"
  | "LOAD_PLAYLIST"
  | "PLAY_SOURCE"
  | "QUEUE_NEXT"
  | "SEEK"
  | "SET_VOLUME"
  | "SET_SHUFFLE"
  | "SET_AUTOMIX";

export type ClientRole = "device" | "controller" | "owner_global";

/** Device/controller type for routing and permissions */
export type DeviceType =
  | "main_master_player"
  | "secondary_desktop_controller"
  | "mobile_controller"
  | "mobile_player"
  | "owner_global_controller";

/** Minimal playlist session row mirrored to CONTROL clients. */
export type SessionTrackMirror = {
  id: string;
  title: string;
  cover: string | null;
  durationSeconds?: number;
  /** Optional playable URL (sent from CONTROL so MASTER can rebuild leaf rows). */
  url?: string;
};

/** Serializable playback state for cross-device sync. */
export type StationPlaybackState = {
  status: "idle" | "playing" | "paused" | "stopped";
  currentTrack: { title: string; cover: string | null } | null;
  /**
   * Minimal mirror of the MASTER's current source.
   * `editHref` is the deep-link to the source's editor (e.g. `/sources/[id]/edit`)
   * so a CONTROL client can show an Edit button that opens the right form
   * without having to reconstruct the full UnifiedSource on the wire.
   */
  currentSource: {
    id: string;
    title: string;
    cover: string | null;
    editHref?: string | null;
    /** Set when playing a persisted playlist — drives CONTROL playlist-kind badge without full `UnifiedSource`. */
    playlistOriginBadge?: "dj_creator" | "ready" | "scheduled" | "my" | "branch";
  } | null;
  currentTrackIndex: number;
  /** Active playlist session rows (same data MASTER Live Queue uses). */
  sessionTracks?: SessionTrackMirror[];
  /** Persisted playlist id when the session is playlist-backed (incl. AI playlists). */
  sessionPlaylistId?: string | null;
  /** Display title for the active session (playlist name or source title). */
  sessionTitle?: string | null;
  /** Next row within sessionTracks (in-order), when known. */
  nextSessionTrack?: { title: string; cover: string | null } | null;
  /** Staged Play Next rows on MASTER (mirrored to CONTROL). */
  playNextQueue?: Array<{ id: string; title: string; cover: string | null }>;
  queue: Array<{ id: string; title: string; cover: string | null }>;
  queueIndex: number;
  /** Shuffle preference from MASTER (source of truth). */
  shuffle?: boolean;
  /** AutoMix/crossfade preference from MASTER (source of truth). */
  autoMix?: boolean;
  /** Progress position in seconds (from MASTER). */
  position?: number;
  /** Track duration in seconds (from MASTER). */
  duration?: number;
  /** Timestamp when position was captured (for CONTROL interpolation). */
  positionAt?: number;
  /** Volume 0–100 (from MASTER). */
  volume?: number;
  /** Future: which engine is driving playback on MASTER (metadata only). */
  activePlaybackEngineId?: string;
  activePlaybackEngineType?: PlaybackEngineType;
  /** Optional: branch desktop MASTER reports MPV process + IPC health. */
  mpvEngineReady?: boolean;
  /** Optional: last MPV/engine error string from branch desktop (not optimistic). */
  mpvEngineError?: string | null;
};

/** Minimal source payload for PLAY_SOURCE command. */
export type PlaySourcePayload = {
  id: string;
  title: string;
  genre: string;
  cover: string | null;
  type: string;
  url: string;
  origin: "playlist" | "source" | "radio";
  /** When set, MASTER hydrates full playlist before play (multi-track / AI playlists). */
  playlistId?: string;
  /**
   * Session rows from CONTROL library (streamer may lack user cookie for GET /api/playlists).
   * MASTER rebuilds playlist attachment when server fetch fails.
   */
  sessionTracks?: SessionTrackMirror[];
} & Partial<UnifiedSourceFoundation>;

/** Device mode: MASTER = active player, CONTROL = monitor/standby */
export type DeviceMode = "MASTER" | "CONTROL";

/** Presence: online = recently active (heartbeat); stale = connected but lastSeen old. */
export type DevicePresence = "online" | "stale";

/** Device info from DEVICE_LIST – matches server payload */
export type DeviceInfo = {
  id: string;
  connectedAt: string;
  /** Last activity timestamp (ISO). Updated on heartbeat pong and app messages. */
  lastSeen?: string;
  /** Derived from lastSeen: online if recent, stale if older. */
  presence?: DevicePresence;
  mode?: DeviceMode;
  branchId?: string;
  deviceType?: DeviceType;
  /** Client REGISTER hint (sanitized server-side). Controllers are not listed here. */
  registrationIntent?: SyncBizRegistrationIntent;
};

/** Branch summary for owner – branches with connected MASTER */
export type BranchSummary = {
  branchId: string;
  branchName?: string;
  masterDeviceId: string;
  connectedAt: string;
  hasDevices: boolean;
};

/** Guest recommendation payload (minimal, for transport) */
export type GuestRecommendationPayload = {
  id: string;
  sourceUrl: string;
  sourceType: string;
  guestName?: string;
  guestMessage?: string;
  createdAt: string;
  targetSessionId: string;
  status: "pending" | "approved" | "rejected";
};

/** Message from client to server */
export type ClientMessage =
  | {
      type: "REGISTER";
      role: ClientRole;
      authToken: string;
      deviceId?: string;
      isMobile?: boolean;
      branchId?: string;
      deviceType?: DeviceType;
      /** Optional client taxonomy for routing/analytics; ignored for auth. */
      registrationIntent?: SyncBizRegistrationIntent;
    }
  | { type: "BRANCH_LIST_REQUEST" }
  | {
      type: "COMMAND";
      commandId?: string;
      targetDeviceId?: string;
      targetBranchId?: string;
      command: RemoteCommand;
      payload?: {
        url?: string;
        source?: PlaySourcePayload;
        position?: number;
        volume?: number;
        value?: boolean;
        trackIndex?: number;
      };
    }
  | {
      type: "COMMAND_RESULT";
      commandId: string;
      ok: boolean;
      error?: string;
      executedAt?: number;
    }
  | { type: "STATE_UPDATE"; state: StationPlaybackState }
  | { type: "SET_MASTER" }
  | { type: "SET_CONTROL" }
  | { type: "GUEST_RECOMMEND"; sessionCode: string; sourceUrl: string; guestName?: string; guestMessage?: string }
  | { type: "APPROVE_GUEST_RECOMMEND"; recommendationId: string }
  | { type: "REJECT_GUEST_RECOMMEND"; recommendationId: string };

/** Message from server to client */
export type ServerMessage =
  | { type: "REGISTERED"; deviceId?: string; sessionCode?: string }
  | { type: "DEVICE_LIST"; devices: DeviceInfo[]; masterDeviceId?: string | null; sessionCode?: string }
  | { type: "STATE_UPDATE"; deviceId: string; state: StationPlaybackState }
  | {
      type: "COMMAND";
      commandId?: string;
      command: RemoteCommand;
      payload?: {
        url?: string;
        source?: PlaySourcePayload;
        position?: number;
        volume?: number;
        value?: boolean;
        trackIndex?: number;
      };
    }
  | {
      type: "COMMAND_ACK";
      commandId: string;
      masterDeviceId?: string | null;
      receivedAt: number;
    }
  | {
      type: "COMMAND_RESULT";
      commandId: string;
      ok: boolean;
      error?: string;
      executedAt?: number;
      failedAt?: number;
    }
  | { type: "SET_DEVICE_MODE"; mode: DeviceMode; masterDeviceId?: string; secondaryDesktop?: boolean }
  | { type: "GUEST_RECOMMEND_RECEIVED"; recommendation: GuestRecommendationPayload }
  | { type: "GUEST_RECOMMEND_RESULT"; recommendationId: string; status: "approved" | "rejected" }
  | { type: "GUEST_RECOMMEND_SENT"; recommendationId: string }
  | { type: "BRANCH_LIST"; branches: BranchSummary[] }
  | {
      type: "LIBRARY_UPDATED";
      branchId: string;
      entityType?: "playlist" | "source" | "radio";
      action?: "created" | "updated" | "deleted";
      entityId?: string;
    }
  | { type: "ERROR"; message: string };
