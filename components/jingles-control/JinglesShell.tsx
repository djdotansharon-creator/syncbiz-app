/**
 * JINGLES CONTROL — phase-1 mock operator UI only.
 * - Lives in its own React root (`jingles-shell-bridge`); open/close/tab changes are local state only.
 * - Does not call transport, WS, MPV, or main-process playback — hero/dock/library roots are unrelated.
 */
import React, { useReducer, useCallback, useState, useEffect, type Dispatch } from "react";
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
import { loadJingleSchedule, persistJingleSchedule } from "./schedule-storage";

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

// ─── Voice presets ────────────────────────────────────────────────────────────
// Curated per language. All IDs confirmed on ElevenLabs' shared library.
// The multilingual model `eleven_multilingual_v2` handles Hebrew via these voices.
const VOICE_PRESETS_BY_LANG: Record<JingleLanguage, readonly { label: string; voiceId: string }[]> = {
  en: [
    { label: "Announcer Male",   voiceId: "JBFqnCBsd6RMkjVDRZzb" }, // George
    { label: "Announcer Female", voiceId: "EXAVITQu4vr4xnSDxMaL" }, // Sarah
    { label: "Energetic Male",   voiceId: "TX3LPaxmHKxFdv7VOQHJ" }, // Liam
    { label: "Energetic Female", voiceId: "cgSgspJ2msm6clMCkdW9" }, // Jessica
  ],
  he: [
    { label: "Host M",    voiceId: "pNInz6obpgDQGcFmaJgB" }, // Adam (multilingual)
    { label: "Host F",    voiceId: "XrExE9yKIg1WjnnlVkGX" }, // Matilda
    { label: "Energetic", voiceId: "ErXwobaYiN019PkySvjV" }, // Antoni
    { label: "Warm",      voiceId: "21m00Tcm4TlvDq8ikWAM" }, // Rachel
  ],
};

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
              <span>Title</span>
              <input
                value={state.draft.title}
                onChange={(e) => dispatch({ type: "DRAFT_PATCH", patch: { title: e.target.value } })}
                placeholder="e.g. Weekend fresh produce"
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

function persistLibrary(assets: JingleAsset[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      LIBRARY_STORAGE_KEY,
      JSON.stringify(assets.slice(0, LIBRARY_MAX_ITEMS)),
    );
  } catch {
    /* quota / unavailable — ignore */
  }
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
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const body = (
    <div className="jc-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="jc-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ width: `min(${width}, calc(100vw - 2rem))` }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="jc-modal-header">
          <h3 className="jc-modal-title">{title}</h3>
          <button type="button" className="jc-icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="jc-modal-body">{children}</div>
        {footer ? <footer className="jc-modal-footer">{footer}</footer> : null}
      </div>
    </div>
  );

  if (typeof document !== "undefined") {
    return createPortal(body, document.body);
  }
  return body;
}

// ─── TriggerPads — bottom row, controller-style ─────────────────────────────
// Click assigned pad → play. Click empty pad → open edit modal.
// Pencil overlay (top-right) always opens edit modal.

