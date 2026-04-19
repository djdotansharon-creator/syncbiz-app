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
  JinglesOperatorMode,
  JinglesTabId,
  MockBranchLinkStatus,
  MockEngineStatus,
  MockHistoryEvent,
  MockHistoryEventKind,
  SamplerPadItem,
} from "./types";
import {
  INITIAL_MOCK_HISTORY,
  MOCK_AI_SUGGESTIONS,
  MOCK_LIBRARY_ITEMS,
  MOCK_SCHEDULE_ITEMS,
  SAMPLER_PADS,
} from "./seed-data";

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
// All four confirmed 200 on free tier (probed directly against the TTS endpoint).
const VOICE_PRESETS = [
  { label: "Announcer Male",    voiceId: "JBFqnCBsd6RMkjVDRZzb" }, // George
  { label: "Announcer Female",  voiceId: "EXAVITQu4vr4xnSDxMaL" }, // Sarah
  { label: "Energetic Male",    voiceId: "TX3LPaxmHKxFdv7VOQHJ" }, // Liam
  { label: "Energetic Female",  voiceId: "cgSgspJ2msm6clMCkdW9" }, // Jessica
] as const;

const BELL_URL = "/sounds/bell.wav";

const initialDraft: AnnouncementDraft = {
  title: "",
  body: "",
  kind: "announcement",
  tone: "Warm, clear",
  voice: VOICE_PRESETS[0].voiceId,
  pacing: "Normal",
  preRoll: false,
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
      return match ? { ...seed, label: match.label ?? seed.label, url: match.url ?? "", scheduledAt: match.scheduledAt, preRoll: match.preRoll ?? false } : { ...seed };
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

// ─── TriggerPadSection ───────────────────────────────────────────────────────
// Each pad IS the trigger. Assigned → click = Play. Unassigned → click = Edit.
// One small ✎ overlay button for settings; never clutters the pad face.

function TriggerPadSection({
  pads,
  flashPadId,
  editingPadId,
  onPlay,
  onEditToggle,
}: {
  pads: SamplerPadItem[];
  flashPadId: string | null;
  editingPadId: string | null;
  onPlay: (pad: SamplerPadItem) => void;
  onEditToggle: (padId: string) => void;
}): React.ReactElement {
  return (
    <section className="jc-trigger-section" aria-label="Jingle trigger pads">
      <p className="jc-rail-head" style={{ marginBottom: "0.5rem" }}>Trigger Pads</p>
      <div className="jc-trigger-grid">
        {pads.map((p) => {
          const assigned = Boolean(p.url);
          const isEditing = editingPadId === p.id;
          const isFlashing = flashPadId === p.id;
          return (
            // Wrapper holds the pad button + floating edit button as siblings
            <div key={p.id} className="jc-trigger-pad-wrap">

              {/* ── Pad face: square trigger — label centered, LED corner dot ── */}
              <button
                type="button"
                className={[
                  "jc-trigger-pad",
                  assigned ? "jc-trigger-pad--assigned" : "jc-trigger-pad--empty",
                  isEditing ? "jc-trigger-pad--editing" : "",
                  isFlashing ? "jc-trigger-pad--playing" : "",
                ].filter(Boolean).join(" ")}
                onClick={() => (assigned ? onPlay(p) : onEditToggle(p.id))}
                title={assigned ? `Play: ${p.label}` : "Click to assign"}
                aria-label={assigned ? `Play ${p.label}` : `Assign source to ${p.label}`}
              >
                <span
                  className={`jc-pad-led ${isFlashing ? "jc-pad-led--playing" : assigned ? "jc-pad-led--ready" : "jc-pad-led--empty"}`}
                  aria-hidden
                />
                <span className="jc-trigger-pad-label">{p.label}</span>
                {p.scheduledAt ? (
                  <span
                    className="jc-trigger-sched-badge"
                    title={new Date(p.scheduledAt).toLocaleString()}
                  >
                    {new Date(p.scheduledAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                ) : null}
              </button>

              {/* ── Single settings control — floats top-right, never the primary action ── */}
              <button
                type="button"
                className={`jc-trigger-pad-edit ${isEditing ? "jc-trigger-pad-edit--on" : ""}`}
                title="Edit pad"
                aria-label={`Edit ${p.label}`}
                onClick={(e) => { e.stopPropagation(); onEditToggle(p.id); }}
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

// ─── PadEditForm ──────────────────────────────────────────────────────────────

function PadEditForm({
  pad,
  onSave,
  onCancel,
}: {
  pad: SamplerPadItem;
  onSave: (patch: Pick<SamplerPadItem, "label" | "url" | "scheduledAt">) => void;
  onCancel: () => void;
}): React.ReactElement {
  const [label, setLabel] = useState(pad.label);
  const [url, setUrl] = useState(pad.url);
  const [scheduledAt, setScheduledAt] = useState(pad.scheduledAt ?? "");

  useEffect(() => {
    setLabel(pad.label);
    setUrl(pad.url);
    setScheduledAt(pad.scheduledAt ?? "");
  }, [pad.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="jc-form jc-rail-edit-form">
      <div className="jc-rail-edit-head">
        <span className="jc-rail-head">Editing: {pad.label}</span>
        <button type="button" className="jc-icon-btn" onClick={onCancel} aria-label="Cancel edit">✕</button>
      </div>
      <label className="jc-field">
        <span>Label</span>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Pad label" />
      </label>
      <label className="jc-field">
        <span>Audio URL or local path</span>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://... or /path/to/file.mp3"
          spellCheck={false}
        />
      </label>
      <label className="jc-field">
        <span>Schedule at (optional)</span>
        <input
          type="datetime-local"
          value={scheduledAt}
          onChange={(e) => setScheduledAt(e.target.value)}
        />
      </label>
      <div className="jc-actions">
        <button
          type="button"
          className="jc-btn jc-btn--primary jc-btn--small"
          onClick={() => onSave({ label: label.trim() || pad.label, url: url.trim(), scheduledAt: scheduledAt || undefined })}
        >
          Save
        </button>
        <button type="button" className="jc-btn jc-btn--ghost jc-btn--small" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── PadPicker ────────────────────────────────────────────────────────────────

function PadPicker({
  pads,
  onPick,
  onClose,
}: {
  pads: SamplerPadItem[];
  onPick: (padId: string) => void;
  onClose: () => void;
}): React.ReactElement {
  return (
    <div className="jc-pad-picker">
      <div className="jc-pad-picker-head">
        <span className="jc-rail-head">Choose pad</span>
        <button type="button" className="jc-icon-btn" onClick={onClose} aria-label="Close picker">✕</button>
      </div>
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
    </div>
  );
}

// ─── ResultCard ───────────────────────────────────────────────────────────────

function ResultCard({
  asset,
  pads,
  onPlay,
  onAssignToPad,
  onSchedule,
  onSaveToLibrary,
  onDismiss,
}: {
  asset: JingleAsset;
  pads: SamplerPadItem[];
  onPlay: () => void;
  onAssignToPad: (padId: string) => void;
  onSchedule: (scheduledAt: string, repeat: string) => void;
  onSaveToLibrary: () => void;
  onDismiss: () => void;
}): React.ReactElement {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [schedOpen, setSchedOpen] = useState(false);
  const [schedAt, setSchedAt] = useState("");
  const [schedRepeat, setSchedRepeat] = useState("once");

  return (
    <div className="jc-result-card">
      <div className="jc-result-card-header">
        <div className="jc-result-card-title-row">
          <span className="jc-result-card-title">{asset.title || "(untitled)"}</span>
          <span className="jc-result-card-meta">{asset.kind} · {asset.durationLabel || "—"}</span>
        </div>
        <button type="button" className="jc-icon-btn" onClick={onDismiss} aria-label="Dismiss result">✕</button>
      </div>

      {asset.script ? (
        <p className="jc-result-card-script">&ldquo;{asset.script}&rdquo;</p>
      ) : null}

      {asset.url ? (
        <p className="jc-result-card-url" title={asset.url}>{asset.url}</p>
      ) : (
        <p className="jc-result-card-url jc-result-card-url--empty">
          No audio asset yet — paste a URL above or generate via AI to attach one
        </p>
      )}

      <div className="jc-actions jc-result-card-actions">
        <button
          type="button"
          className="jc-btn jc-btn--primary"
          disabled={!asset.url}
          title={asset.url ? undefined : "No URL to play"}
          onClick={onPlay}
        >
          ▶ Play Now
        </button>
        <button
          type="button"
          className={`jc-btn ${pickerOpen ? "jc-btn--secondary" : "jc-btn--ghost"}`}
          onClick={() => { setPickerOpen((v) => !v); setSchedOpen(false); }}
        >
          Assign to pad {pickerOpen ? "▲" : "▾"}
        </button>
        <button
          type="button"
          className={`jc-btn ${schedOpen ? "jc-btn--secondary" : "jc-btn--ghost"}`}
          onClick={() => { setSchedOpen((v) => !v); setPickerOpen(false); }}
        >
          Schedule {schedOpen ? "▲" : "▾"}
        </button>
        <button type="button" className="jc-btn jc-btn--ghost" onClick={onSaveToLibrary}>
          Save to library
        </button>
      </div>

      {pickerOpen ? (
        <PadPicker
          pads={pads}
          onPick={(id) => { onAssignToPad(id); setPickerOpen(false); }}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}

      {schedOpen ? (
        <div className="jc-result-sched">
          <div className="jc-field-row">
            <label className="jc-field">
              <span>When</span>
              <input
                type="datetime-local"
                value={schedAt}
                onChange={(e) => setSchedAt(e.target.value)}
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
                value={schedRepeat}
                onChange={(v) => setSchedRepeat(v)}
              />
            </div>
          </div>
          <div className="jc-actions">
            <button
              type="button"
              className="jc-btn jc-btn--primary jc-btn--small"
              disabled={!schedAt}
              onClick={() => { onSchedule(schedAt, schedRepeat); setSchedOpen(false); }}
            >
              Confirm schedule
            </button>
            <button type="button" className="jc-btn jc-btn--ghost jc-btn--small" onClick={() => setSchedOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ─── JinglesWorkspacePanel ────────────────────────────────────────────────────

/** Center-area workspace — full management surface with persistent pad rail. */
export function JinglesWorkspacePanel({ onClose }: { onClose: () => void }): React.ReactElement {
  // Pads: persisted to localStorage — survives Electron restarts
  const [pads, setPads] = useState<SamplerPadItem[]>(() => loadPads());
  const [editingPadId, setEditingPadId] = useState<string | null>(null);
  const [flashPadId, setFlashPadId] = useState<string | null>(null);

  // Shared result card — visible regardless of active tab
  const [resultCard, setResultCard] = useState<JingleAsset | null>(null);

  // Tab state
  const [activeTab, setActiveTab] = useState<JinglesTabId>("create");

  // Create-tab draft
  const [draft, setDraft] = useState<AnnouncementDraft>({ ...initialDraft });

  // Generation state
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // AI-tab
  const [aiIntent, setAiIntent] = useState("");

  // Library: saved assets from this session
  const [savedAssets, setSavedAssets] = useState<JingleAsset[]>([]);
  // Which library item has its pad-picker open
  const [libPickerFor, setLibPickerFor] = useState<string | null>(null);

  // Schedule tab
  const [schedMode, setSchedMode] = useState<"now" | "later" | "recurring">("later");
  const [schedTarget, setSchedTarget] = useState("default");
  const [schedRepeat, setSchedRepeat] = useState("weekly");
  const [schedItems, setSchedItems] = useState([...MOCK_SCHEDULE_ITEMS]);

  // History
  const [history, setHistory] = useState<MockHistoryEvent[]>([...INITIAL_MOCK_HISTORY]);

  // Status (mock)
  const [branchStatus, setBranchStatus] = useState<MockBranchLinkStatus>("online");
  const [engineStatus, setEngineStatus] = useState<MockEngineStatus>("ready");
  const [operatorMode, setOperatorMode] = useState<JinglesOperatorMode>("safe");

  const addHistory = useCallback((kind: MockHistoryEvent["kind"], message: string) => {
    const ev: MockHistoryEvent = { id: hid(), atIso: nowIso(), kind, message };
    setHistory((prev) => [ev, ...prev].slice(0, 80));
  }, []);

  // ── Pad operations ──────────────────────────────────────────────────────────

  const handlePadPlay = useCallback((pad: SamplerPadItem) => {
    if (!pad.url) return;
    if (pad.preRoll) triggerPlayInterrupt(BELL_URL);
    triggerPlayInterrupt(pad.url);
    setFlashPadId(pad.id);
    addHistory("pad", `Pad "${pad.label}" triggered`);
    setTimeout(() => setFlashPadId(null), 650);
  }, [addHistory]);

  const handlePadEditToggle = useCallback((padId: string) => {
    setEditingPadId((prev) => (prev === padId ? null : padId));
  }, []);

  const handlePadSave = useCallback(
    (patch: Pick<SamplerPadItem, "label" | "url" | "scheduledAt">) => {
      if (!editingPadId) return;
      setPads((prev) => {
        const next = prev.map((p) => (p.id === editingPadId ? { ...p, ...patch } : p));
        persistPads(next);
        return next;
      });
      addHistory("pad", `Pad "${patch.label}" saved`);
      setEditingPadId(null);
    },
    [editingPadId, addHistory],
  );

  const handleAssignToPad = useCallback(
    (padId: string, asset: JingleAsset) => {
      setPads((prev) => {
        const next = prev.map((p) =>
          p.id === padId
            ? { ...p, url: asset.url, label: (asset.title || p.label).slice(0, 20), preRoll: asset.preRoll }
            : p
        );
        persistPads(next);
        return next;
      });
      const pad = pads.find((p) => p.id === padId);
      addHistory("pad", `Assigned "${asset.title}" to pad "${pad?.label ?? padId}"`);
    },
    [pads, addHistory],
  );

  // ── Create-tab operations ───────────────────────────────────────────────────

  const handleGenerate = useCallback(async (opts?: { save?: boolean }) => {
    const text = draft.body.trim();
    if (!text) {
      setGenerateError("Script body is required — type what the announcer should say.");
      addHistory("failed", "Generate failed: script body is empty");
      return;
    }
    setGenerateError(null);
    setGenerating(true);
    const title = draft.title || "Untitled jingle";
    try {
      const res = await fetch("/api/jingles/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voiceId: draft.voice }),
      });
      const data = (await res.json()) as { url?: string; durationLabel?: string; error?: string };
      if (!res.ok || !data.url) {
        const msg = data.error ?? `HTTP ${res.status}`;
        setGenerateError(msg);
        addHistory("failed", `Generate failed: ${msg}`);
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
      };
      setResultCard(asset);
      addHistory(
        opts?.save ? "saved" : "created",
        opts?.save
          ? `Saved & generated: "${title}" → ${data.url}`
          : `Generated: "${title}" → ${data.url}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setGenerateError(msg);
      addHistory("failed", `Generate failed: ${msg}`);
    } finally {
      setGenerating(false);
    }
  }, [draft, addHistory]);

  // ── AI-tab operations ────────────────────────────────────────────────────────

  const handleAiApprove = useCallback((index: number) => {
    const text = MOCK_AI_SUGGESTIONS[index] ?? "";
    const asset: JingleAsset = {
      id: hid(),
      title: `AI suggestion ${index + 1}`,
      script: text,
      url: "",
      kind: "announcement",
      durationLabel: "—",
      voiceId: draft.voice,
      preRoll: false,
    };
    setResultCard(asset);
    addHistory("created", `AI suggestion ${index + 1} approved → result card`);
  }, [draft.voice, addHistory]);

  // ── Result-card operations ──────────────────────────────────────────────────

  const handleResultPlay = useCallback(() => {
    if (!resultCard?.url) return;
    if (resultCard.preRoll) triggerPlayInterrupt(BELL_URL);
    triggerPlayInterrupt(resultCard.url);
    addHistory("previewed", `Played result: "${resultCard.title}"`);
  }, [resultCard, addHistory]);

  const handleResultAssignToPad = useCallback((padId: string) => {
    if (!resultCard) return;
    handleAssignToPad(padId, resultCard);
  }, [resultCard, handleAssignToPad]);

  const handleResultSchedule = useCallback((scheduledAt: string, repeat: string) => {
    if (!resultCard) return;
    setSchedItems((prev) => [
      {
        id: hid(),
        label: resultCard.title,
        whenLabel: new Date(scheduledAt).toLocaleString(),
        repeatLabel: repeat.charAt(0).toUpperCase() + repeat.slice(1),
        targetLabel: schedTarget,
      },
      ...prev,
    ]);
    addHistory("scheduled", `Scheduled "${resultCard.title}" at ${scheduledAt}`);
  }, [resultCard, schedTarget, addHistory]);

  const handleResultSaveToLibrary = useCallback(() => {
    if (!resultCard) return;
    setSavedAssets((prev) => prev.some((a) => a.id === resultCard.id) ? prev : [resultCard, ...prev]);
    addHistory("saved", `Saved to library: "${resultCard.title}"`);
  }, [resultCard, addHistory]);

  const editingPad = pads.find((p) => p.id === editingPadId) ?? null;

  return (
    <div className="jc-workspace-panel">

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <header className="jc-ws-header">
        <div className="jc-ws-header-title">
          <h2 className="jc-drawer-title">JINGLES CONTROL</h2>
          <p className="jc-drawer-sub">Operator console</p>
        </div>
        <div className="jc-ws-header-status">
          {/* Branch — LED + chip, no inline editor */}
          <div className="jc-status-cluster">
            <span className={`jc-status-led jc-status-led--${branchStatus === "online" ? "ok" : "err"}`} aria-hidden />
            <span className="jc-status-label">Branch</span>
            <Chip variant={branchStatus === "online" ? "ok" : "err"}>{branchStatus}</Chip>
          </div>
          {/* Engine — LED + chip */}
          <div className="jc-status-cluster">
            <span
              className={`jc-status-led jc-status-led--${engineStatus === "ready" ? "ok" : engineStatus === "busy" ? "warn" : "err"}`}
              aria-hidden
            />
            <span className="jc-status-label">Engine</span>
            <Chip variant={engineStatus === "ready" ? "ok" : engineStatus === "busy" ? "warn" : "err"}>
              {engineStatus}
            </Chip>
          </div>
          {/* Mode — segmented control (has real operator value) */}
          <div className="jc-status-cluster">
            <span className="jc-status-label">Mode</span>
            <SegBtn
              options={[
                { value: "safe", label: "Safe" },
                { value: "preview", label: "Preview" },
                { value: "live", label: "Live" },
              ]}
              value={operatorMode}
              onChange={(v) => setOperatorMode(v as JinglesOperatorMode)}
            />
          </div>
        </div>
        <button type="button" className="jc-icon-btn" onClick={onClose} aria-label="Close Jingles Control">
          ✕
        </button>
      </header>

      {/* ── Two-zone body ─────────────────────────────────────────────────── */}
      <div className="jc-ws-body">

        {/* ── Content area (tabs) ─────────────────────────────────────── */}
        <div className="jc-ws-content">

          {/* Tab bar */}
          <nav className="jc-ws-tabs" role="tablist">
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
                aria-selected={activeTab === id}
                className={`jc-ws-tab ${activeTab === id ? "jc-ws-tab--active" : ""}`}
                onClick={() => setActiveTab(id as JinglesTabId)}
              >
                {label}
              </button>
            ))}
          </nav>

          {/* ── CREATE ────────────────────────────────────────────────── */}
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
                    onChange={(v) => setDraft((d) => ({ ...d, kind: v as AnnouncementDraft["kind"] }))}
                  />
                </div>
              </div>
              <label className="jc-field">
                <span>Script</span>
                <textarea
                  rows={3}
                  value={draft.body}
                  onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
                  placeholder="What should the announcer say?"
                />
              </label>
              <div className="jc-field-row jc-field-row--voice">
                <label className="jc-field">
                  <span>Voice</span>
                  <select
                    value={draft.voice}
                    onChange={(e) => setDraft((d) => ({ ...d, voice: e.target.value }))}
                  >
                    {VOICE_PRESETS.map((v) => (
                      <option key={v.voiceId} value={v.voiceId}>{v.label}</option>
                    ))}
                  </select>
                </label>
                <label className="jc-field">
                  <span>Tone</span>
                  <input value={draft.tone} onChange={(e) => setDraft((d) => ({ ...d, tone: e.target.value }))} />
                </label>
                <label className="jc-field">
                  <span>Pacing</span>
                  <input value={draft.pacing} onChange={(e) => setDraft((d) => ({ ...d, pacing: e.target.value }))} />
                </label>
                <div className="jc-field jc-field--pre-roll">
                  <span>Bell</span>
                  <button
                    type="button"
                    className={`jc-toggle-chip${draft.preRoll ? " jc-toggle-chip--on" : ""}`}
                    onClick={() => setDraft((d) => ({ ...d, preRoll: !d.preRoll }))}
                    aria-pressed={draft.preRoll}
                  >
                    {draft.preRoll ? "ON" : "OFF"}
                  </button>
                </div>
              </div>
              {generateError ? (
                <div className="jc-err-msg" role="alert">{generateError}</div>
              ) : null}
              <div className="jc-actions">
                <button
                  type="button"
                  className="jc-btn jc-btn--ghost"
                  onClick={() => addHistory("previewed", `Preview: "${draft.title || "(untitled)"}"`)}>
                  Preview
                </button>
                <button
                  type="button"
                  className="jc-btn jc-btn--secondary"
                  disabled={generating}
                  onClick={() => void handleGenerate()}
                >
                  {generating ? "Generating…" : "Generate"}
                </button>
                <button
                  type="button"
                  className="jc-btn jc-btn--primary"
                  disabled={generating}
                  onClick={() => void handleGenerate({ save: true })}
                >
                  {generating ? "Generating…" : "Save & Generate"}
                </button>
              </div>
            </div>
          ) : null}

          {/* ── AI COMPOSE ──────────────────────────────────────────── */}
          {activeTab === "ai" ? (
            <div className="jc-ws-panel jc-form">
              <label className="jc-field">
                <span>What should the announcer say?</span>
                <textarea
                  rows={3}
                  value={aiIntent}
                  onChange={(e) => setAiIntent(e.target.value)}
                  placeholder="e.g. remind customers about closing in 15 minutes, warm and friendly tone"
                />
              </label>
              <p className="jc-hint">Mock suggestions — AI API not yet connected.</p>
              <ul className="jc-ai-cards">
                {MOCK_AI_SUGGESTIONS.map((text, i) => (
                  <li key={i} className="jc-ai-card">
                    <p>{text}</p>
                    <div className="jc-ai-card-actions">
                      <button
                        type="button"
                        className="jc-btn jc-btn--small"
                        onClick={() => {
                          setDraft((d) => ({ ...d, body: text }));
                          setActiveTab("create");
                          addHistory("draft_action", `AI suggestion ${i + 1} copied to draft`);
                        }}
                      >
                        Use in draft
                      </button>
                      <button
                        type="button"
                        className="jc-btn jc-btn--small jc-btn--secondary"
                        onClick={() => handleAiApprove(i)}
                      >
                        Approve &amp; generate
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* ── LIBRARY ─────────────────────────────────────────────── */}
          {activeTab === "library" ? (
            <div className="jc-ws-panel">
              {savedAssets.length > 0 ? (
                <>
                  <p className="jc-ws-section-label jc-ws-section-label--accent">Saved this session</p>
                  <ul className="jc-lib">
                    {savedAssets.map((a) => (
                      <li key={a.id} className="jc-lib-row">
                        <div>
                          <div className="jc-lib-title">{a.title}</div>
                          <div className="jc-lib-meta">{a.kind} · {a.durationLabel} · {a.url || "no URL"}</div>
                        </div>
                        <div className="jc-lib-actions">
                          <button
                            type="button"
                            className="jc-btn jc-btn--small jc-btn--primary"
                            disabled={!a.url}
                            onClick={() => { triggerPlayInterrupt(a.url); addHistory("previewed", `Played: "${a.title}"`); }}
                          >
                            ▶
                          </button>
                          <button
                            type="button"
                            className="jc-btn jc-btn--small jc-btn--ghost"
                            onClick={() => setResultCard(a)}
                          >
                            Open
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div className="jc-ws-divider" />
                </>
              ) : null}
              <p className="jc-ws-section-label">Mock library</p>
              <ul className="jc-lib">
                {MOCK_LIBRARY_ITEMS.map((item) => (
                  <li key={item.id} className="jc-lib-row jc-lib-row--stacked">
                    <div>
                      <div className="jc-lib-title">
                        {item.favorite ? <span className="jc-star" aria-hidden>★</span> : null}
                        {item.title}
                      </div>
                      <div className="jc-lib-meta">{item.kind} · {item.durationLabel} · {item.tags.join(", ")}</div>
                    </div>
                    <div className="jc-lib-actions">
                      <button
                        type="button"
                        className="jc-btn jc-btn--small"
                        onClick={() => addHistory("previewed", `Library play (mock): "${item.title}"`)}
                      >
                        ▶ Play
                      </button>
                      <button
                        type="button"
                        className={`jc-btn jc-btn--small ${libPickerFor === item.id ? "jc-btn--secondary" : "jc-btn--ghost"}`}
                        onClick={() => setLibPickerFor((v) => (v === item.id ? null : item.id))}
                      >
                        Assign to pad {libPickerFor === item.id ? "▲" : "▾"}
                      </button>
                      <button
                        type="button"
                        className="jc-btn jc-btn--small jc-btn--ghost"
                        onClick={() => addHistory("scheduled", `Scheduled from library: "${item.title}" (mock)`)}
                      >
                        Schedule
                      </button>
                    </div>
                    {libPickerFor === item.id ? (
                      <PadPicker
                        pads={pads}
                        onPick={(padId) => {
                          handleAssignToPad(padId, {
                            id: item.id, title: item.title, script: "", url: "",
                            kind: item.kind, durationLabel: item.durationLabel,
                            voiceId: "", preRoll: false,
                          });
                          setLibPickerFor(null);
                        }}
                        onClose={() => setLibPickerFor(null)}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* ── SCHEDULE ────────────────────────────────────────────── */}
          {activeTab === "schedule" ? (
            <div className="jc-ws-panel jc-form">
              <div className="jc-field-row">
                <div className="jc-field">
                  <span>When</span>
                  <SegBtn
                    options={[
                      { value: "now", label: "Now" },
                      { value: "later", label: "Later" },
                      { value: "recurring", label: "Recurring" },
                    ]}
                    value={schedMode}
                    onChange={(v) => setSchedMode(v as typeof schedMode)}
                  />
                </div>
                <label className="jc-field">
                  <span>Target branch / device</span>
                  <input value={schedTarget} onChange={(e) => setSchedTarget(e.target.value)} />
                </label>
                <div className="jc-field">
                  <span>Repeat</span>
                  <SegBtn
                    options={[
                      { value: "once", label: "Once" },
                      { value: "daily", label: "Daily" },
                      { value: "weekly", label: "Weekly" },
                    ]}
                    value={schedRepeat}
                    onChange={(v) => setSchedRepeat(v)}
                  />
                </div>
              </div>
              <p className="jc-hint">Scheduled items</p>
              <ul className="jc-sched-list">
                {schedItems.map((s) => (
                  <li key={s.id}>
                    <strong>{s.label}</strong> — {s.whenLabel} · {s.repeatLabel} · {s.targetLabel}
                  </li>
                ))}
                {schedItems.length === 0 ? (
                  <li className="jc-history-empty">No scheduled items yet.</li>
                ) : null}
              </ul>
            </div>
          ) : null}

          {/* ── HISTORY ─────────────────────────────────────────────── */}
          {activeTab === "history" ? (
            <div className="jc-ws-panel">
              <ul className="jc-history">
                {history.length === 0 ? (
                  <li className="jc-history-empty">No events yet.</li>
                ) : (
                  history.map((h) => (
                    <li key={h.id} className="jc-history-row">
                      <span className="jc-history-time">{new Date(h.atIso).toLocaleTimeString()}</span>
                      <Chip variant="neutral">{h.kind}</Chip>
                      <span>{h.message}</span>
                    </li>
                  ))
                )}
              </ul>
            </div>
          ) : null}

        </div>

        {/* ── Result card — outside scroll zone, between tabs and pads ── */}
        {resultCard ? (
          <ResultCard
            asset={resultCard}
            pads={pads}
            onPlay={handleResultPlay}
            onAssignToPad={handleResultAssignToPad}
            onSchedule={handleResultSchedule}
            onSaveToLibrary={handleResultSaveToLibrary}
            onDismiss={() => setResultCard(null)}
          />
        ) : null}

        {/* ── Pad edit form — appears above trigger row when editing ─── */}
        {editingPad ? (
          <PadEditForm
            pad={editingPad}
            onSave={handlePadSave}
            onCancel={() => setEditingPadId(null)}
          />
        ) : null}

        {/* ── Trigger pads — bottom row, always visible ──────────────── */}
        <TriggerPadSection
          pads={pads}
          flashPadId={flashPadId}
          editingPadId={editingPadId}
          onPlay={handlePadPlay}
          onEditToggle={handlePadEditToggle}
        />

      </div>
    </div>
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
