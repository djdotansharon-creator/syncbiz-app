/**
 * MVP desktop — shared types for IPC and status (main ↔ preload ↔ renderer).
 */

export const MVP_IPC = {
  GET_CONFIG: "mvp:get-config",
  GET_STATUS: "mvp:get-status",
  SAVE_CONFIG: "mvp:save-config",
  WS_CONNECT: "mvp:ws-connect",
  WS_DISCONNECT: "mvp:ws-disconnect",
  FETCH_BRANCH_LIBRARY: "mvp:fetch-branch-library",
  SELECT_STATION_SOURCE: "mvp:select-station-source",
  LOCAL_MOCK_TRANSPORT: "mvp:local-mock-transport",
  DESKTOP_SIGN_IN: "mvp:desktop-sign-in",
  STATUS: "mvp:status",
} as const;

/** Local mock console — same commands as remote WS COMMAND (no MPV). */
export type LocalMockTransportPayload = {
  command: "PLAY" | "PAUSE" | "STOP" | "SET_VOLUME" | "PREV" | "NEXT";
  volume?: number;
};

export type MvpConnectionState = "disconnected" | "connecting" | "connected" | "error";

/** Persisted local config (userData JSON). Pilot: token stored in plaintext. */
export type DesktopRuntimeConfig = {
  /** Stable device identity; required for WS REGISTER. */
  deviceId: string;
  /** Must match server ALLOWED_BRANCH_IDS (Phase 1: typically "default"). */
  branchId: string;
  /** Human label only (workspace name — not validated against API in MVP). */
  workspaceLabel: string;
  /**
   * Next.js app origin for HTTP API (e.g. http://localhost:3000).
   * Separate from `wsUrl` (SyncBiz WS server, often port 3001).
   */
  apiBaseUrl: string;
  /** WebSocket URL e.g. wss://host or ws://localhost:3001 */
  wsUrl: string;
  /**
   * Bearer token: long-lived `desktop_access` from POST /api/auth/desktop/token, or short `ws_register`
   * from GET /api/auth/ws-token (paste). Same field is used for HTTP and WS REGISTER.
   */
  wsToken: string;
  /** Last email used with Sign in (optional, for form prefill). */
  lastAuthEmail?: string;
  /** ISO time when the current desktop bearer token expires (if known). */
  desktopTokenExpiresAtIso?: string;
};

export type DesktopSignInResult =
  | { ok: true; config: DesktopRuntimeConfig }
  | { ok: false; error: string };

/** One row from GET /api/sources/unified (branch scope), for desktop UI only. */
export type BranchLibraryItem = {
  id: string;
  title: string;
  origin: "playlist" | "radio" | "source";
  /** Provider hint: youtube, stream-url, etc. */
  type: string;
  branchId: string;
  genre: string;
  cover: string | null;
};

/** Read-only branch catalog snapshot (filtered by config branchId). */
export type BranchLibrarySummary = {
  status: "idle" | "ok" | "error";
  branchId?: string;
  playlistCount?: number;
  radioCount?: number;
  sourceCount?: number;
  samplePlaylistNames?: string[];
  /** Full branch-scoped list (when status is ok). */
  items?: BranchLibraryItem[];
  loadedAtIso?: string | null;
  errorMessage?: string | null;
};

/** From server SET_DEVICE_MODE — COMMAND is routed to MASTER only. */
export type MvpDeviceRole = "MASTER" | "CONTROL" | "unknown";

export type MvpStatusSnapshot = {
  appReady: boolean;
  deviceId: string;
  branchId: string;
  workspaceLabel: string;
  wsUrl: string;
  /** Masked: show only last 8 chars when set */
  hasToken: boolean;
  wsState: MvpConnectionState;
  registered: boolean;
  /** Server-assigned mode (after REGISTER). */
  deviceRole: MvpDeviceRole;
  /** Registered, connected, and MASTER — remote COMMAND messages are delivered here. */
  commandReady: boolean;
  /** Mock/local playback until MPV — mirrors what we send in STATE_UPDATE when MASTER. */
  mockPlaybackStatus: "idle" | "playing" | "paused" | "stopped";
  mockVolume: number;
  mockCurrentSourceLabel: string;
  /** Local branch library selection (mock runtime). */
  mockSelectedLibraryId: string | null;
  mockSelectedLibraryKind: "playlist" | "radio" | "source" | null;
  /** Unified API provider type for selected source (e.g. youtube, stream-url). */
  mockSelectedSourceType: string | null;
  /** Cover URL for hero artwork (from `currentSource.cover`, https only in UI). */
  mockCurrentSourceCoverUrl: string | null;
  /** Items in main-process branch catalog (from last library fetch + selection fallback). Used for PREV/NEXT. */
  branchCatalogCount: number;
  /** 0-based index of current station source in `branchCatalog`, or null if unknown / empty. */
  branchCatalogIndex: number | null;
  lastServerMessageType: string | null;
  lastCommandSummary: string | null;
  lastError: string | null;
};

export type MvpConfigPatch = Partial<Omit<DesktopRuntimeConfig, "deviceId">> & {
  deviceId?: string;
};
