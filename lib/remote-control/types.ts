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
  | "SET_VOLUME";

export type ClientRole = "device" | "controller";

/** Serializable playback state for cross-device sync. */
export type StationPlaybackState = {
  status: "idle" | "playing" | "paused" | "stopped";
  currentTrack: { title: string; cover: string | null } | null;
  currentSource: { id: string; title: string; cover: string | null } | null;
  currentTrackIndex: number;
  queue: Array<{ id: string; title: string; cover: string | null }>;
  queueIndex: number;
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

/** Device info from DEVICE_LIST – matches server payload */
export type DeviceInfo = {
  id: string;
  connectedAt: string;
  mode?: DeviceMode;
};

/** Message from client to server */
export type ClientMessage =
  | { type: "REGISTER"; role: ClientRole; deviceId?: string; isMobile?: boolean }
  | { type: "COMMAND"; targetDeviceId: string; command: RemoteCommand; payload?: { url?: string; source?: PlaySourcePayload; position?: number; volume?: number } }
  | { type: "STATE_UPDATE"; state: StationPlaybackState }
  | { type: "SET_MASTER" }
  | { type: "SET_CONTROL" };

/** Message from server to client */
export type ServerMessage =
  | { type: "REGISTERED"; deviceId?: string }
  | { type: "DEVICE_LIST"; devices: DeviceInfo[]; masterDeviceId?: string | null }
  | { type: "STATE_UPDATE"; deviceId: string; state: StationPlaybackState }
  | { type: "COMMAND"; command: RemoteCommand; payload?: { url?: string; source?: PlaySourcePayload; position?: number; volume?: number } }
  | { type: "SET_DEVICE_MODE"; mode: DeviceMode; masterDeviceId?: string }
  | { type: "ERROR"; message: string };
