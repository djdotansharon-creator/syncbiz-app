/**
 * JINGLES CONTROL — phase-1 mock operator UI only.
 * - Lives in its own React root (`jingles-shell-bridge`); open/close/tab changes are local state only.
 * - Does not call transport, WS, MPV, or main-process playback — hero/dock/library roots are unrelated.
 */
import React, { useReducer, useCallback, type Dispatch } from "react";
import { createPortal } from "react-dom";
import type {
  AnnouncementDraft,
  JinglesOperatorMode,
  JinglesTabId,
  MockBranchLinkStatus,
  MockEngineStatus,
  MockHistoryEvent,
  MockHistoryEventKind,
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

const initialDraft: AnnouncementDraft = {
  title: "",
  body: "",
  kind: "announcement",
  tone: "Warm, clear",
  voice: "Announcer A (mock)",
  pacing: "Normal",
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
