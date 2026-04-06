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

/** Open taxonomy: genre, mood, energy, audience, season, business context, etc. */
export type TaxonomyTag = {
  key: string;
  value: string;
};

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
  /** Future: structured taxonomy (additive; optional on persisted sources). */
  taxonomyTags?: TaxonomyTag[];
  isLive: boolean;
};

/** Schedule target types. ANNOUNCEMENT, AI_ANNOUNCEMENT reserved for future. */
export type ScheduleTargetType = "SOURCE" | "PLAYLIST" | "RADIO";

/** Weekly = repeat on selected weekdays; one_off = single calendar day (e.g. 31/12). */
export type ScheduleRecurrence = "weekly" | "one_off";

export type Schedule = {
  id: string;
  accountId: string;
  name?: string;
  branchId: string;
  /** Target type – what to play at scheduled time. */
  targetType: ScheduleTargetType;
  /** ID of the target (source id, playlist id, or radio station id). */
  targetId: string;
  /** @deprecated Use targetType=SOURCE + targetId. Kept for backward compat. */
  sourceId?: string;
  deviceId?: string;
  /** Default weekly when omitted (legacy schedules). */
  recurrence?: ScheduleRecurrence;
  /** Required when recurrence is one_off — local date YYYY-MM-DD. */
  oneOffDateLocal?: string;
  daysOfWeek: number[]; // 0 (Sunday) - 6 (Saturday); empty when one_off
  startTimeLocal: string; // HH:mm or HH:mm:ss
  endTimeLocal: string; // HH:mm or HH:mm:ss
  enabled: boolean;
  priority: number;
  /** IANA timezone for schedule (e.g. America/New_York). Optional; uses branch default if unset. */
  timezone?: string;
  /** Optional hint sent to endpoint; depends on playback system */
  requestedStartPosition?: number;
  /** Optional hint sent to endpoint; depends on playback system */
  requestedEndPosition?: number;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
  updatedBy?: string;
  /** Future: taxonomy for schedule grouping (additive). */
  taxonomyTags?: TaxonomyTag[];
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

// --- Long-term foundation (additive; control-plane metadata; no runtime enforcement yet) ---

/** Where playback should execute (intent; adapters map to concrete engine). */
export type ExecutionTarget =
  | "browser_embed"
  | "native_audio_engine"
  | "radio_stream"
  | "ai_asset";

/** Policy for choosing browser vs native executor when both may apply. */
export type EngineSelectionPolicy =
  | "prefer_native"
  | "prefer_browser"
  | "force_native"
  | "browser_only";

/** Native / execution backends; mpv primary, vlc secondary, winamp legacy only. */
export type PlaybackEngineType = "browser" | "mpv" | "vlc" | "winamp_legacy";

/** Future mix/crossfade behavior hints (not bound to a single engine). */
export type MixStrategyId =
  | "browser_overlap"
  | "native_gapless"
  | "native_crossfade"
  | "interrupt_resume_aware"
  | "default";

/** Coarse shape from URL resolve (optional; complements contentNodeKind). */
export type ResolveMediaKind = "single_track" | "multi_item" | "stream" | "unknown";

/** Generalized library node (future persistence; optional legacy pointers today). */
export type ContentNodeKind =
  | "track"
  | "single_track"
  | "mix_set"
  | "external_playlist"
  | "syncbiz_playlist"
  | "radio_stream"
  | "ai_asset"
  | "unknown";

export type ContentNode = {
  id: string;
  kind: ContentNodeKind;
  title: string;
  branchId?: string;
  tenantId?: string;
  taxonomyTags?: TaxonomyTag[];
  executionTarget?: ExecutionTarget;
  engineSelectionPolicy?: EngineSelectionPolicy;
  mixStrategyHint?: MixStrategyId;
  legacyPlaylistId?: string;
  legacySourceId?: string;
};

/** Reusable business playback block (daypart / mood block). */
export type PlayBlock = {
  id: string;
  name: string;
  description?: string;
  itemRefs?: string[];
  branchId?: string;
  tenantId?: string;
};

/** Future automation rule (planner output targets intents, not engine commands). */
export type ScheduleRule = {
  id: string;
  branchId: string;
  targetRef?: {
    kind: "play_block" | "content_node" | "broadcast_event";
    id: string;
  };
  enabled?: boolean;
};

export type ResumePolicy =
  | "resume_exact"
  | "resume_from_next"
  | "restart_block"
  | "overlay_duck"
  | "hard_cut_resume";

/** Timed or manual interruptive business audio moment. */
export type BroadcastEvent = {
  id: string;
  eventType: string;
  title: string;
  triggerAt?: string;
  targetBranchId: string;
  payload?: Record<string, unknown>;
  audioSourceType?: string;
  priority: number;
  resumePolicy?: ResumePolicy;
  executionTarget?: ExecutionTarget;
  engineSelectionPolicy?: EngineSelectionPolicy;
  preferredEngineType?: PlaybackEngineType;
};

/** Registered execution capability on a device/branch (metadata only for now). */
export type PlaybackEngine = {
  id: string;
  branchId?: string;
  deviceId?: string;
  engineType: PlaybackEngineType;
  status?: "online" | "offline" | "degraded";
  supportedFormats?: string[];
  supportsResume?: boolean;
  supportsOverlay?: boolean;
  supportsQueue?: boolean;
};

/** Control-plane registration for an execution path (browser bridge vs native; metadata only). */
export type ExecutionAdapter = {
  id: string;
  branchId?: string;
  deviceId?: string;
  engineType: PlaybackEngineType;
  label?: string;
  status?: "active" | "inactive";
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
