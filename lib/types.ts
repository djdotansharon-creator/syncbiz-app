export type BranchStatus = "active" | "inactive";

export type DeviceStatus = "online" | "offline" | "maintenance";

export type DevicePlatform = "windows" | "android" | "mac";

/** Endpoint device capabilities – what commands the agent can execute. */
export type DeviceCapability =
  | "supportsPlay"
  | "supportsStop"
  | "supportsPause"
  | "supportsVolume"
  | "supportsSeek"
  | "supportsResume";

/** Playback target type. SyncBiz does NOT store media – only metadata and control instructions. */
export type SourceType =
  | "web_url"
  | "stream_url"
  | "playlist_url"
  | "local_playlist"
  | "browser_target"
  | "app_target"
  | "tts";

export type BrowserPreference = "default" | "chrome" | "edge" | "firefox";

/** Provider hint for player mode selection. */
export type SourceProvider = "youtube" | "soundcloud" | "external";

/** How to play: embedded in SyncBiz Player Page or launch externally. */
export type PlayerMode = "embedded" | "external";

/** Display labels for source types (e.g. in UI). */
export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  web_url: "Web URL",
  stream_url: "Stream URL",
  playlist_url: "Playlist URL",
  local_playlist: "Local Playlist",
  browser_target: "Browser target",
  app_target: "App target",
  tts: "TTS",
};

export type AnnouncementStatus = "draft" | "scheduled" | "sent";

export type AnnouncementPriority = "low" | "normal" | "high";

export type AnnouncementType = "tts" | "announcement_trigger" | "promo_trigger";

export type LogLevel = "info" | "warning" | "error";

export type Account = {
  id: string;
  name: string;
  timezone: string;
};

export type Branch = {
  id: string;
  accountId: string;
  name: string;
  code: string;
  timezone: string;
  city: string;
  country: string;
  status: BranchStatus;
  devicesOnline: number;
  devicesTotal: number;
};

export type Device = {
  id: string;
  accountId: string;
  branchId: string;
  name: string;
  type: "audio-player" | "screen-player" | "announcement-node";
  platform: DevicePlatform;
  status: DeviceStatus;
  health: "ok" | "degraded" | "error";
  capabilities: DeviceCapability[];
  lastHeartbeat: string;
  ipAddress: string;
  agentVersion: string;
  lastSeen: string;
  currentSourceId?: string;
  volume: number;
};

/** A playback target – URL, app, or TTS. SyncBiz never stores media content. */
export type Source = {
  id: string;
  accountId: string;
  branchId: string;
  name: string;
  type: SourceType;
  /** Playback target (e.g. URL, app identifier). Customer-owned. */
  target: string;
  description?: string;
  capabilities?: string[];
  /** Optional artwork/thumbnail URL for library display. Not scraped or fetched by SyncBiz. */
  artworkUrl?: string;
  /** Legacy; maps to target for compatibility */
  uriOrPath?: string;
  fallbackUriOrPath?: string;
  /** Optional browser selection for URL targets. Ignored for local playlists/files. */
  browserPreference?: BrowserPreference;
  /** Provider hint: youtube | soundcloud | external. Derived from target if not set. */
  provider?: SourceProvider;
  /** Player mode: embedded (in /player) or external (launch via command). */
  playerMode?: PlayerMode;
  tags?: string[];
  isLive: boolean;
};

export type Schedule = {
  id: string;
  accountId: string;
  name?: string;
  branchId: string;
  deviceId?: string;
  sourceId: string;
  daysOfWeek: number[]; // 0 (Sunday) - 6 (Saturday)
  startTimeLocal: string; // HH:mm
  endTimeLocal: string; // HH:mm
  enabled: boolean;
  priority: number;
  /** Optional hint sent to endpoint; depends on playback system */
  requestedStartPosition?: number;
  /** Optional hint sent to endpoint; depends on playback system */
  requestedEndPosition?: number;
};

export type Announcement = {
  id: string;
  accountId: string;
  branchId: string;
  title: string;
  message: string;
  type?: AnnouncementType;
  scheduleId?: string;
  status: AnnouncementStatus;
  priority: AnnouncementPriority;
  ttsEnabled: boolean;
  /** After playing, optionally resume the previous source */
  resumePreviousSource?: boolean;
  windowStart: string;
  windowEnd: string;
};

export type LogEntry = {
  id: string;
  accountId: string;
  timestamp: string;
  level: LogLevel;
  message: string;
  branchId?: string;
  deviceId?: string;
  sourceId?: string;
  scheduleId?: string;
};

/** Commands sent to the local endpoint agent. Device executes playback. */
export const DEVICE_COMMANDS = [
  "OPEN_URL",
  "STOP_CURRENT",
  "PLAY_TARGET",
  "PLAY_TTS",
  "SET_VOLUME",
  "RESUME_PREVIOUS",
] as const;

export type DeviceCommand = (typeof DEVICE_COMMANDS)[number];
