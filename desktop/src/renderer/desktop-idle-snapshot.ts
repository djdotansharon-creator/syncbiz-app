import type { MvpStatusSnapshot } from "../shared/mvp-types";

/**
 * Pre-IPC / loading paint so hero + dock mount immediately (avoids blank player until getConfig/getStatus resolve).
 */
export const DESKTOP_IDLE_STATUS_SNAPSHOT: MvpStatusSnapshot = {
  appReady: false,
  deviceId: "",
  branchId: "",
  workspaceLabel: "",
  wsUrl: "",
  hasToken: false,
  wsState: "disconnected",
  registered: false,
  deviceRole: "unknown",
  commandReady: false,
  mockPlaybackStatus: "idle",
  mockVolume: 80,
  mockCurrentSourceLabel: "",
  mockSelectedLibraryId: null,
  mockSelectedLibraryKind: null,
  mockSelectedSourceType: null,
  mockCurrentSourceCoverUrl: null,
  branchCatalogCount: 0,
  branchCatalogIndex: null,
  lastServerMessageType: null,
  lastCommandSummary: null,
  lastError: null,
};
