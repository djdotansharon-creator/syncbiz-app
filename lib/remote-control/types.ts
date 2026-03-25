/**
 * Shared types for remote control MVP.
 * Used by both the WebSocket server and the frontend.
 */

export type RemoteCommand =
  | "PLAY"
  | "PAUSE"
  | "STOP"
  | "NEXT"
  | "PREV"
  | "LOAD_PLAYLIST"
  | "PLAY_SOURCE"
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

/** Serializable playback state for cross-device sync. */
export type StationPlaybackState = {
  status: "idle" | "playing" | "paused" | "stopped";
  currentTrack: { title: string; cover: string | null } | null;
  currentSource: { id: string; title: string; cover: string | null } | null;
  currentTrackIndex: number;
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
};

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
  | { type: "REGISTER"; role: ClientRole; authToken: string; deviceId?: string; isMobile?: boolean; branchId?: string; deviceType?: DeviceType }
  | { type: "BRANCH_LIST_REQUEST" }
  | { type: "COMMAND"; targetDeviceId?: string; targetBranchId?: string; command: RemoteCommand; payload?: { url?: string; source?: PlaySourcePayload; position?: number; volume?: number; value?: boolean } }
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
  | { type: "COMMAND"; command: RemoteCommand; payload?: { url?: string; source?: PlaySourcePayload; position?: number; volume?: number; value?: boolean } }
  | { type: "SET_DEVICE_MODE"; mode: DeviceMode; masterDeviceId?: string; secondaryDesktop?: boolean }
  | { type: "GUEST_RECOMMEND_RECEIVED"; recommendation: GuestRecommendationPayload }
  | { type: "GUEST_RECOMMEND_RESULT"; recommendationId: string; status: "approved" | "rejected" }
  | { type: "GUEST_RECOMMEND_SENT"; recommendationId: string }
  | { type: "BRANCH_LIST"; branches: BranchSummary[] }
  | { type: "LIBRARY_UPDATED"; branchId: string; entityType?: "playlist" | "source" | "radio"; action?: "created" | "updated" | "deleted" }
  | { type: "ERROR"; message: string };