function TriggerPads({
  pads,
  flashPadId,
  onPlay,
  onEdit,
}: {
  pads: SamplerPadItem[];
  flashPadId: string | null;
  onPlay: (pad: SamplerPadItem) => void;
  onEdit: (padId: string) => void;
}): React.ReactElement {
  return (
    <section className="jc-trigger-section" aria-label="Jingle trigger pads">
      <p className="jc-rail-head" style={{ marginBottom: "0.5rem" }}>Trigger Pads</p>
      <div className="jc-trigger-grid">
        {pads.map((p) => {
          const assigned = Boolean(p.url);
          const isFlashing = flashPadId === p.id;
          const schedTooltip = p.scheduledAt
            ? ` · scheduled ${new Date(p.scheduledAt).toLocaleString()}`
            : "";
          const colorClass = `jc-trigger-pad--color-${p.color ?? "default"}`;
          return (
            <div key={p.id} className="jc-trigger-pad-wrap">
              <button
                type="button"
                className={[
                  "jc-trigger-pad",
                  assigned ? "jc-trigger-pad--assigned" : "jc-trigger-pad--empty",
                  colorClass,
                  isFlashing ? "jc-trigger-pad--playing" : "",
                ].filter(Boolean).join(" ")}
                onClick={() => (assigned ? onPlay(p) : onEdit(p.id))}
                title={assigned ? `Play: ${p.label}${schedTooltip}` : "Click to assign"}
                aria-label={assigned ? `Play ${p.label}` : `Assign source to ${p.label}`}
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
                {p.scheduledAt ? <span className="jc-pad-sched-dot" aria-hidden /> : null}
              </button>
              <button
                type="button"
                className="jc-trigger-pad-edit"
                title="Edit pad"
                aria-label={`Edit ${p.label}`}
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
}: {
  asset: JingleAsset;
  onPlay: () => void;
  onAssign: () => void;
  onSchedule: () => void;
  onSave: () => void;
  onDismiss: () => void;
}): React.ReactElement {
  return (
    <div className="jc-result-strip">
      <div className="jc-result-strip-info">
        <span className="jc-result-strip-title">{asset.title || "Untitled"}</span>
        <span className="jc-result-strip-meta">
          {asset.kind} · {asset.durationLabel || "—"}
        </span>
      </div>
      <div className="jc-result-strip-actions">
        <button
          type="button"
          className="jc-btn jc-btn--primary jc-btn--small"
          disabled={!asset.url}
          title={asset.url ? "Play now" : "No URL to play"}
          onClick={onPlay}
        >
          ▶ Play
        </button>
        <button
          type="button"
          className="jc-btn jc-btn--ghost jc-btn--small"
          disabled={!asset.url}
          onClick={onAssign}
        >
          Assign
        </button>
        <button
          type="button"
          className="jc-btn jc-btn--ghost jc-btn--small"
          disabled={!asset.url}
          onClick={onSchedule}
        >
          Schedule
        </button>
        <button
          type="button"
          className="jc-btn jc-btn--ghost jc-btn--small"
          onClick={onSave}
        >
          Save
        </button>
        <button
          type="button"
          className="jc-icon-btn jc-icon-btn--inline"
          onClick={onDismiss}
          aria-label="Dismiss result"
          title="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

// ─── JinglesWorkspacePanel — center-area workspace ──────────────────────────

/** Controller-style workspace: 3 tabs, persistent trigger pads, popups for detail actions. */
export function JinglesWorkspacePanel({ onClose }: { onClose: () => void }): React.ReactElement {
  // Core state
  const [pads, setPads] = useState<SamplerPadItem[]>(() => loadPads());
  const [flashPadId, setFlashPadId] = useState<string | null>(null);
  const [resultCard, setResultCard] = useState<JingleAsset | null>(null);
  const [activeTab, setActiveTab] = useState<"create" | "library" | "schedule">("create");
  const [draft, setDraft] = useState<AnnouncementDraft>({ ...initialDraft });
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [savedAssets, setSavedAssets] = useState<JingleAsset[]>(() => loadLibrary());
  const [schedItems, setSchedItems] = useState(() => {
    const persisted = loadJingleSchedule();
    // Seed with mock rows only on first run (when no persisted items exist).
    return persisted.length > 0 ? persisted : [...MOCK_SCHEDULE_ITEMS];
  });

  // Status (display-only; no selector)
  const branchStatus: MockBranchLinkStatus = "online";
  const engineStatus: MockEngineStatus = "ready";

  // Persist library to localStorage whenever it changes. The MP3 files
  // themselves are server-owned, so this only stores metadata — cheap and
  // resilient to reloads (including Electron app restarts).
  useEffect(() => {
    persistLibrary(savedAssets);
  }, [savedAssets]);

  // Persist jingle schedule items (payload + timing) so the root-level
  // auto-player can fire them even when this drawer is closed.
  useEffect(() => {
    persistJingleSchedule(schedItems);
  }, [schedItems]);

  // Modal state — only one open at a time in practice
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiIntent, setAiIntent] = useState("");
  const [editPadId, setEditPadId] = useState<string | null>(null);
  const [assignForAsset, setAssignForAsset] = useState<JingleAsset | null>(null);
  const [scheduleForAsset, setScheduleForAsset] = useState<JingleAsset | null>(null);

  // ── Pad operations ─────────────────────────────────────────────────────────

  const handlePadPlay = useCallback((pad: SamplerPadItem) => {
    if (!pad.url) return;
    if (pad.preRoll) {
      const bell = bellUrlFor(pad.bellStyle ?? "ding");
      if (bell) triggerPlayInterrupt(bell);
    }
    triggerPlayInterrupt(pad.url);
    setFlashPadId(pad.id);
    setTimeout(() => setFlashPadId(null), 650);
  }, []);

  const handlePadSave = useCallback(
    (
      padId: string,
      patch: Pick<SamplerPadItem, "label" | "url" | "scheduledAt" | "color" | "bellStyle" | "preRoll">,
    ) => {
      setPads((prev) => {
        const next = prev.map((p) => (p.id === padId ? { ...p, ...patch } : p));
        persistPads(next);
        return next;
      });
      setEditPadId(null);
    },
    [],
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
              }
            : p,
        );
        persistPads(next);
        return next;
      });
    },
    [],
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
    const title = draft.title || "Untitled jingle";
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
      setResultCard(asset);
      // Auto-save every successful generation to the persistent library so
      // a reload of the player doesn't lose the jingle. The audio MP3 already
      // lives on the server (data/jingles/<id>.mp3); we only need to persist
      // the metadata (title, script, voice, language, bell, url) so it can be
      // re-listed and re-played after restart.
      setSavedAssets((prev) =>
        prev.some((a) => a.id === asset.id) ? prev : [asset, ...prev],
      );
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
      if (bell) triggerPlayInterrupt(bell);
    }
    triggerPlayInterrupt(resultCard.url);
  }, [resultCard]);

  const handleResultSaveToLibrary = useCallback(() => {
    if (!resultCard) return;
    setSavedAssets((prev) =>
      prev.some((a) => a.id === resultCard.id) ? prev : [resultCard, ...prev],
    );
  }, [resultCard]);

  const editingPad = editPadId ? pads.find((p) => p.id === editPadId) ?? null : null;

  return (
    <div className="jc-workspace-panel">
      {/* ── Header: title + tiny status LEDs + close ───────────────────── */}
      <header className="jc-ws-header">
        <div className="jc-ws-header-title">
          <h2 className="jc-drawer-title">Jingles</h2>
        </div>
        <div className="jc-ws-header-status-mini" aria-label="System status">
          <span
            className={`jc-status-led jc-status-led--${branchStatus === "online" ? "ok" : "err"}`}
            title={`Branch: ${branchStatus}`}
            aria-hidden
          />
          <span className="jc-status-mini-label">Branch</span>
          <span className="jc-status-mini-sep" aria-hidden />
          <span
            className={`jc-status-led jc-status-led--${
              engineStatus === "ready" ? "ok" : engineStatus === "busy" ? "warn" : "err"
            }`}
            title={`Engine: ${engineStatus}`}
            aria-hidden
          />
          <span className="jc-status-mini-label">Engine</span>
        </div>
        <button
          type="button"
          className="jc-icon-btn"
          onClick={onClose}
          aria-label="Close Jingles Control"
        >
          ✕
        </button>
      </header>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      <div className="jc-ws-body">
        {/* Content scroll area: tabs + panels */}
        <div className="jc-ws-content">
          <nav className="jc-ws-tabs" role="tablist">
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
                {label}
              </button>
            ))}
          </nav>

          {/* ── CREATE ─────────────────────────────────────────────── */}
          {activeTab === "create" ? (
            <div className="jc-ws-panel jc-form">
              <div className="jc-field-row">
                <label className="jc-field jc-field--stretch">
                  <span>Title</span>
                  <input
                    value={draft.title}
                    onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                    placeholder="e.g. Weekend fresh produce"
                  />
                </label>
                <div className="jc-field">
                  <span>Type</span>
                  <SegBtn
                    options={[
                      { value: "jingle", label: "Jingle" },
                      { value: "announcement", label: "Announcement" },
                      { value: "broadcast", label: "Broadcast" },
                    ]}
                    value={draft.kind}
                    onChange={(v) =>
                      setDraft((d) => ({ ...d, kind: v as AnnouncementDraft["kind"] }))
                    }
                  />
                </div>
              </div>

              <div className="jc-field jc-script-wrap">
                <span>Script</span>
                <textarea
                  rows={3}
                  value={draft.body}
                  onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
                  placeholder={
                    draft.language === "he"
                      ? "מה על הקריין להגיד?"
                      : "What should the announcer say?"
                  }
                  dir={draft.language === "he" ? "rtl" : "ltr"}
                />
                <button
                  type="button"
                  className="jc-script-ai-btn"
                  onClick={() => setAiModalOpen(true)}
                  title="Let AI write this"
                  aria-label="Open AI compose"
                >
                  <span className="jc-script-ai-btn-spark" aria-hidden>✦</span>
                  <span>AI</span>
                </button>
              </div>

              <div className="jc-field-row jc-field-row--lang-speed">
                <div className="jc-field">
                  <span>Language</span>
                  <SegBtn
                    options={[
                      { value: "en", label: "English" },
                      { value: "he", label: "עברית" },
                    ]}
                    value={draft.language}
                    onChange={(v) =>
                      setDraft((d) => ({
                        ...d,
                        language: v as JingleLanguage,
                        voice: VOICE_PRESETS_BY_LANG[v as JingleLanguage][0].voiceId,
                      }))
                    }
                  />
                </div>
                <div className="jc-field">
                  <span>Speed</span>
                  <SegBtn
                    options={[
                      { value: "slow", label: "Slow" },
                      { value: "normal", label: "Normal" },
                      { value: "fast", label: "Fast" },
                    ]}
                    value={draft.speed}
                    onChange={(v) => setDraft((d) => ({ ...d, speed: v as JingleSpeed }))}
                  />
                </div>
              </div>

              <div className="jc-field">
                <span>Voice</span>
                <SegBtn
                  options={VOICE_PRESETS_BY_LANG[draft.language].map((v) => ({
                    value: v.voiceId,
                    label: v.label,
                  }))}
                  value={draft.voice}
                  onChange={(v) => setDraft((d) => ({ ...d, voice: v }))}
                />
              </div>

              <div className="jc-field">
                <span>Bell (pre-roll)</span>
                <SegBtn
                  options={BELL_PRESETS.map((b) => ({ value: b.value, label: b.label }))}
                  value={draft.preRoll ? draft.bellStyle : "off"}
                  onChange={(v) =>
                    setDraft((d) => ({
                      ...d,
                      preRoll: v !== "off",
                      bellStyle: v === "off" ? d.bellStyle : (v as JingleBellStyle),
                    }))
                  }
                />
              </div>

              {generateError ? (
                <div className="jc-err-msg" role="alert">
                  {generateError}
                </div>
              ) : null}

              <div className="jc-actions">
                <button
                  type="button"
                  className="jc-btn jc-btn--primary jc-btn--lg"
                  disabled={generating}
                  onClick={() => void handleGenerate()}
                >
                  {generating ? "Generating…" : "Generate"}
                </button>
              </div>
            </div>
          ) : null}

          {/* ── LIBRARY ────────────────────────────────────────────── */}
          {activeTab === "library" ? (
            <div className="jc-ws-panel">
              {savedAssets.length > 0 ? (
                <>
                  <p className="jc-ws-section-label jc-ws-section-label--accent">
                    Saved this session
                  </p>
                  <ul className="jc-lib">
                    {savedAssets.map((a) => (
                      <li key={a.id} className="jc-lib-row">
                        <div>
                          <div className="jc-lib-title">{a.title}</div>
                          <div className="jc-lib-meta">
                            {a.kind} · {a.durationLabel} · {a.url || "no URL"}
                          </div>
                        </div>
                        <div className="jc-lib-actions">
                          <button
                            type="button"
                            className="jc-btn jc-btn--small jc-btn--primary"
                            disabled={!a.url}
                            onClick={() => triggerPlayInterrupt(a.url)}
                            title="Play"
                          >
                            ▶
                          </button>
                          <button
                            type="button"
                            className="jc-btn jc-btn--small jc-btn--ghost"
                            disabled={!a.url}
                            onClick={() => setAssignForAsset(a)}
                          >
                            Assign
                          </button>
                          <button
                            type="button"
                            className="jc-btn jc-btn--small jc-btn--ghost"
                            disabled={!a.url}
                            onClick={() => setScheduleForAsset(a)}
                          >
                            Schedule
                          </button>
                          <button
                            type="button"
                            className="jc-btn jc-btn--small jc-btn--danger"
                            onClick={() =>
                              setSavedAssets((prev) => prev.filter((x) => x.id !== a.id))
                            }
                            title="Delete from library"
                            aria-label={`Delete ${a.title}`}
                          >
                            ✕
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div className="jc-ws-divider" />
                </>
              ) : null}

              <p className="jc-ws-section-label">Sample library</p>
              <ul className="jc-lib">
                {MOCK_LIBRARY_ITEMS.map((item) => {
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
                      <div>
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
                          Assign
                        </button>
                        <button
                          type="button"
                          className="jc-btn jc-btn--small jc-btn--ghost"
                          onClick={() => setScheduleForAsset(itemAsset)}
                        >
                          Schedule
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
            <div className="jc-ws-panel">
              <p className="jc-hint">
                Scheduled items appear here. Use <strong>Schedule</strong> from the Library or
                Result to add one.
              </p>
              <ul className="jc-sched-list">
                {schedItems.map((s) => (
                  <li key={s.id} className="jc-sched-row">
                    <span className="jc-sched-text">
                      <strong>{s.label}</strong> — {s.whenLabel} · {s.repeatLabel} ·{" "}
                      {s.targetLabel}
                    </span>
                    <button
                      type="button"
                      className="jc-btn jc-btn--small jc-btn--danger"
                      onClick={() => setSchedItems((prev) => prev.filter((x) => x.id !== s.id))}
                      title="Remove scheduled item"
                      aria-label={`Remove scheduled ${s.label}`}
                    >
                      ✕
                    </button>
                  </li>
                ))}
                {schedItems.length === 0 ? (
                  <li className="jc-history-empty">No scheduled items yet.</li>
                ) : null}
              </ul>
            </div>
          ) : null}
        </div>

        {/* ── Result strip — between content and pads ─────────────── */}
        {resultCard ? (
          <ResultStrip
            asset={resultCard}
            onPlay={handleResultPlay}
            onAssign={() => setAssignForAsset(resultCard)}
            onSchedule={() => setScheduleForAsset(resultCard)}
            onSave={handleResultSaveToLibrary}
            onDismiss={() => setResultCard(null)}
          />
        ) : null}

        {/* ── Trigger pads ────────────────────────────────────────── */}
        <TriggerPads
          pads={pads}
          flashPadId={flashPadId}
          onPlay={handlePadPlay}
          onEdit={(id) => setEditPadId(id)}
        />
      </div>

      {/* ── Modals ────────────────────────────────────────────────── */}
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

      <ScheduleAssetModal
        asset={scheduleForAsset}
        onConfirm={(scheduledAt, repeat, target) => {
          if (!scheduleForAsset) return;
          // `datetime-local` produces a wall-clock string ("2026-04-21T09:00") which
          // `new Date(...)` interprets in the browser's local zone — exactly what we
          // want for "play at 9 AM locally".
          const iso = new Date(scheduledAt).toISOString();
          const rep = repeat === "daily" || repeat === "weekly" ? repeat : "once";
          setSchedItems((prev) => [
            {
              id: hid(),
              label: scheduleForAsset.title,
              whenLabel: new Date(scheduledAt).toLocaleString(),
              repeatLabel: repeat.charAt(0).toUpperCase() + repeat.slice(1),
              targetLabel: target,
              url: scheduleForAsset.url,
              preRoll: scheduleForAsset.preRoll,
              bellStyle: scheduleForAsset.bellStyle ?? "ding",
              scheduledAtIso: iso,
              repeat: rep,
            },
            ...prev,
          ]);
          setScheduleForAsset(null);
        }}
        onClose={() => setScheduleForAsset(null)}
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
  const [scheduledAt, setScheduledAt] = useState(pad.scheduledAt ?? "");
  const [color, setColor] = useState<PadColor>(pad.color ?? "default");
  const [bellStyle, setBellStyle] = useState<JingleBellStyle>(pad.bellStyle ?? "ding");
  const [preRoll, setPreRoll] = useState<boolean>(pad.preRoll ?? true);

  return (
    <JcModal
      open={true}
      title={`Edit pad: ${pad.label}`}
      onClose={onClose}
      width="30rem"
      footer={
        <>
          <button type="button" className="jc-btn jc-btn--ghost jc-btn--small" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="jc-btn jc-btn--primary jc-btn--small"
            onClick={() =>
              onSave({
                label: label.trim() || pad.label,
                url: url.trim(),
                scheduledAt: scheduledAt || undefined,
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
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Pad name"
          maxLength={24}
        />
      </label>

      <div className="jc-field">
        <span>Color</span>
        <div className="jc-color-grid" role="radiogroup" aria-label="Pad color">
          {PAD_COLOR_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={color === opt.value}
              title={opt.label}
              className={`jc-color-swatch jc-color-swatch--${opt.value}${
                color === opt.value ? " jc-color-swatch--selected" : ""
              }`}
              onClick={() => setColor(opt.value)}
            >
              <span className="jc-color-swatch-dot" style={{ background: opt.swatch }} aria-hidden />
              <span className="jc-color-swatch-label">{opt.label}</span>
            </button>
          ))}
        </div>
      </div>

      <label className="jc-field">
        <span>Audio URL or local path</span>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://… or /api/jingles/audio/…"
          spellCheck={false}
        />
      </label>

      <div className="jc-field">
        <span>Bell (pre-roll)</span>
        <SegBtn
          options={BELL_PRESETS.map((b) => ({ value: b.value, label: b.label }))}
          value={preRoll ? bellStyle : "off"}
          onChange={(v) => {
            if (v === "off") {
              setPreRoll(false);
            } else {
              setPreRoll(true);
              setBellStyle(v as JingleBellStyle);
            }
          }}
        />
      </div>

      <label className="jc-field">
        <span>Schedule at (optional)</span>
        <input
          type="datetime-local"
          className="jc-datetime"
          value={scheduledAt}
          onChange={(e) => setScheduledAt(e.target.value)}
        />
      </label>
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
      title={asset ? `Assign "${asset.title}" to pad` : ""}
      onClose={onClose}
      width="28rem"
    >
      <p className="jc-hint">Pick a pad. Assigned pads will be overwritten.</p>
      <div className="jc-pad-picker-grid">
        {pads.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`jc-pad-picker-btn ${p.url ? "jc-pad-picker-btn--has" : ""}`}
            onClick={() => onPick(p.id)}
            title={p.url ? "Currently assigned — will overwrite" : "Empty"}
          >
            <span>{p.label}</span>
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
  const [when, setWhen] = useState("");
  const [repeat, setRepeat] = useState("once");
  const [target, setTarget] = useState("default");

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
            Confirm
          </button>
        </>
      }
    >
      <label className="jc-field">
        <span>When</span>
        <input
          type="datetime-local"
          className="jc-datetime"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
        />
      </label>
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
        <span>Target branch / device</span>
        <input value={target} onChange={(e) => setTarget(e.target.value)} />
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
