/**
 * Phase-1 mock-only contracts for JINGLES CONTROL (desktop legacy + web Command Pads).
 * Not wired to playback, WS, MPV, or cloud.
 */

export type JinglesOperatorMode = "safe" | "preview" | "live";

export type MockBranchLinkStatus = "online" | "offline";

export type MockEngineStatus = "ready" | "offline" | "busy";

export type JinglesTabId = "create" | "ai" | "library" | "schedule" | "history";

export type AnnouncementKind = "jingle" | "announcement" | "broadcast";

export type JingleLanguage = "en" | "he";
export type JingleSpeed = "slow" | "normal" | "fast";
/** Pre-roll bell preset: "off" or one of the synthesized chime styles. */
export type JingleBellStyle = "off" | "ding" | "chime" | "soft";

export type AnnouncementDraft = {
  title: string;
  body: string;
  kind: AnnouncementKind;
  tone: string;
  voice: string;   // ElevenLabs voiceId
  pacing: string;
  preRoll: boolean;
  language: JingleLanguage;
  speed: JingleSpeed;
  bellStyle: JingleBellStyle;
};

export type MockLibraryItem = {
  id: string;
  title: string;
  tags: string[];
  kind: AnnouncementKind;
  durationLabel: string;
  favorite: boolean;
};

export type MockScheduleItem = {
  id: string;
  label: string;
  whenLabel: string;
  repeatLabel: string;
  targetLabel: string;
  /** Payload required by the background auto-player. Optional on legacy mock rows. */
  url?: string;
  preRoll?: boolean;
  bellStyle?: JingleBellStyle;
  /** Absolute ISO date-time of the next scheduled firing. */
  scheduledAtIso?: string;
  /** How the item repeats after firing. */
  repeat?: "once" | "daily" | "weekly";
};

export type MockHistoryEventKind =
  | "created"
  | "previewed"
  | "saved"
  | "scheduled"
  | "failed"
  | "restored"
  | "pad"
  | "draft_action";

export type MockHistoryEvent = {
  id: string;
  atIso: string;
  kind: MockHistoryEventKind;
  message: string;
};

/** Shared output surface produced by Create and AI Compose flows. */
export type JingleAsset = {
  id: string;
  title: string;
  script: string;
  url: string;
  kind: AnnouncementKind;
  durationLabel: string;
  voiceId: string;
  preRoll: boolean;
  bellStyle?: JingleBellStyle;
  language?: JingleLanguage;
  speed?: JingleSpeed;
};

/** One of the DJ-controller pad color presets. `null` → default (emerald/slate). */
export type PadColor =
  | "default"
  | "sky"
  | "violet"
  | "pink"
  | "amber"
  | "rose"
  | "teal"
  | "lime"
  | "indigo";

export type SamplerPadItem = {
  id: string;
  label: string;
  url: string;
  scheduledAt?: string; // ISO datetime string — Phase 1: stored/displayed, no daemon
  preRoll?: boolean;
  color?: PadColor;
  bellStyle?: JingleBellStyle;
};

/** Aggregated mock UI state for the operator console (phase 1). */
export type JinglesUiSnapshot = {
  tab: JinglesTabId;
  operatorMode: JinglesOperatorMode;
  branchStatus: MockBranchLinkStatus;
  engineStatus: MockEngineStatus;
  draft: AnnouncementDraft;
  draftSaved: boolean;
  lastAction: string;
  aiRoughIntent: string;
  selectedSuggestionIndex: number | null;
  activePadId: string | null;
  history: MockHistoryEvent[];
};
