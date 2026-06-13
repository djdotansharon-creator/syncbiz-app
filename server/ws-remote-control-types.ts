/**
 * WS wire protocol types for the standalone server build.
 * Kept in `server/` so Railway can build with Root Directory `/server` (no monorepo `lib/` in Docker context).
 * Frontend continues to use `lib/remote-control/types.ts` — keep shapes in sync manually.
 */

import type { SyncBizRegistrationIntent } from "./syncbiz-device-model.js";

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

export type DeviceType =
  | "main_master_player"
  | "secondary_desktop_controller"
  | "mobile_controller"
  | "mobile_player"
  | "owner_global_controller";

export type SessionTrackMirror = {
  id: string;
  title: string;
  cover: string | null;
  durationSeconds?: number;
};

export type StationPlaybackState = {
  status: "idle" | "playing" | "paused" | "stopped";
  currentTrack: { title: string; cover: string | null } | null;
  currentSource: {
    id: string;
    title: string;
    cover: string | null;
    editHref?: string | null;
    playlistOriginBadge?: "dj_creator" | "ready" | "scheduled" | "my" | "branch";
  } | null;
  currentTrackIndex: number;
  sessionTracks?: SessionTrackMirror[];
  sessionPlaylistId?: string | null;
  sessionTitle?: string | null;
  nextSessionTrack?: { title: string; cover: string | null } | null;
  playNextQueue?: Array<{ id: string; title: string; cover: string | null }>;
  queue: Array<{ id: string; title: string; cover: string | null }>;
  queueIndex: number;
  shuffle?: boolean;
  autoMix?: boolean;
  position?: number;
  duration?: number;
  positionAt?: number;
  volume?: number;
  activePlaybackEngineId?: string;
  activePlaybackEngineType?: string;
  mpvEngineReady?: boolean;
  mpvEngineError?: string | null;
};

export type PlaySourcePayload = {
  id: string;
  title: string;
  genre: string;
  cover: string | null;
  type: string;
  url: string;
  origin: "playlist" | "source" | "radio";
  playlistId?: string;
  sessionTracks?: SessionTrackMirror[];
};

export type DeviceMode = "MASTER" | "CONTROL";

export type DevicePresence = "online" | "stale";

export type DeviceInfo = {
  id: string;
  connectedAt: string;
  lastSeen?: string;
  presence?: DevicePresence;
  mode?: DeviceMode;
  branchId?: string;
  deviceType?: DeviceType;
  registrationIntent?: SyncBizRegistrationIntent;
};

export type BranchSummary = {
  branchId: string;
  branchName?: string;
  masterDeviceId: string;
  connectedAt: string;
  hasDevices: boolean;
};

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

export type ClientMessage =
  | {
      type: "REGISTER";
      role: ClientRole;
      authToken: string;
      deviceId?: string;
      isMobile?: boolean;
      branchId?: string;
      deviceType?: DeviceType;
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
  | {
      type: "GUEST_RECOMMEND";
      sessionCode: string;
      sourceUrl: string;
      guestName?: string;
      guestMessage?: string;
    }
  | { type: "APPROVE_GUEST_RECOMMEND"; recommendationId: string }
  | { type: "REJECT_GUEST_RECOMMEND"; recommendationId: string };

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
