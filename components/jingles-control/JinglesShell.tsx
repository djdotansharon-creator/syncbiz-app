/**
 * JINGLES CONTROL — phase-1 mock operator UI only.
 * - Lives in its own React root (`jingles-shell-bridge`); open/close/tab changes are local state only.
 * - Does not call transport, WS, MPV, or main-process playback — hero/dock/library roots are unrelated.
 */
import React, { useReducer, useCallback, useState, useEffect, useLayoutEffect, useRef, type Dispatch } from "react";
import { createPortal } from "react-dom";
import type {
  AnnouncementDraft,
  JingleAsset,
  JingleBellStyle,
  JingleLanguage,
  JingleSpeed,
  JinglesOperatorMode,
  JinglesTabId,
  MockBranchLinkStatus,
  MockEngineStatus,
  MockHistoryEvent,
  MockHistoryEventKind,
  MockScheduleItem,
  PadColor,
  SamplerPadItem,
} from "./types";
import {
  INITIAL_MOCK_HISTORY,
  MOCK_AI_SUGGESTIONS,
  MOCK_LIBRARY_ITEMS,
  MOCK_SCHEDULE_ITEMS,
  SAMPLER_PADS,
} from "./seed-data";
import { VOICE_PRESETS_BY_LANG, voiceMenuLabel } from "./voice-presets";
import { JINGLES_OPEN_TAB_EVENT, takeJinglesOpenTab, type JinglesOpenTab } from "./open-tab";
import { fetchCloudPads, savePadToCloud, padsFromCloud } from "./cloud-pads";
import { loadJingleSchedule, persistJingleSchedule, JINGLE_SCHEDULE_EVENT } from "./schedule-storage";
import { stationBranchIdNow, useStationBranchId } from "@/lib/station-branch";
import { useAudioPreview } from "./use-audio-preview";
import { JingleCreateFlow } from "./jingle-create-flow";
import { JingleScheduleDialog, localizeWhen, whenNextLabel } from "./jingle-schedule-dialog";
import { jingleTint } from "./jingle-tint";
import { GlassModal } from "@/components/glass-modal";
import { useDevicePlayer } from "@/lib/device-player-context";
import { VxSelect } from "@/components/management/vx-select";
import { useTr } from "@/lib/i18n/use-tr";

