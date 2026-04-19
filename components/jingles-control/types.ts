/**
 * Phase-1 mock-only contracts for JINGLES CONTROL (desktop legacy + web Command Pads).
 * Not wired to playback, WS, MPV, or cloud.
 */

export type JinglesOperatorMode = "safe" | "preview" | "live";

export type MockBranchLinkStatus = "online" | "offline";

export type MockEngineStatus = "ready" | "offline" | "busy";

export type JinglesTabId = "create" | "ai" | "library" | "schedule" | "history";

export type AnnouncementKind = "jingle" | "announcement" | "broadcast";

export type AnnouncementDraft = {
  title: string;
  body: string;
  kind: AnnouncementKind;
  tone: string;
  voice: string;   // ElevenLabs voiceId
  pacing: string;
  preRoll: boolean;
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
};

export type SamplerPadItem = {
  id: string;
  label: string;
  url: string;
  scheduledAt?: string; // ISO datetime string — Phase 1: stored/displayed, no daemon
  preRoll?: boolean;
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