type State = {
  drawerOpen: boolean;
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
  scheduleMode: "now" | "later" | "recurring";
  targetBranchPlaceholder: string;
  repeatInterval: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function hid(): string {
  return `jc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// Voice presets are the shared source of truth in ./voice-presets (imported above) so Mobile
// mirrors Desktop exactly rather than defining a parallel list.

/** Synthesized bell presets served from /api/jingles/bell/[style]. `off` = no pre-roll. */
const BELL_PRESETS: readonly { value: JingleBellStyle; label: string }[] = [
  { value: "off",   label: "Off" },
  { value: "ding",  label: "Ding" },
  { value: "chime", label: "Chime" },
  { value: "soft",  label: "Soft" },
];

function bellUrlFor(style: JingleBellStyle | undefined): string | null {
  if (!style || style === "off") return null;
  return `/api/jingles/bell/${style}`;
}

/** the built-in sample rows (no audio) in the Library tab — hidden (owner 2026-10-18: confusing); flip to bring them back */
const SHOW_SAMPLE_LIBRARY = false;

const initialDraft: AnnouncementDraft = {
  title: "",
  body: "",
  kind: "announcement",
  tone: "Warm, clear",
  voice: VOICE_PRESETS_BY_LANG.en[0].voiceId,
  pacing: "Normal",
  preRoll: true,
  language: "en",
  speed: "normal",
  bellStyle: "ding",
};

const initialState: State = {
  drawerOpen: false,
  tab: "create",
  operatorMode: "safe",
  branchStatus: "online",
  engineStatus: "ready",
  draft: { ...initialDraft },
  draftSaved: false,
  lastAction: "—",
  aiRoughIntent: "",
  selectedSuggestionIndex: null,
  activePadId: null,
  history: [...INITIAL_MOCK_HISTORY],
  scheduleMode: "later",
  targetBranchPlaceholder: "default",
  repeatInterval: "weekly",
};

type Action =
  | { type: "OPEN" }
  | { type: "CLOSE" }
  | { type: "SET_TAB"; tab: JinglesTabId }
  | { type: "SET_OPERATOR_MODE"; mode: JinglesOperatorMode }
  | { type: "SET_BRANCH"; status: MockBranchLinkStatus }
  | { type: "SET_ENGINE"; status: MockEngineStatus }
  | { type: "DRAFT_PATCH"; patch: Partial<AnnouncementDraft> }
  | { type: "CREATE_PREVIEW" }
  | { type: "CREATE_GENERATE" }
  | { type: "CREATE_SAVE" }
  | { type: "CREATE_PLAY_NOW" }
  | { type: "AI_SET_INTENT"; text: string }
  | { type: "AI_USE"; index: number }
  | { type: "AI_APPROVE"; index: number }
  | { type: "LIB_ACTION"; action: string; id: string }
  | { type: "SCHED_PATCH"; scheduleMode?: State["scheduleMode"]; target?: string; repeat?: string }
  | { type: "PAD"; padId: string; label: string };

function pushHistory(prev: MockHistoryEvent[], kind: MockHistoryEvent["kind"], message: string): MockHistoryEvent[] {
  const ev: MockHistoryEvent = { id: hid(), atIso: nowIso(), kind, message };
  return [ev, ...prev].slice(0, 80);
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "OPEN":
      return { ...state, drawerOpen: true };
    case "CLOSE":
      return { ...state, drawerOpen: false, activePadId: null };
    case "SET_TAB":
      return { ...state, tab: action.tab };
    case "SET_OPERATOR_MODE":
      return {
        ...state,
        operatorMode: action.mode,
        lastAction: `Mode → ${action.mode} (mock)`,
        history: pushHistory(state.history, "draft_action", `Operator mode set to ${action.mode} (mock only)`),
      };
    case "SET_BRANCH":
      return { ...state, branchStatus: action.status, lastAction: `Branch ${action.status} (mock)` };
    case "SET_ENGINE":
      return { ...state, engineStatus: action.status, lastAction: `Engine ${action.status} (mock)` };
    case "DRAFT_PATCH":
      return { ...state, draft: { ...state.draft, ...action.patch }, draftSaved: false };
    case "CREATE_PREVIEW":
      return {
        ...state,
        lastAction: "Preview (mock — no audio)",
        history: pushHistory(state.history, "previewed", `Preview requested: ${state.draft.title || "(untitled)"}`),
      };
    case "CREATE_GENERATE":
      return {
        ...state,
        lastAction: "Generate (mock — no asset)",
        history: pushHistory(state.history, "created", `Generate clicked (mock) — ${state.draft.kind}`),
      };
    case "CREATE_SAVE":
      return {
        ...state,
        draftSaved: true,
        lastAction: "Draft saved (mock)",
        history: pushHistory(state.history, "saved", `Draft saved (mock): ${state.draft.title || "(untitled)"}`),
      };
    case "CREATE_PLAY_NOW":
      return {
        ...state,
        lastAction: "Play now (mock — no playback)",
        history: pushHistory(state.history, "previewed", `Play now (mock) — would queue to session layer later`),
      };
    case "AI_SET_INTENT":
      return { ...state, aiRoughIntent: action.text };
    case "AI_USE":
      return {
        ...state,
        selectedSuggestionIndex: action.index,
        draft: { ...state.draft, body: MOCK_AI_SUGGESTIONS[action.index] ?? state.draft.body },
        lastAction: `Used suggestion ${action.index + 1} (mock)`,
        history: pushHistory(state.history, "created", `AI suggestion ${action.index + 1} applied to draft (mock)`),
      };
    case "AI_APPROVE":
      return {
        ...state,
        selectedSuggestionIndex: action.index,
        lastAction: `Approved suggestion ${action.index + 1} (mock)`,
        history: pushHistory(state.history, "saved", `Approved AI copy (mock) — suggestion ${action.index + 1}`),
      };
    case "LIB_ACTION": {
      let hk: MockHistoryEventKind = "draft_action";
      if (action.action === "Schedule") hk = "scheduled";
      else if (action.action === "Preview") hk = "previewed";
      return {
        ...state,
        lastAction: `${action.action} · ${action.id} (mock)`,
        history: pushHistory(state.history, hk, `Library ${action.action} (mock): ${action.id}`),
      };
    }
    case "SCHED_PATCH":
      return {
        ...state,
        scheduleMode: action.scheduleMode ?? state.scheduleMode,
        targetBranchPlaceholder: action.target ?? state.targetBranchPlaceholder,
        repeatInterval: action.repeat ?? state.repeatInterval,
        lastAction: "Schedule fields updated (mock)",
      };
    case "PAD":
      return {
        ...state,
        activePadId: action.padId,
        lastAction: `Pad: ${action.label} (mock)`,
        history: pushHistory(state.history, "pad", `Sampler pad “${action.label}” (mock trigger)`),
      };
    default:
      return state;
  }
}

function Chip({
  children,
  variant,
}: {
  children: React.ReactNode;
  variant: "ok" | "warn" | "err" | "neutral" | "accent";
}): React.ReactElement {
  return <span className={`jc-chip jc-chip--${variant}`}>{children}</span>;
}

/** Visible segmented button group — replaces all <select> elements. */
function SegBtn({
  options,
  value,
  onChange,
}: {
  options: readonly { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}): React.ReactElement {
  return (
    <div className="jc-seg" role="group">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          aria-pressed={value === opt.value}
          className={`jc-seg-btn ${value === opt.value ? "jc-seg-btn--active" : ""}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

type DrawerChromeProps = {
  state: State;
  dispatch: Dispatch<Action>;
  onClose: () => void;
};

/** Inner JINGLES CONTROL panel (mock) — shared by desktop rail and web Command Pads. */
function JinglesDrawerChrome({ state, dispatch, onClose }: DrawerChromeProps): React.ReactElement {
  const tr = useTr();
  return (
    <>
      <header className="jc-drawer-header">
        <div>
          <h2 id="jc-drawer-title" className="jc-drawer-title">
            JINGLES CONTROL
          </h2>
          <p className="jc-drawer-sub">Operator console · mock-only (no execution)</p>
        </div>
        <button type="button" className="jc-icon-btn" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>

      <div className="jc-status-bar">
        <div className="jc-status-cluster">
          <span className="jc-status-label">Branch</span>
          <Chip variant={state.branchStatus === "online" ? "ok" : "err"}>{state.branchStatus}</Chip>
          <button
            type="button"
            className="jc-linkish"
            onClick={() =>
              dispatch({ type: "SET_BRANCH", status: state.branchStatus === "online" ? "offline" : "online" })
            }
          >
            toggle mock
          </button>
        </div>
        <div className="jc-status-cluster">
          <span className="jc-status-label">Engine</span>
          <Chip
            variant={state.engineStatus === "ready" ? "ok" : state.engineStatus === "busy" ? "warn" : "err"}
          >
            {state.engineStatus}
          </Chip>
          <select
            className="jc-select-mini"
            value={state.engineStatus}
            onChange={(e) =>
              dispatch({
                type: "SET_ENGINE",
                status: e.target.value as MockEngineStatus,
              })
            }
            aria-label="Engine status mock"
          >
            <option value="ready">ready</option>
            <option value="offline">offline</option>
            <option value="busy">busy</option>
          </select>
        </div>
        <div className="jc-status-cluster">
          <span className="jc-status-label">Mode</span>
          <select
            className="jc-select"
            value={state.operatorMode}
            onChange={(e) =>
              dispatch({ type: "SET_OPERATOR_MODE", mode: e.target.value as JinglesOperatorMode })
            }
            aria-label="Operator mode mock"
          >
            <option value="safe">Safe</option>
            <option value="preview">Preview</option>
            <option value="live">Live</option>
          </select>
        </div>
      </div>

      <p className="jc-last-action">
        Last action: <strong>{state.lastAction}</strong>
        {state.draftSaved ? <Chip variant="accent">draft saved (mock)</Chip> : null}
      </p>

      <nav className="jc-tabs" role="tablist">
        {(
          [
            ["create", "Create"],
            ["ai", "AI Compose"],
            ["library", "Library"],
            ["schedule", "Schedule"],
            ["history", "History"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={state.tab === id}
            className={`jc-tab ${state.tab === id ? "jc-tab--active" : ""}`}
            onClick={() => dispatch({ type: "SET_TAB", tab: id as JinglesTabId })}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="jc-panel">
        {state.tab === "create" ? (
          <div className="jc-form">
            <label className="jc-field">
              <span>{tr("Title")}</span>
              <input
                value={state.draft.title}
                onChange={(e) => dispatch({ type: "DRAFT_PATCH", patch: { title: e.target.value } })}
                placeholder={tr("e.g. Weekend fresh produce")}
              />
            </label>
            <label className="jc-field">
              <span>Script / body</span>
              <textarea
                rows={4}
                value={state.draft.body}
                onChange={(e) => dispatch({ type: "DRAFT_PATCH", patch: { body: e.target.value } })}
                placeholder="What should the announcer say?"
              />
            </label>
            <div className="jc-field-row">
              <label className="jc-field">
                <span>Type</span>
                <select
                  value={state.draft.kind}
                  onChange={(e) =>
                    dispatch({
                      type: "DRAFT_PATCH",
                      patch: { kind: e.target.value as AnnouncementDraft["kind"] },
                    })
                  }
                >
                  <option value="jingle">Jingle</option>
                  <option value="announcement">Announcement</option>
                  <option value="broadcast">Broadcast</option>
                </select>
              </label>
              <label className="jc-field">
                <span>Tone</span>
                <input
                  value={state.draft.tone}
                  onChange={(e) => dispatch({ type: "DRAFT_PATCH", patch: { tone: e.target.value } })}
                />
              </label>
              <label className="jc-field">
                <span>Voice</span>
                <input
                  value={state.draft.voice}
                  onChange={(e) => dispatch({ type: "DRAFT_PATCH", patch: { voice: e.target.value } })}
                />
              </label>
              <label className="jc-field">
                <span>Pacing</span>
                <input
                  value={state.draft.pacing}
                  onChange={(e) => dispatch({ type: "DRAFT_PATCH", patch: { pacing: e.target.value } })}
                />
              </label>
            </div>
            <div className="jc-actions">
              <button type="button" className="jc-btn jc-btn--ghost" onClick={() => dispatch({ type: "CREATE_PREVIEW" })}>
                Preview
              </button>
              <button type="button" className="jc-btn jc-btn--ghost" onClick={() => dispatch({ type: "CREATE_GENERATE" })}>
                Generate
              </button>
              <button type="button" className="jc-btn jc-btn--secondary" onClick={() => dispatch({ type: "CREATE_SAVE" })}>
                Save
              </button>
              <button type="button" className="jc-btn jc-btn--primary" onClick={() => dispatch({ type: "CREATE_PLAY_NOW" })}>
                Play now
              </button>
            </div>
          </div>
        ) : null}

        {state.tab === "ai" ? (
          <div className="jc-ai">
            <label className="jc-field">
              <span>Rough intent (manager)</span>
              <textarea
                rows={3}
                value={state.aiRoughIntent}
                onChange={(e) => dispatch({ type: "AI_SET_INTENT", text: e.target.value })}
                placeholder="e.g. remind about closing, friendly, 20 seconds"
              />
            </label>
            <p className="jc-hint">Mock suggestions — no API call.</p>
            <ul className="jc-ai-cards">
              {MOCK_AI_SUGGESTIONS.map((text, i) => (
                <li key={i} className="jc-ai-card">
                  <p>{text}</p>
                  <div className="jc-ai-card-actions">
                    <button type="button" className="jc-btn jc-btn--small" onClick={() => dispatch({ type: "AI_USE", index: i })}>
                      Use
                    </button>
                    <button type="button" className="jc-btn jc-btn--small jc-btn--ghost" disabled>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="jc-btn jc-btn--small jc-btn--secondary"
                      onClick={() => dispatch({ type: "AI_APPROVE", index: i })}
                    >
                      Approve
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {state.tab === "library" ? (
          <ul className="jc-lib">
            {MOCK_LIBRARY_ITEMS.map((item) => (
              <li key={item.id} className="jc-lib-row">
                <div>
                  <div className="jc-lib-title">
                    {item.favorite ? <span className="jc-star" aria-hidden>★</span> : null}
                    {item.title}
                  </div>
                  <div className="jc-lib-meta">
                    {item.kind} · {item.durationLabel} · {item.tags.join(", ")}
                  </div>
                </div>
                <div className="jc-lib-actions">
                  <button
                    type="button"
                    className="jc-btn jc-btn--small"
                    onClick={() => dispatch({ type: "LIB_ACTION", action: "Load", id: item.id })}
                  >
                    Load
                  </button>
                  <button
                    type="button"
                    className="jc-btn jc-btn--small"
                    onClick={() => dispatch({ type: "LIB_ACTION", action: "Preview", id: item.id })}
                  >
                    Preview
                  </button>
                  <button
                    type="button"
                    className="jc-btn jc-btn--small"
                    onClick={() => dispatch({ type: "LIB_ACTION", action: "Schedule", id: item.id })}
                  >
                    Schedule
                  </button>
                  <button
                    type="button"
                    className="jc-btn jc-btn--small jc-btn--ghost"
                    onClick={() => dispatch({ type: "LIB_ACTION", action: "Duplicate", id: item.id })}
                  >
                    Duplicate
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        {state.tab === "schedule" ? (
          <div className="jc-sched">
            <div className="jc-field-row">
              <label className="jc-field">
                <span>When</span>
                <select
                  value={state.scheduleMode}
                  onChange={(e) =>
                    dispatch({
                      type: "SCHED_PATCH",
                      scheduleMode: e.target.value as State["scheduleMode"],
                    })
                  }
                >
                  <option value="now">Now</option>
                  <option value="later">Later</option>
                  <option value="recurring">Recurring</option>
                </select>
              </label>
              <label className="jc-field">
                <span>Target branch / device</span>
                <input
                  value={state.targetBranchPlaceholder}
                  onChange={(e) => dispatch({ type: "SCHED_PATCH", target: e.target.value })}
                />
              </label>
              <label className="jc-field">
                <span>Repeat</span>
                <select
                  value={state.repeatInterval}
                  onChange={(e) => dispatch({ type: "SCHED_PATCH", repeat: e.target.value })}
                >
                  <option value="once">Once</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                </select>
              </label>
            </div>
            <p className="jc-hint">Scheduled list (mock)</p>
            <ul className="jc-sched-list">
              {MOCK_SCHEDULE_ITEMS.map((s) => (
                <li key={s.id}>
                  <strong>{s.label}</strong> — {s.whenLabel} · {s.repeatLabel} · {s.targetLabel}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {state.tab === "history" ? (
          <ul className="jc-history">
            {state.history.length === 0 ? (
              <li className="jc-history-empty">No mock events yet — use Create, AI, Library, or Pads.</li>
            ) : (
              state.history.map((h) => (
                <li key={h.id} className="jc-history-row">
                  <span className="jc-history-time">{new Date(h.atIso).toLocaleTimeString()}</span>
                  <Chip variant="neutral">{h.kind}</Chip>
                  <span>{h.message}</span>
                </li>
              ))
            )}
          </ul>
        ) : null}
      </div>

      <section className="jc-pads-section" aria-label="Sampler pads mock">
        <h3 className="jc-pads-title">Quick pads</h3>
        <p className="jc-hint">Mock triggers only — highlights pad and logs to history.</p>
        <div className="jc-pad-grid">
          {SAMPLER_PADS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`jc-pad ${state.activePadId === p.id ? "jc-pad--active" : ""}`}
              onClick={() => dispatch({ type: "PAD", padId: p.id, label: p.label })}
            >
              {p.label}
            </button>
          ))}
        </div>
      </section>
    </>
  );
}

export function JinglesShell(): React.ReactElement {
  const [state, dispatch] = useReducer(reducer, initialState);

  const openDrawer = useCallback(() => dispatch({ type: "OPEN" }), []);
  const closeDrawer = useCallback(() => dispatch({ type: "CLOSE" }), []);

  return (
    <>
      <aside className="jc-operator-rail" aria-label="Live operator shortcuts">
        <div className="jc-rail-head">Live operator</div>
        <button type="button" className="jc-rail-card jc-rail-card--primary" onClick={openDrawer}>
          <span className="jc-rail-card-kicker">Open</span>
          <span className="jc-rail-card-title">Jingles</span>
          <span className="jc-rail-card-hint">Announcements console</span>
        </button>
        <div className="jc-rail-card jc-rail-card--disabled" aria-disabled="true">
          <span className="jc-rail-card-kicker">Soon</span>
          <span className="jc-rail-card-title">Birthdays</span>
        </div>
        <div className="jc-rail-card jc-rail-card--disabled" aria-disabled="true">
          <span className="jc-rail-card-kicker">Soon</span>
          <span className="jc-rail-card-title">Broadcasts</span>
        </div>
        <div className="jc-rail-card jc-rail-card--disabled" aria-disabled="true">
          <span className="jc-rail-card-kicker">Soon</span>
          <span className="jc-rail-card-title">Announcements</span>
        </div>
      </aside>

      {state.drawerOpen ? (
        <div className="jc-backdrop" role="presentation" onClick={closeDrawer}>
          <div
            className="jc-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="jc-drawer-title"
            onClick={(e) => e.stopPropagation()}
          >
            <JinglesDrawerChrome state={state} dispatch={dispatch} onClose={closeDrawer} />
          </div>
        </div>
      ) : null}
    </>
  );
}

// ─── Workspace persistence helpers ───────────────────────────────────────────

const PAD_STORAGE_KEY = "syncbiz:jingle-pads";
const LIBRARY_STORAGE_KEY = "syncbiz:jingle-library";
/** Hard cap so localStorage doesn't balloon across hundreds of generations. */
const LIBRARY_MAX_ITEMS = 50;

/**
 * Loads pad assignments from localStorage.
 * In Electron, localStorage is stored in the Chromium profile directory
 * (%APPDATA%/<app>/Default/Local Storage) and survives app restarts.
 * Merges saved url/scheduledAt onto the canonical seed IDs so new seed pads
 * added by future releases are always visible.
 */
function loadPads(): SamplerPadItem[] {
  if (typeof localStorage === "undefined") return SAMPLER_PADS.map((p) => ({ ...p }));
  try {
    const raw = localStorage.getItem(PAD_STORAGE_KEY);
    if (!raw) return SAMPLER_PADS.map((p) => ({ ...p }));
    const saved = JSON.parse(raw) as SamplerPadItem[];
    return SAMPLER_PADS.map((seed) => {
      const match = saved.find((s) => s.id === seed.id);
      return match
        ? {
            ...seed,
            label: match.label ?? seed.label,
            url: match.url ?? "",
            scheduledAt: match.scheduledAt,
            preRoll: match.preRoll ?? seed.preRoll ?? false,
            color: match.color ?? seed.color ?? "default",
            bellStyle: match.bellStyle ?? seed.bellStyle ?? "ding",
          }
        : { ...seed };
    });
  } catch {
    return SAMPLER_PADS.map((p) => ({ ...p }));
  }
}

function persistPads(pads: SamplerPadItem[]): void {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(PAD_STORAGE_KEY, JSON.stringify(pads));
  }
}

/**
 * Loads the persisted jingle library (generated assets) from localStorage.
 * The underlying audio files live on the server at `/api/jingles/audio/<id>`
 * (written to `data/jingles/<id>.mp3`), so we only need to remember the
 * metadata (title, script, voice, language, bell, url) here. Unknown/legacy
 * shapes are filtered defensively.
 */
function loadLibrary(): JingleAsset[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(LIBRARY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (a): a is JingleAsset =>
          !!a &&
          typeof a === "object" &&
          typeof (a as JingleAsset).id === "string" &&
          typeof (a as JingleAsset).url === "string" &&
          typeof (a as JingleAsset).title === "string",
      )
      .slice(0, LIBRARY_MAX_ITEMS);
  } catch {
    return [];
  }
}

// ── Cloud Jingle Library (workspace-authoritative) ──────────────────────────
// The saved-jingle list now lives in SyncBiz Cloud (GET/POST /api/jingles/library), so Desktop,
// Browser CONTROL and Mobile all read the SAME list. localStorage (LIBRARY_STORAGE_KEY) is kept
// untouched as a one-time import source + read-only fallback if the cloud is unreachable.
type CloudJingle = { id: string; title: string; url: string; script: string; voiceId: string; durationSec: number | null; createdAt: string };

function durationLabelToSec(label?: string): number | null {
  if (!label) return null;
  const m = label.match(/^(\d+):(\d{1,2})$/);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
}
function secToDurationLabel(sec?: number | null): string {
  if (typeof sec !== "number" || !Number.isFinite(sec) || sec < 0) return "—";
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
}
function cloudItemToAsset(it: CloudJingle): JingleAsset {
  return {
    id: it.id,
    title: it.title,
    script: it.script ?? "",
    url: it.url,
    kind: "announcement",
    durationLabel: secToDurationLabel(it.durationSec),
    voiceId: it.voiceId ?? "",
    preRoll: false,
  };
}
async function fetchCloudLibrary(): Promise<JingleAsset[]> {
  const res = await fetch("/api/jingles/library", { cache: "no-store" });
  if (!res.ok) throw new Error(`library GET ${res.status}`);
  const data = (await res.json()) as { items?: CloudJingle[] };
  return (data.items ?? []).map(cloudItemToAsset).slice(0, LIBRARY_MAX_ITEMS);
}
async function saveJingleToCloud(a: JingleAsset, audience?: Record<string, unknown> | null): Promise<JingleAsset> {
  const res = await fetch("/api/jingles/library", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: a.title, url: a.url, voiceId: a.voiceId, script: a.script, durationSec: durationLabelToSec(a.durationLabel), ...(audience ?? {}) }),
  });
  if (!res.ok) throw new Error(`library POST ${res.status}`);
  const data = (await res.json()) as { item: CloudJingle };
  return cloudItemToAsset(data.item);
}

function triggerPlayInterrupt(url: string): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = typeof window !== "undefined" ? (window as any).syncbizDesktop : null;
  if (api?.mpvPlayInterrupt) {
    // MPV needs an absolute URL. Relative paths (e.g. /api/jingles/audio/id) must be
    // resolved against the current origin so MPV can fetch the audio over HTTP.
    const absolute = url.startsWith("/") ? `${window.location.origin}${url}` : url;
    api.mpvPlayInterrupt(absolute);
  }
}

// ── Library → Quick Pad drag & drop (native HTML5; desktop-first) ───────────
const JINGLE_DND_MIME = "application/x-syncbiz-jingle";
type JingleDragPayload = { url: string; title: string; preRoll?: boolean; bellStyle?: JingleBellStyle };
/** Serialize a library item onto the drag event (custom MIME + JSON, copy effect). */
function startJingleDrag(e: React.DragEvent, payload: JingleDragPayload): void {
  e.dataTransfer.setData(JINGLE_DND_MIME, JSON.stringify(payload));
  e.dataTransfer.effectAllowed = "copy";
}
/** Parse a dropped library item, or null if the drop is not a jingle payload. */
function readJingleDrag(e: React.DragEvent): JingleDragPayload | null {
  const raw = e.dataTransfer.getData(JINGLE_DND_MIME);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as JingleDragPayload;
    return typeof p?.url === "string" ? p : null;
  } catch {
    return null;
  }
}

/** True only inside the Electron desktop player (where On-Air MPV playback exists). */
function useIsDesktopPlayer(): boolean {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    setIsDesktop(typeof window !== "undefined" && "syncbizDesktop" in window);
  }, []);
  return isDesktop;
}

// ─── JcModal — shared popup primitive (portal, backdrop, ESC, centered) ─────

function JcModal({
  open,
  title,
  onClose,
  children,
  footer,
  width = "28rem",
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: string;
}): React.ReactElement | null {
  if (!open) return null;
  const px = /rem$/.test(width) ? parseFloat(width) * 16 : parseFloat(width) || 460;
  // the app's own glass dialog (same as share / edit) instead of the old navy box
  return (
    <GlassModal title="Jingles" subtitle={title} width={Math.min(Math.round(px), 560)} onClose={onClose} footer={footer}>
      {children}
      <div style={{ height: 10 }} />
    </GlassModal>
  );
}

// ─── TriggerPads — bottom row, controller-style ─────────────────────────────
// Click assigned pad → play. Click empty pad → open edit modal.
// Pencil overlay (top-right) always opens edit modal.

function TriggerPads({
  pads,
  flashPadId,
  scheduledPadIds,
  onPlay,
  onEdit,
  onAssignDrop,
}: {
  pads: SamplerPadItem[];
  flashPadId: string | null;
  /** Pad IDs with a REAL schedule item in the engine — drives the orange dot. */
  scheduledPadIds: Set<string>;
  onPlay: (pad: SamplerPadItem) => void;
  onEdit: (padId: string) => void;
  /** A library item was dropped on a pad — assigns via the existing handler. */
  onAssignDrop: (padId: string, payload: JingleDragPayload) => void;
}): React.ReactElement {
  const tr = useTr();
  const [dropPadId, setDropPadId] = useState<string | null>(null);
  return (
    <section className="jc-trigger-section" aria-label={tr("Jingle trigger pads")}>
      <p className="jc-rail-head jcx-quickpads-head">{tr("Quick Pads")}</p>
      <div className="jc-trigger-grid">
        {pads.map((p) => {
          const assigned = Boolean(p.url);
          const isFlashing = flashPadId === p.id;
          const isScheduled = scheduledPadIds.has(p.id);
          const schedTooltip = isScheduled ? " · scheduled" : "";
          const colorClass = `jc-trigger-pad--color-${p.color ?? "default"}`;
          return (
            <div
              key={p.id}
              className={`jc-trigger-pad-wrap${dropPadId === p.id ? " jc-trigger-pad-wrap--drop" : ""}`}
              onDragOver={(e) => {
                // Only react to jingle drags; allow the drop + show highlight.
                if (e.dataTransfer.types.includes(JINGLE_DND_MIME)) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "copy";
                  if (dropPadId !== p.id) setDropPadId(p.id);
                }
              }}
              onDragLeave={() => setDropPadId((cur) => (cur === p.id ? null : cur))}
              onDrop={(e) => {
                const payload = readJingleDrag(e);
                setDropPadId(null);
                if (!payload || !payload.url) return; // ignore empty/foreign drops
                e.preventDefault();
                onAssignDrop(p.id, payload);
              }}
            >
              <button
                type="button"
                className={[
                  "jc-trigger-pad",
                  assigned ? "jc-trigger-pad--assigned" : "jc-trigger-pad--empty",
                  colorClass,
                  isFlashing ? "jc-trigger-pad--playing" : "",
                ].filter(Boolean).join(" ")}
                onClick={() => (assigned ? onPlay(p) : onEdit(p.id))}
                title={assigned ? `${tr("Play")}: ${p.label}${schedTooltip}` : tr("Click to assign")}
                aria-label={assigned ? `${tr("Play")} ${p.label}` : tr("Assign source to {label}", { label: p.label })}
              >
                <span
                  className={`jc-pad-led ${
                    isFlashing
                      ? "jc-pad-led--playing"
                      : assigned
                        ? "jc-pad-led--ready"
                        : "jc-pad-led--empty"
                  }`}
                  aria-hidden
                />
                <span className="jc-trigger-pad-label">{p.label}</span>
                {/* display only (2026-10-12): a short state line + an LED bar along the bottom edge */}
                <span className="jcx-pad-sub" aria-hidden>{isFlashing ? tr("On air") : assigned ? (isScheduled ? tr("Ready · scheduled") : tr("Ready")) : tr("Tap to assign")}</span>
                <span className="jcx-pad-bar" aria-hidden />
                {isScheduled ? <span className="jc-pad-sched-dot" aria-hidden /> : null}
              </button>
              <button
                type="button"
                className="jc-trigger-pad-edit"
                title={tr("Edit pad")}
                aria-label={`${tr("Edit")} ${p.label}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(p.id);
                }}
              >
                ✎
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─── ResultStrip — single-line output bar between content and pads ──────────

function ResultStrip({
  asset,
  onPlay,
  onAssign,
  onSchedule,
  onSave,
  onDismiss,
  previewMode = false,
  isPreviewing = false,
}: {
  asset: JingleAsset;
  onPlay: () => void;
  onAssign: () => void;
  onSchedule: () => void;
  onSave: () => void;
  onDismiss: () => void;
  /** Web: the primary button auditions the MP3 locally (Preview). Desktop: it plays On-Air. */
  previewMode?: boolean;
  isPreviewing?: boolean;
}): React.ReactElement {
  const tr = useTr();
  const playLabel = previewMode ? (isPreviewing ? `■ ${tr("Stop")}` : `▶ ${tr("Preview")}`) : `▶ ${tr("Play")}`;
  const playTitle = !asset.url
    ? tr("No audio to play")
    : previewMode
      ? tr("Preview this audio in your browser (not On-Air)")
      : tr("Play On-Air (ducks store music)");
  return (
    <div className="jc-result-strip">
      <div className="jc-result-strip-info">
        <span className="jc-result-strip-title">{asset.title || tr("Untitled")}</span>
        <span className="jc-result-strip-meta">
          {asset.kind} · {asset.durationLabel || "—"}
        </span>
      </div>
      <div className="jc-result-strip-actions">
        <button
          type="button"
          className="jc-btn jc-btn--primary jc-btn--small"
          disabled={!asset.url}
          title={playTitle}
          onClick={onPlay}
        >
          {playLabel}
        </button>
        <button
          type="button"
          className="jc-btn jc-btn--ghost jc-btn--small"
          disabled={!asset.url}
          onClick={onAssign}
        >
          {tr("Assign")}
        </button>
        <button
          type="button"
          className="jc-btn jc-btn--ghost jc-btn--small"
          disabled={!asset.url}
          onClick={onSchedule}
        >
          {tr("Schedule")}
        </button>
        <button
          type="button"
          className="jc-btn jc-btn--ghost jc-btn--small"
          onClick={onSave}
        >
          {tr("Save")}
        </button>
        <button
          type="button"
          className="jc-icon-btn jc-icon-btn--inline"
          onClick={onDismiss}
          aria-label={tr("Dismiss result")}
          title={tr("Dismiss")}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

// ─── JinglesWorkspacePanel — center-area workspace ──────────────────────────

/** Controller-style workspace: 3 tabs, persistent trigger pads, popups for detail actions. */
/** Control Room surface (HQ): the SAME Studio with Create only + the Audience chosen before Save. No local On-Air,
 *  no Pads, no local Schedule — playback from the Control Room always goes to an explicit target elsewhere. */
export type StudioControlRoomSurface = {
  /** the Audience card rendered above the actions (owned by the Control Room) */
  audienceCard: React.ReactNode;
  /** the complete audience, or null while it is still being chosen (Save is blocked until then) */
  audience: Record<string, unknown> | null;
  /** called with the saved library item (id + title) after a SUCCESSFUL save */
  onSaved?: (saved: { id: string; title: string }) => void;
  saveBlockedText: string;
};

export function JinglesWorkspacePanel({ onClose, controlRoom }: { onClose: () => void; controlRoom?: StudioControlRoomSurface }): React.ReactElement {
  const tr = useTr();
  const isCR = !!controlRoom;
  // Core state
  const [pads, setPads] = useState<SamplerPadItem[]>(() => loadPads());
  const [flashPadId, setFlashPadId] = useState<string | null>(null);
  const [resultCard, setResultCard] = useState<JingleAsset | null>(null);
  const [activeTab, setActiveTab] = useState<JinglesOpenTab>(() => takeJinglesOpenTab() ?? "create");
  // "All jingles" from the queue pane while the console is already open
  useEffect(() => {
    const on = (e: Event) => {
      const t = (e as CustomEvent<JinglesOpenTab>).detail;
      if (t === "create" || t === "library" || t === "schedule") {
        takeJinglesOpenTab();
        setActiveTab(t);
      }
    };
    window.addEventListener(JINGLES_OPEN_TAB_EVENT, on);
    return () => window.removeEventListener(JINGLES_OPEN_TAB_EVENT, on);
  }, []);
  const [draft, setDraft] = useState<AnnouncementDraft>({ ...initialDraft });
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [savedAssets, setSavedAssets] = useState<JingleAsset[]>(() => loadLibrary());
  // The schedule is stored per branch (F4): THIS screen's branch — the same one its device socket and scheduler use.
  const schedBranch = useStationBranchId();
  const initialSchedule = (branch: string | null) => {
    const persisted = branch ? loadJingleSchedule(branch) : [];
    // Seed with mock rows only on first run (when no persisted items exist).
    return persisted.length > 0 ? persisted : [...MOCK_SCHEDULE_ITEMS];
  };
  const [schedItems, setSchedItems] = useState(() => initialSchedule(stationBranchIdNow()));
  // Branch whose list `schedItems` holds; persisting waits for it so a list is never written under the wrong branch.
  const schedLoadedBranchRef = useRef<string | null>(stationBranchIdNow());
  const skipSchedPersistRef = useRef(false);

  // Status (display-only; no selector)
  const branchStatus: MockBranchLinkStatus = "online";
  const engineStatus: MockEngineStatus = "ready";

  // Web = local browser Preview (audition); Desktop = On-Air MPV playback. OFF-PLAYBACK.
  const isDesktop = useIsDesktopPlayer();
  const preview = useAudioPreview();

  // Remote On-Air: a normal Web browser has no MPV bridge, so an On-Air trigger is routed
  // through the EXISTING device→MASTER command path (cloud WS) as PLAY_INTERRUPT. Inside the
  // Electron desktop the local bridge runs directly (unchanged). This never touches Preview.
  const devicePlayer = useDevicePlayer();
  const fireOnAir = useCallback(
    (url: string) => {
      // IRON RULE: only the branch MASTER executes playback. Run the LOCAL MPV interrupt ONLY when
      // THIS desktop is itself the MASTER. When this device is CONTROL (e.g. the GOtv streamer is
      // MASTER), the jingle MUST go over WS to the master device — never the local MPV — otherwise
      // the desktop ducks/plays its own audio while the streamer stays untouched.
      const isMaster = devicePlayer?.deviceMode === "MASTER";
      if (isDesktop && isMaster) {
        triggerPlayInterrupt(url); // desktop is the branch MASTER → local MPV interrupt
      } else {
        devicePlayer?.sendCommandToMaster("PLAY_INTERRUPT", { url }); // CONTROL → cloud WS → branch MASTER
      }
    },
    [isDesktop, devicePlayer],
  );

  // Load the workspace-authoritative cloud library on open. localStorage is only a fallback +
  // a one-time import source — it is never overwritten here, so existing jingles are preserved.
  // `aliveRef` (not a per-effect "cancelled" flag): in React StrictMode (dev) the effect is run, cleaned up and run again, and the
  // once-guard below skips the second run — a per-effect flag was already "cancelled" by then, so the cloud library / pads NEVER
  // loaded in dev and the Library tab always said "Nothing saved yet". An answer is dropped only if the component really unmounted.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);
  const cloudLibLoadedRef = useRef(false);
  useEffect(() => {
    if (cloudLibLoadedRef.current) return;
    cloudLibLoadedRef.current = true;
    void (async () => {
      try {
        let cloud = await fetchCloudLibrary();
        // One-time import: push local jingles whose audio URL isn't already in the cloud. The POST
        // dedupes by audioUrl, so reopening the client never creates duplicates.
        const cloudUrls = new Set(cloud.map((a) => a.url));
        const localOnly = loadLibrary().filter((a) => a.url && !cloudUrls.has(a.url));
        if (localOnly.length > 0) {
          for (const a of localOnly) {
            try { await saveJingleToCloud(a); } catch { /* best-effort per item */ }
          }
          try { cloud = await fetchCloudLibrary(); } catch { /* keep pre-import list */ }
        }
        if (aliveRef.current) setSavedAssets(cloud);
      } catch {
        // Cloud unreachable: fall back to the local list; never blank out existing jingles.
        if (aliveRef.current) setSavedAssets(loadLibrary());
      }
    })();
  }, []);

  // Load the shared cloud pads on open (same pattern as the library). localStorage is only a
  // one-time import source + fallback — Desktop and Mobile read/write the SAME pads via the cloud.
  const cloudPadsLoadedRef = useRef(false);
  useEffect(() => {
    if (cloudPadsLoadedRef.current) return;
    cloudPadsLoadedRef.current = true;
    void (async () => {
      try {
        let cloud = await fetchCloudPads();
        // One-time import: push local pad ASSIGNMENTS (url set) not yet in the cloud. POST upserts
        // by padId, so reopening never duplicates.
        const cloudIds = new Set(cloud.map((c) => c.padId));
        const localOnly = loadPads().filter((p) => p.url && p.url.trim() && !cloudIds.has(p.id));
        if (localOnly.length > 0) {
          for (const p of localOnly) {
            try { await savePadToCloud(p); } catch { /* best-effort per pad */ }
          }
          try { cloud = await fetchCloudPads(); } catch { /* keep pre-import list */ }
        }
        if (aliveRef.current) setPads(padsFromCloud(cloud));
      } catch {
        // Cloud unreachable: keep the local pads; never blank the board.
        if (aliveRef.current) setPads(loadPads());
      }
    })();
  }, []);

  // Persist jingle schedule items (payload + timing) so the root-level
  // auto-player can fire them even when this drawer is closed.
  useEffect(() => {
    // Desktop: the branch arrives from MAIN after mount (≤ 3 s) → load THAT branch's list before any persist.
    if (!schedBranch || schedLoadedBranchRef.current === schedBranch) return;
    schedLoadedBranchRef.current = schedBranch;
    skipSchedPersistRef.current = true;
    setSchedItems(initialSchedule(schedBranch));
  }, [schedBranch]);
  useEffect(() => {
    if (!schedBranch || schedLoadedBranchRef.current !== schedBranch) return;
    if (skipSchedPersistRef.current) {
      skipSchedPersistRef.current = false; // this commit still holds the previous branch's items
      return;
    }
    persistJingleSchedule(schedBranch, schedItems);
  }, [schedItems, schedBranch]);

  // ── Pad scheduling — routes Pad Edit "Schedule at" into the SAME engine as
  // Library/Result (syncbiz:jingle-schedule → JingleScheduleAutoPlayer). Each pad
  // gets a stable schedule id `pad:<padId>`, so we upsert/remove without a second
  // scheduler or a duplicate source of truth. The legacy `pad.scheduledAt` field is
  // NOT used for firing or the indicator anymore — only these engine items are.
  const padScheduleId = (padId: string) => `pad:${padId}`;

  const removePadSchedule = useCallback((padId: string) => {
    setSchedItems((prev) => prev.filter((x) => x.id !== padScheduleId(padId)));
  }, []);

  const upsertPadSchedule = useCallback(
    (
      pad: { id: string; url?: string; label?: string; bellStyle?: JingleBellStyle; preRoll?: boolean },
      localDateTime: string,
    ) => {
      const url = (pad.url ?? "").trim();
      // Empty pad or no time → ensure no orphan schedule survives.
      if (!url || !localDateTime) {
        removePadSchedule(pad.id);
        return;
      }
      const when = new Date(localDateTime);
      if (Number.isNaN(when.getTime())) {
        removePadSchedule(pad.id);
        return;
      }
      const item: MockScheduleItem = {
        id: padScheduleId(pad.id),
        label: pad.label || "Pad",
        whenLabel: when.toLocaleString(),
        repeatLabel: "Once",
        targetLabel: "This pad",
        url,
        preRoll: pad.preRoll,
        bellStyle: pad.bellStyle ?? "ding",
        scheduledAtIso: when.toISOString(), // local → UTC, exactly like the Library path
        repeat: "once", // Pad Edit has no Repeat UI in this scope
      };
      setSchedItems((prev) => [item, ...prev.filter((x) => x.id !== item.id)]);
    },
    [removePadSchedule],
  );

  // Re-sync from the shared engine when it mutates storage externally (e.g. the
  // AutoPlayer removes a fired "once" item) so the pad indicator clears. Reuses
  // the EXISTING event/channel — no new scheduler. The JSON guard makes our own
  // persist-write (which also dispatches the event) a no-op, avoiding a loop.
  useEffect(() => {
    if (!schedBranch) return;
    const sync = () => {
      const fresh = loadJingleSchedule(schedBranch);
      setSchedItems((prev) => (JSON.stringify(prev) === JSON.stringify(fresh) ? prev : fresh));
    };
    window.addEventListener(JINGLE_SCHEDULE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(JINGLE_SCHEDULE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [schedBranch]);

  /** Pad IDs that currently have a REAL schedule item in the engine (drives the dot). */
  const scheduledPadIds = new Set(
    schedItems
      .map((s) => s.id)
      .filter((id) => id.startsWith("pad:"))
      .map((id) => id.slice(4)),
  );

  // Modal state — only one open at a time in practice
  const [editPadId, setEditPadId] = useState<string | null>(null);
  const [assignForAsset, setAssignForAsset] = useState<JingleAsset | null>(null);
  const [scheduleForAsset, setScheduleForAsset] = useState<JingleAsset | null>(null);
  const [scheduleNow, setScheduleNow] = useState(0);
  // the Control Room's Studio form (upstream) still has the "AI help" script helper; the player-side flow has its own ideas
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiIntent, setAiIntent] = useState("");
  const wsWrapRef = useRef<HTMLDivElement>(null);
  const [scheduleInline, setScheduleInline] = useState<{ t: number; r: number; b: number; l: number } | null>(null);
  /** the schedule screen grows OUT OF the thing that was pressed (a jingle tile / the Schedule button) to fill the workspace */
  const openSchedule = (a: JingleAsset, from?: HTMLElement | null) => {
    const wrap = wsWrapRef.current?.getBoundingClientRect();
    const src = from?.getBoundingClientRect();
    setScheduleInline(
      wrap && src
        ? { t: Math.max(0, src.top - wrap.top), r: Math.max(0, wrap.right - src.right), b: Math.max(0, wrap.bottom - src.bottom), l: Math.max(0, src.left - wrap.left) }
        : wrap
          ? { t: wrap.height / 2 - 20, r: wrap.width / 2 - 20, b: wrap.height / 2 - 20, l: wrap.width / 2 - 20 }
          : null,
    );
    setScheduleNow(Date.now());
    setScheduleForAsset(a);
  };

  // ── Pad operations ─────────────────────────────────────────────────────────

  const handlePadPlay = useCallback((pad: SamplerPadItem) => {
    if (!pad.url) return;
    if (pad.preRoll) {
      const bell = bellUrlFor(pad.bellStyle ?? "ding");
      if (bell) fireOnAir(bell);
    }
    fireOnAir(pad.url);
    setFlashPadId(pad.id);
    setTimeout(() => setFlashPadId(null), 650);
  }, [fireOnAir]);

  const handlePadSave = useCallback(
    (
      padId: string,
      patch: Pick<SamplerPadItem, "label" | "url" | "scheduledAt" | "color" | "bellStyle" | "preRoll">,
    ) => {
      setPads((prev) => {
        const next = prev.map((p) => (p.id === padId ? { ...p, ...patch } : p));
        persistPads(next); // localStorage fallback
        const changed = next.find((p) => p.id === padId);
        if (changed) void savePadToCloud(changed).catch(() => {}); // shared cloud (best-effort)
        return next;
      });
      // Route the pad's schedule into the shared engine (upsert when a time + audio
      // exist; remove otherwise). Empty-pad/no-time is handled inside upsert.
      upsertPadSchedule(
        { id: padId, url: patch.url, label: patch.label, bellStyle: patch.bellStyle, preRoll: patch.preRoll },
        patch.scheduledAt ?? "",
      );
      setEditPadId(null);
    },
    [upsertPadSchedule],
  );

  const handleAssignToPad = useCallback(
    (padId: string, asset: JingleAsset) => {
      setPads((prev) => {
        const next = prev.map((p) =>
          p.id === padId
            ? {
                ...p,
                url: asset.url,
                label: (asset.title || p.label).slice(0, 20),
                preRoll: asset.preRoll,
                bellStyle: asset.bellStyle ?? p.bellStyle ?? "ding",
                scheduledAt: undefined, // clear legacy field on reassign
              }
            : p,
        );
        persistPads(next); // localStorage fallback
        const changed = next.find((p) => p.id === padId);
        if (changed) void savePadToCloud(changed).catch(() => {}); // shared cloud (best-effort)
        return next;
      });
      // Safety: a reassigned pad must not keep an old schedule that would fire the
      // NEW audio at the OLD time. Drop the linked schedule; user can re-schedule.
      removePadSchedule(padId);
    },
    [removePadSchedule],
  );

  // ── Create / Generate ──────────────────────────────────────────────────────

  const handleGenerate = useCallback(async () => {
    const text = draft.body.trim();
    if (!text) {
      setGenerateError("Script is required — type what the announcer should say.");
      return;
    }
    setGenerateError(null);
    setGenerating(true);
    const title = draft.title.trim() || text.split(/\s+/).slice(0, 4).join(" ") || "Untitled jingle";
    try {
      const res = await fetch("/api/jingles/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          voiceId: draft.voice,
          language: draft.language,
          speed: draft.speed,
        }),
      });
      const data = (await res.json()) as { url?: string; durationLabel?: string; error?: string };
      if (!res.ok || !data.url) {
        setGenerateError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      const asset: JingleAsset = {
        id: hid(),
        title,
        script: draft.body,
        url: data.url,
        kind: draft.kind,
        durationLabel: data.durationLabel ?? "—",
        voiceId: draft.voice,
        preRoll: draft.preRoll,
        bellStyle: draft.bellStyle,
        language: draft.language,
        speed: draft.speed,
      };
      // Generate produces a TRANSIENT result only — it is NOT added to the Library.
      // Adding to the Library is an explicit Save action (handleResultSaveToLibrary).
      // The MP3 already lives on the server (data/jingles/<id>.mp3); Add to Pad and
      // Schedule persist the url on their own, so an unsaved result is never orphaned.
      setResultCard(asset);
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  }, [draft]);

  // ── Result strip actions ───────────────────────────────────────────────────

  const handleResultPlay = useCallback(() => {
    if (!resultCard?.url) return;
    if (resultCard.preRoll) {
      const bell = bellUrlFor(resultCard.bellStyle ?? "ding");
      if (bell) fireOnAir(bell);
    }
    fireOnAir(resultCard.url);
  }, [resultCard, fireOnAir]);

  const handleResultSaveToLibrary = useCallback(async () => {
    if (!resultCard) return;
    if (controlRoom && !controlRoom.audience) { setGenerateError(controlRoom.saveBlockedText); return; }
    try {
      const saved = await saveJingleToCloud(resultCard, controlRoom ? controlRoom.audience : undefined);
      controlRoom?.onSaved?.({ id: saved.id, title: saved.title });
      // Cloud is authoritative — refetch so this client shows the same list every other client sees.
      try {
        setSavedAssets(await fetchCloudLibrary());
      } catch {
        // Save succeeded but the refetch failed — show the saved item optimistically (dedupe by url).
        setSavedAssets((prev) => (prev.some((a) => a.url === saved.url) ? prev : [saved, ...prev]));
      }
      setGenerateError(null);
    } catch {
      // Never claim a successful save. Surface the failure; keep the transient result for retry.
      setGenerateError("Couldn't save to the cloud library — check your connection and try again.");
    }
  }, [resultCard, controlRoom]);

  /* the tab bar glides under the active tab (round 7) */
  const wsTabsRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const root = wsTabsRef.current;
    if (!root) return;
    const place = () => {
      const el = root.querySelector<HTMLElement>('[aria-selected="true"]');
      if (!el) return;
      root.style.setProperty("--bar-x", `${el.offsetLeft}px`);
      root.style.setProperty("--bar-w", `${el.offsetWidth}px`);
      root.dataset.ready = "1";
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(root);
    return () => ro.disconnect();
  }, [activeTab]);

  const editingPad = editPadId ? pads.find((p) => p.id === editPadId) ?? null : null;

  return (
    <div className={`jc-workspace-panel sb-anim-rise${isCR ? " jc-cr" : ""}`}>
      {/* ── Header: title + tiny status LEDs + close ───────────────────── */}
      <header className="jc-ws-header">
        <div className="jc-ws-header-title">
          <h2 className="jc-drawer-title">{tr("Jingles")}</h2>
        </div>
        <div className="jc-ws-header-status-mini" aria-label={tr("System status")}>
          <span
            className={`jc-status-led jc-status-led--${branchStatus === "online" ? "ok" : "err"}`}
            title={`Branch: ${branchStatus}`}
            aria-hidden
          />
          <span className="jc-status-mini-label">{tr("Branch")}</span>
          <span className="jc-status-mini-sep" aria-hidden />
          <span
            className={`jc-status-led jc-status-led--${
              engineStatus === "ready" ? "ok" : engineStatus === "busy" ? "warn" : "err"
            }`}
            title={`Engine: ${engineStatus}`}
            aria-hidden
          />
          <span className="jc-status-mini-label">{tr("Engine")}</span>
        </div>
        <button
          type="button"
          className="jc-icon-btn"
          onClick={onClose}
          aria-label={tr("Close Jingles Control")}
        >
          ✕
        </button>
      </header>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      <div className="jc-ws-body">
        {/* Content scroll area: tabs + panels */}
        <div className="jc-ws-content">
          {!isCR ? (
          <nav ref={wsTabsRef} className="jc-ws-tabs" role="tablist">
            {(
              [
                ["create", "Create"],
                ["library", "Library"],
                ["schedule", "Schedule"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={activeTab === id}
                className={`jc-ws-tab ${activeTab === id ? "jc-ws-tab--active" : ""}`}
                onClick={() => setActiveTab(id)}
              >
                {tr(label)}
              </button>
            ))}
            <span className="jc-ws-tab-bar" aria-hidden />
          </nav>

          ) : null}

          {/* ── Quick Pads — only where pads are managed (the Library tab); Create stays clean ── */}
          {!isCR && activeTab === "library" ? (
          <div className="jcx-quickpads">
            <TriggerPads
              pads={pads}
              flashPadId={flashPadId}
              scheduledPadIds={scheduledPadIds}
              onPlay={handlePadPlay}
              onEdit={(id) => setEditPadId(id)}
              onAssignDrop={(padId, payload) =>
                handleAssignToPad(padId, {
                  id: hid(),
                  title: payload.title,
                  script: "",
                  url: payload.url,
                  kind: "announcement",
                  durationLabel: "—",
                  voiceId: "",
                  preRoll: payload.preRoll ?? false,
                  bellStyle: payload.bellStyle,
                })
              }
            />
          </div>
          ) : null}

          {/* Active workspace — the ONLY scroll region; header/tabs/pads stay fixed above */}
          <div ref={wsWrapRef} className="jcx-ws-wrap">
          <div className="jcx-active-workspace">
          {/* ── CREATE — three calm steps (words → voice → result), see jingle-create-flow.tsx ── */}
          {activeTab === "create" ? (
            isCR ? (
            <div className="jcx-create jc-form">
              {/* Compact settings bar — one row of compact selects (same values/handlers) */}
              <div className="jcx-settings-bar">
                <label className="jc-field jcx-set jcx-set--title">
                  <span>{tr("Title")}</span>
                  <input
                    value={draft.title}
                    onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                    placeholder={tr("e.g. Weekend fresh produce")}
                  />
                </label>
                {/* VxSelect (owner 2026-10-13): dark list instead of the native white popup — same values, same setDraft logic */}
                <div className="jc-field jcx-set">
                  <span id="jcx-set-type">{tr("Type")}</span>
                  <VxSelect
                    size="sm"
                    labelledBy="jcx-set-type"
                    value={draft.kind}
                    options={[
                      { value: "jingle", label: tr("Jingle") },
                      { value: "announcement", label: tr("Announcement") },
                      { value: "broadcast", label: tr("Broadcast") },
                    ]}
                    onChange={(v) => setDraft((d) => ({ ...d, kind: v as AnnouncementDraft["kind"] }))}
                  />
                </div>
                <div className="jc-field jcx-set">
                  <span id="jcx-set-lang">{tr("Language")}</span>
                  <VxSelect
                    size="sm"
                    labelledBy="jcx-set-lang"
                    value={draft.language}
                    options={[
                      { value: "en", label: "English" },
                      { value: "he", label: "עברית" },
                    ]}
                    onChange={(v) =>
                      setDraft((d) => ({
                        ...d,
                        language: v as JingleLanguage,
                        voice: VOICE_PRESETS_BY_LANG[v as JingleLanguage][0].voiceId,
                      }))
                    }
                  />
                </div>
                <div className="jc-field jcx-set">
                  <span id="jcx-set-voice">{tr("Voice")}</span>
                  <VxSelect
                    size="sm"
                    labelledBy="jcx-set-voice"
                    value={draft.voice}
                    options={VOICE_PRESETS_BY_LANG[draft.language].map((v) => ({ value: v.voiceId, label: voiceMenuLabel(v, draft.language) }))}
                    onChange={(v) => setDraft((d) => ({ ...d, voice: v }))}
                  />
                </div>
                {draft.language !== "he" ? (
                  <div className="jc-field jcx-set">
                    <span id="jcx-set-speed">{tr("Speed")}</span>
                    <VxSelect
                      size="sm"
                      labelledBy="jcx-set-speed"
                      value={draft.speed}
                      options={[
                        { value: "slow", label: tr("Slow") },
                        { value: "normal", label: tr("Normal") },
                        { value: "fast", label: tr("Fast") },
                      ]}
                      onChange={(v) => setDraft((d) => ({ ...d, speed: v as JingleSpeed }))}
                    />
                  </div>
                ) : null}
                <div className="jc-field jcx-set">
                  <span id="jcx-set-bell">{tr("Bell")}</span>
                  <VxSelect
                    size="sm"
                    labelledBy="jcx-set-bell"
                    value={draft.preRoll ? draft.bellStyle : "off"}
                    options={BELL_PRESETS.map((b) => ({ ...b, label: tr(b.label) }))}
                    onChange={(v) =>
                      setDraft((d) => ({
                        ...d,
                        preRoll: v !== "off",
                        bellStyle: v === "off" ? d.bellStyle : (v as JingleBellStyle),
                      }))
                    }
                  />
                </div>
              </div>

              {/* Main: Script hero (left) + Result (right) — fills remaining height */}
              <div className="jcx-create-main">
                <div className="jc-script-wrap jcx-script-hero">
                  <textarea
                    value={draft.body}
                    onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
                    placeholder={draft.language === "he" ? "מה על הקריין להגיד?" : tr("What should the announcer say?")}
                    dir={draft.language === "he" ? "rtl" : "ltr"}
                  />
                  <button
                    type="button"
                    className="jc-script-ai-btn"
                    onClick={() => setAiModalOpen(true)}
                    title={tr("Let AI write this")}
                    aria-label={tr("Open AI compose")}
                  >
                    <span className="jc-script-ai-btn-spark" aria-hidden>✦</span>
                    <span>AI</span>
                  </button>
                </div>

                <aside className="jcx-result-pane" aria-label={tr("Result")}>
                  {resultCard ? (
                    <div className="jcx-result">
                      <div className="jcx-result-head">
                        <span className="jcx-result-title">{resultCard.title || tr("Untitled")}</span>
                        <span className="jcx-result-meta">
                          {resultCard.kind} · {resultCard.durationLabel || "—"}
                        </span>
                      </div>
                      {/* PREVIEW is LOCAL-ONLY and can NEVER broadcast. In the desktop app local browser audio is
                          muted (all sound goes through MPV = On-Air), so Preview is shown as unavailable there
                          instead of silently turning into On-Air. On-Air is a separate, explicit button. */}
                      <button
                        type="button"
                        className="jcx-result-play"
                        disabled={!resultCard.url || isDesktop}
                        onClick={() => {
                          if (!isDesktop) preview.toggle(resultCard.url);
                        }}
                        title={isDesktop ? tr("Preview isn't available in the desktop app yet — use a browser or phone to preview") : tr("Preview in your browser (not On-Air)")}
                      >
                        {!isDesktop && preview.previewUrl === resultCard.url ? `■ ${tr("Stop")}` : `▶ ${tr("Preview")}`}
                      </button>
                      {/* local On-Air never on the Control Room surface (HQ plays only to an explicit target) */}
                      {isDesktop && !isCR ? (
                        <button
                          type="button"
                          className="jcx-result-play"
                          disabled={!resultCard.url}
                          onClick={handleResultPlay}
                          title={tr("Play On-Air — the branch hears this (ducks store music)")}
                        >
                          📡 {tr("On-Air")}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="jcx-result-dismiss"
                        onClick={() => {
                          preview.stop();
                          setResultCard(null);
                        }}
                        aria-label={tr("Dismiss result")}
                        title={tr("Dismiss")}
                      >
                        ✕
                      </button>
                      {preview.error ? <p className="jc-hint jcx-result-err" role="alert">{preview.error}</p> : null}
                    </div>
                  ) : (
                    <div className="jcx-result-empty">
                      <span className="jcx-result-empty-icon" aria-hidden>🎙</span>
                      <p>{tr("Your announcement will appear here")}</p>
                    </div>
                  )}
                </aside>
              </div>

              {/* Bottom action bar — Generate always visible; result actions after generation */}
              {generateError ? (
                <div className="jc-err-msg jcx-action-err" role="alert">{generateError}</div>
              ) : null}
              {controlRoom ? <div className="jcx-cr-audience">{controlRoom.audienceCard}</div> : null}
              <div className="jcx-action-bar">
                <button
                  type="button"
                  className="jc-btn jc-btn--primary jc-btn--lg jcx-generate-cta"
                  disabled={generating}
                  onClick={() => void handleGenerate()}
                >
                  {generating ? tr("Generating…") : tr("Generate Announcement")}
                </button>
                {resultCard ? (
                  <>
                    <button type="button" className="jc-btn jc-btn--ghost" onClick={handleResultSaveToLibrary}>{tr("Save")}</button>
                    {!isCR ? <button type="button" className="jc-btn jc-btn--ghost" onClick={() => setAssignForAsset(resultCard)}>{tr("Add to Pad")}</button> : null}
                    {!isCR ? <button type="button" className="jc-btn jc-btn--ghost" onClick={() => setScheduleForAsset(resultCard)}>{tr("Schedule")}</button> : null}
                  </>
                ) : null}
              </div>
            </div>
            ) : (
            <JingleCreateFlow
              draft={draft}
              setDraft={setDraft}
              generating={generating}
              error={generateError}
              onGenerate={() => void handleGenerate()}
              result={resultCard}
              isDesktop={isDesktop}
              previewing={!!resultCard && preview.previewUrl === resultCard.url}
              onPlay={isDesktop ? handleResultPlay : () => resultCard && preview.toggle(resultCard.url)}
              onSave={() => void handleResultSaveToLibrary()}
              onAddToPad={() => resultCard && setAssignForAsset(resultCard)}
              onSchedule={(el) => resultCard && openSchedule(resultCard, el)}
              onNew={() => {
                preview.stop();
                setResultCard(null);
                setGenerateError(null);
                setDraft({ ...initialDraft });
              }}
            />
            )
          ) : null}

          {/* ── LIBRARY ────────────────────────────────────────────── */}
          {activeTab === "library" ? (
            <div className="jc-ws-panel">
              {savedAssets.length > 0 ? (
                <div className="jcl-wrap">
                  <div className="jcl-grid">
                    {savedAssets.map((a, i) => {
                      const on = !isDesktop && preview.previewUrl === a.url;
                      return (
                        <div
                          key={a.id}
                          className={`jcl-tile${on ? " is-on" : ""}`}
                          style={{ ["--d" as string]: `${Math.min(i, 12) * 40}ms`, ["--c" as string]: jingleTint(a.id) } as React.CSSProperties}
                          draggable={!!a.url}
                          onDragStart={(e) => startJingleDrag(e, { url: a.url, title: a.title, preRoll: a.preRoll, bellStyle: a.bellStyle })}
                          title={a.url ? tr("Drag onto a Quick Pad") : undefined}
                        >
                          <button
                            type="button"
                            className="jcl-hit"
                            disabled={!a.url}
                            onClick={() => (isDesktop ? fireOnAir(a.url) : preview.toggle(a.url))}
                            aria-label={`${on ? tr("Stop") : tr("Play")} ${a.title}`}
                          />
                          <span className="jcl-play" aria-hidden>
                            {on ? (
                              <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2.6" strokeLinejoin="round"><rect x="7" y="7" width="10" height="10" rx="2.4" /></svg>
                            ) : (
                              <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2.6" strokeLinejoin="round"><path d="M8.5 5.5v13l10.5-6.5L8.5 5.5z" /></svg>
                            )}
                          </span>
                          <div className="jcl-acts">
                            <button type="button" disabled={!a.url} title={tr("Add to a pad")} aria-label={tr("Add {title} to a pad", { title: a.title })} onClick={() => setAssignForAsset(a)}>
                              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="4" y="4" width="6.5" height="6.5" rx="1.8" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.8" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.8" /><path d="M16.75 14v6M13.75 17h6" /></svg>
                            </button>
                            <button type="button" disabled={!a.url} title={tr("Schedule")} aria-label={`${tr("Schedule")} ${a.title}`} onClick={(e) => openSchedule(a, e.currentTarget.closest(".jcl-tile") as HTMLElement | null)}>
                              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 1.8" /></svg>
                            </button>
                            <button type="button" title={tr("Delete from library")} aria-label={`${tr("Delete")} ${a.title}`} onClick={() => setSavedAssets((prev) => prev.filter((x) => x.id !== a.id))}>
                              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 7h16M9.5 7V4.8h5V7M6.5 7l.8 12.2h9.4L17.5 7" /></svg>
                            </button>
                          </div>
                          <span className="jcl-title" dir="auto">{a.title}</span>
                          <span className="jcl-meta">{a.durationLabel && a.durationLabel !== "—" ? a.durationLabel : ""}</span>
                        </div>
                      );
                    })}
                  </div>
                  <button type="button" className="jcl-new" onClick={() => setActiveTab("create")}>
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>
                    {tr("New jingle")}
                  </button>
                </div>
              ) : null}

              {savedAssets.length === 0 ? (
                <div className="jc-empty">
                  <p>{tr("Nothing saved yet.")}</p>
                  <button type="button" className="sb-dj-pill" onClick={() => setActiveTab("create")}>{tr("Create a jingle")}</button>
                </div>
              ) : null}
              {SHOW_SAMPLE_LIBRARY ? <p className="jc-ws-section-label">{tr("Sample library")}</p> : null}
              <ul className="jc-lib">
                {(SHOW_SAMPLE_LIBRARY ? MOCK_LIBRARY_ITEMS : []).map((item) => {
                  const itemAsset: JingleAsset = {
                    id: item.id,
                    title: item.title,
                    script: "",
                    url: "",
                    kind: item.kind,
                    durationLabel: item.durationLabel,
                    voiceId: "",
                    preRoll: false,
                  };
                  return (
                    <li key={item.id} className="jc-lib-row">
                      <div
                        className="jcx-lib-drag"
                        draggable={!!itemAsset.url}
                        onDragStart={(e) => startJingleDrag(e, { url: itemAsset.url, title: itemAsset.title, preRoll: itemAsset.preRoll, bellStyle: itemAsset.bellStyle })}
                        title={itemAsset.url ? tr("Drag onto a Quick Pad") : undefined}
                      >
                        <div className="jc-lib-title">
                          {item.favorite ? (
                            <span className="jc-star" aria-hidden>
                              ★
                            </span>
                          ) : null}
                          {item.title}
                        </div>
                        <div className="jc-lib-meta">
                          {item.kind} · {item.durationLabel} · {item.tags.join(", ")}
                        </div>
                      </div>
                      <div className="jc-lib-actions">
                        <button
                          type="button"
                          className="jc-btn jc-btn--small jc-btn--ghost"
                          onClick={() => setAssignForAsset(itemAsset)}
                        >
                          {tr("Add to Pad")}
                        </button>
                        <button
                          type="button"
                          className="jc-btn jc-btn--small jc-btn--ghost"
                          onClick={() => openSchedule(itemAsset)}
                        >
                          {tr("Schedule")}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {/* ── SCHEDULE ───────────────────────────────────────────── */}
          {activeTab === "schedule" ? (
            <div className="jc-ws-panel jcs-panel">
              {schedItems.length > 0 ? (
                <ul className="jcs-list">
                  {schedItems.map((si, i) => {
                    const time = si.timeOfDay ?? si.whenLabel.match(/(\d{1,2}:\d{2})\s*$/)?.[1] ?? "";
                    const next = whenNextLabel(si);
                    return (
                      <li key={si.id} className="jcs-row" style={{ ["--d" as string]: `${Math.min(i, 10) * 45}ms` } as React.CSSProperties}>
                        <span className="jcs-time">{time || "—"}</span>
                        <span className="jcs-text">
                          <b dir="auto">{si.label}</b>
                          <i>{localizeWhen(si.whenLabel.replace(/\s*·?\s*\d{1,2}:\d{2}\s*$/, "") || si.repeatLabel, tr)}</i>
                        </span>
                        {next ? <span className="jcs-next">{localizeWhen(next, tr)}</span> : null}
                        <button
                          type="button"
                          className="jcs-x"
                          onClick={() => setSchedItems((prev) => prev.filter((x) => x.id !== si.id))}
                          title={tr("Remove schedule")}
                          aria-label={`${tr("Remove schedule")} ${si.label}`}
                        >
                          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden><path d="M4 4l8 8M12 4l-8 8" /></svg>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="jc-empty jcs-empty">
                  <svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 1.8" /></svg>
                  <p>{tr("Nothing is scheduled yet.")}</p>
                  <span>{tr("Pick a jingle in the Library and press the clock.")}</span>
                  <button type="button" className="sb-dj-pill" onClick={() => setActiveTab("library")}>{tr("Open the Library")}</button>
                </div>
              )}
            </div>
          ) : null}
          </div>
          {scheduleForAsset ? (
            <JingleScheduleDialog
              jingle={{
                id: scheduleForAsset.id,
                label: scheduleForAsset.title,
                url: scheduleForAsset.url,
                color: "#d1d1d6",
                bell: scheduleForAsset.preRoll ? (scheduleForAsset.bellStyle ?? "ding") : null,
              }}
              origin={null}
              inline={scheduleInline ?? undefined}
              nowMs={scheduleNow}
              onClose={() => setScheduleForAsset(null)}
            />
          ) : null}
          </div>
        </div>

      </div>

      {/* ── Modals ────────────────────────────────────────────────── */}
      {isCR ? (
        <AIComposeModal
          open={aiModalOpen}
          intent={aiIntent}
          onIntentChange={setAiIntent}
          onUse={(text) => {
            setDraft((d) => ({ ...d, body: text }));
            setAiModalOpen(false);
            setActiveTab("create");
          }}
          onClose={() => setAiModalOpen(false)}
        />
      ) : null}

      <PadEditModal
        pad={editingPad}
        onSave={(patch) => {
          if (!editPadId) return;
          handlePadSave(editPadId, patch);
        }}
        onClose={() => setEditPadId(null)}
      />

      <AssignToPadModal
        asset={assignForAsset}
        pads={pads}
        onPick={(padId) => {
          if (!assignForAsset) return;
          handleAssignToPad(padId, assignForAsset);
          setAssignForAsset(null);
        }}
        onClose={() => setAssignForAsset(null)}
      />

    </div>
  );
}

// ─── AIComposeModal ─────────────────────────────────────────────────────────

function AIComposeModal({
  open,
  intent,
  onIntentChange,
  onUse,
  onClose,
}: {
  open: boolean;
  intent: string;
  onIntentChange: (v: string) => void;
  onUse: (text: string) => void;
  onClose: () => void;
}): React.ReactElement | null {
  return (
    <JcModal open={open} title="Let AI write the script" onClose={onClose} width="32rem">
      <label className="jc-field">
        <span>What should the announcer say?</span>
        <textarea
          rows={3}
          value={intent}
          onChange={(e) => onIntentChange(e.target.value)}
          placeholder="e.g. remind customers about closing in 15 minutes, warm and friendly tone"
        />
      </label>
      <p className="jc-hint">Sample suggestions — AI API not yet connected.</p>
      <ul className="jc-ai-cards">
        {MOCK_AI_SUGGESTIONS.map((text, i) => (
          <li key={i} className="jc-ai-card">
            <p>{text}</p>
            <div className="jc-ai-card-actions">
              <button
                type="button"
                className="jc-btn jc-btn--small jc-btn--primary"
                onClick={() => onUse(text)}
              >
                Use this
              </button>
            </div>
          </li>
        ))}
      </ul>
    </JcModal>
  );
}

// ─── PadEditModal ───────────────────────────────────────────────────────────

type PadEditPatch = Pick<
  SamplerPadItem,
  "label" | "url" | "scheduledAt" | "color" | "bellStyle" | "preRoll"
>;

const PAD_COLOR_OPTIONS: readonly { value: PadColor; label: string; swatch: string }[] = [
  { value: "default", label: "Emerald", swatch: "#34d399" },
  { value: "sky",     label: "Sky",     swatch: "#38bdf8" },
  { value: "violet",  label: "Violet",  swatch: "#a78bfa" },
  { value: "indigo",  label: "Indigo",  swatch: "#6366f1" },
  { value: "pink",    label: "Pink",    swatch: "#f472b6" },
  { value: "rose",    label: "Rose",    swatch: "#fb7185" },
  { value: "amber",   label: "Amber",   swatch: "#fbbf24" },
  { value: "lime",    label: "Lime",    swatch: "#a3e635" },
  { value: "teal",    label: "Teal",    swatch: "#2dd4bf" },
];

function PadEditModal({
  pad,
  onSave,
  onClose,
}: {
  pad: SamplerPadItem | null;
  onSave: (patch: PadEditPatch) => void;
  onClose: () => void;
}): React.ReactElement {
  if (!pad) {
    return (
      <JcModal open={false} title="" onClose={onClose}>
        {null}
      </JcModal>
    );
  }
  return <PadEditModalBody key={pad.id} pad={pad} onSave={onSave} onClose={onClose} />;
}

function PadEditModalBody({
  pad,
  onSave,
  onClose,
}: {
  pad: SamplerPadItem;
  onSave: (patch: PadEditPatch) => void;
  onClose: () => void;
}): React.ReactElement {
  const [label, setLabel] = useState(pad.label);
  const [url, setUrl] = useState(pad.url);
  const [color, setColor] = useState<PadColor>(pad.color ?? "default");
  const [bellStyle] = useState<JingleBellStyle>(pad.bellStyle ?? "ding");
  const [preRoll, setPreRoll] = useState<boolean>(pad.preRoll ?? true);

  // round 9 (owner: "simplify"): a pad is a name, a colour, a bell and its sound — no URL typing, no date field
  // (scheduling lives in the ⋯ of the jingle itself).
  return (
    <JcModal
      open={true}
      title={`Edit pad: ${pad.label}`}
      onClose={onClose}
      width="28rem"
      footer={
        <>
          <button type="button" className="sb-wz-btn" onClick={onClose}>
            Cancel
          </button>
          <span className="sb-wz-spacer" />
          <button
            type="button"
            className="sb-wz-btn sb-wz-btn--primary"
            onClick={() =>
              onSave({
                label: label.trim() || pad.label,
                url: url.trim(),
                scheduledAt: pad.scheduledAt,
                color,
                bellStyle,
                preRoll,
              })
            }
          >
            Save
          </button>
        </>
      }
    >
      <label className="jc-field">
        <span>Name</span>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Pad name" maxLength={24} autoFocus />
      </label>

      <div className="jc-field">
        <span>Colour</span>
        <div className="jc-swatches" role="radiogroup" aria-label="Pad colour">
          {PAD_COLOR_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={color === opt.value}
              title={opt.label}
              className={`jc-swatch${color === opt.value ? " is-on" : ""}`}
              style={{ ["--sw" as string]: opt.swatch } as React.CSSProperties}
              onClick={() => setColor(opt.value)}
            />
          ))}
        </div>
      </div>

      <div className="jc-field">
        <span>Bell at the start</span>
        <button type="button" className={`sb-jf-bell${preRoll ? " is-on" : ""}`} onClick={() => setPreRoll((v) => !v)} aria-pressed={preRoll}>
          {preRoll ? "On" : "Off"}
          <span className="sb-jf-switch" aria-hidden><i /></span>
        </button>
      </div>

      <div className="jc-field">
        <span>Sound</span>
        <div className="jc-pad-sound">
          <span>{url.trim() ? "A jingle is on this pad" : "Empty — add a jingle from the Library"}</span>
          {url.trim() ? (
            <button type="button" className="sb-dj-pill" onClick={() => setUrl("")}>
              Clear
            </button>
          ) : null}
        </div>
      </div>
    </JcModal>
  );
}

// ─── AssignToPadModal ───────────────────────────────────────────────────────

function AssignToPadModal({
  asset,
  pads,
  onPick,
  onClose,
}: {
  asset: JingleAsset | null;
  pads: SamplerPadItem[];
  onPick: (padId: string) => void;
  onClose: () => void;
}): React.ReactElement | null {
  const open = asset !== null;
  return (
    <JcModal
      open={open}
      title={asset ? `Add "${asset.title}" to Pad` : ""}
      onClose={onClose}
      width="28rem"
    >
      <p className="jc-hint">Choose a pad. Existing assignments will be replaced.</p>
      <div className="jc-pad-picker-grid">
        {pads.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`jc-pad-picker-btn ${p.url ? "jc-pad-picker-btn--has" : ""}`}
            onClick={() => onPick(p.id)}
            title={p.url ? "In use — will be replaced" : "Empty pad"}
          >
            <span className="jc-pad-picker-name" dir="auto">{p.label}</span>
            <span className={`jc-pad-picker-dot ${p.url ? "jc-pad-picker-dot--on" : ""}`} />
          </button>
        ))}
      </div>
    </JcModal>
  );
}

// ─── ScheduleAssetModal ─────────────────────────────────────────────────────

function ScheduleAssetModal({
  asset,
  onConfirm,
  onClose,
}: {
  asset: JingleAsset | null;
  onConfirm: (scheduledAt: string, repeat: string, target: string) => void;
  onClose: () => void;
}): React.ReactElement {
  if (!asset) {
    return (
      <JcModal open={false} title="" onClose={onClose}>
        {null}
      </JcModal>
    );
  }
  return <ScheduleAssetModalBody key={asset.id} asset={asset} onConfirm={onConfirm} onClose={onClose} />;
}

function ScheduleAssetModalBody({
  asset,
  onConfirm,
  onClose,
}: {
  asset: JingleAsset;
  onConfirm: (scheduledAt: string, repeat: string, target: string) => void;
  onClose: () => void;
}): React.ReactElement {
  // Date + Time are split for a cleaner UI, then recombined into the exact
  // wall-clock string ("2026-04-21T09:00") the existing handler already expects
  // (same shape `datetime-local` produced) — no scheduling-logic change.
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [repeat, setRepeat] = useState("once");
  const [target, setTarget] = useState("default");
  const when = date && time ? `${date}T${time}` : "";

  return (
    <JcModal
      open={true}
      title={`Schedule "${asset.title}"`}
      onClose={onClose}
      width="28rem"
      footer={
        <>
          <button type="button" className="jc-btn jc-btn--ghost jc-btn--small" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="jc-btn jc-btn--primary jc-btn--small"
            disabled={!when}
            onClick={() => onConfirm(when, repeat, target)}
          >
            Schedule
          </button>
        </>
      }
    >
      <div className="jc-field">
        <span>When</span>
        <div className="jcx-when-row">
          <input type="date" className="jc-datetime" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
          <input type="time" className="jc-datetime" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time" />
        </div>
      </div>
      <div className="jc-field">
        <span>Repeat</span>
        <SegBtn
          options={[
            { value: "once", label: "Once" },
            { value: "daily", label: "Daily" },
            { value: "weekly", label: "Weekly" },
          ]}
          value={repeat}
          onChange={(v) => setRepeat(v)}
        />
      </div>
      <label className="jc-field">
        <span>Where</span>
        <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Branch / device" dir="auto" />
      </label>
    </JcModal>
  );
}

/** Web / Command Pads entry — same mock drawer; independent React tree from playback. */
export function JinglesControlWebDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): React.ReactElement | null {
  const [state, dispatch] = useReducer(reducer, initialState);
  const finalizeClose = useCallback(() => {
    dispatch({ type: "CLOSE" });
    onClose();
  }, [onClose]);
  if (!open) return null;
  const panel = (
    <div className="jc-backdrop jc-backdrop--portal" role="presentation" onClick={finalizeClose}>
      <div
        className="jc-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="jc-drawer-title"
        onClick={(e) => e.stopPropagation()}
      >
        <JinglesDrawerChrome state={state} dispatch={dispatch} onClose={finalizeClose} />
      </div>
    </div>
  );
  if (typeof document !== "undefined") {
    return createPortal(panel, document.body);
  }
  return panel;
}
