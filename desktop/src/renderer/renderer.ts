/**
 * Renderer MVP — reads/writes config via preload and reflects `mvp:status` stream.
 */

import type {
  BranchLibraryItem,
  BranchLibrarySummary,
  DesktopRuntimeConfig,
  MvpStatusSnapshot,
} from "../shared/mvp-types";
import type { SyncBizDesktopMvp } from "../shared/mvp-desktop-api";
import type { BranchLibraryListItem } from "../../../lib/player-surface/branch-library-list-item";
import { mvpSnapshotToPlayerHeroProps, type DesktopHeroWire } from "./map-desktop-hero-props";
import { mvpSnapshotToPlaybackDockProps } from "./map-desktop-playback-dock-props";
import { mountPlayerHero, renderPlayerHero } from "./player-hero-bridge";
import { mountPlaybackDock, renderPlaybackDock } from "./playback-dock-bridge";
import { mountBranchLibrary, renderBranchLibrary } from "./branch-library-bridge";
import { mountPlayerDeckMetaStrip, renderPlayerDeckMetaStrip } from "./player-deck-meta-strip-bridge";
import { mvpSnapshotToDeckMetaStripProps } from "./map-desktop-deck-meta-props";
import { DESKTOP_IDLE_STATUS_SNAPSHOT } from "./desktop-idle-snapshot";
import { mountDesktopDebugPanel, renderDesktopDebugPanel } from "./debug-panel-bridge";
import { mountJinglesShell } from "./jingles-control/jingles-shell-bridge";

/** Injected by `scripts/bundle-desktop.cjs` — when false, Jingles UI is not mounted. */
declare const __DESKTOP_JINGLES_CONTROL_UI__: boolean;

function el<T extends HTMLElement>(id: string): T {
  const n = document.getElementById(id);
  if (!n) throw new Error(`Missing #${id}`);
  return n as T;
}

function setFeedback(message: string, kind: "none" | "ok" | "err" | "warn" | "info"): void {
  const node = el<HTMLParagraphElement>("feedback");
  node.textContent = message;
  node.className = "hint";
  if (kind === "ok") node.classList.add("feedback-ok");
  else if (kind === "err") node.classList.add("feedback-err");
  else if (kind === "warn") node.classList.add("feedback-warn");
}

function setPillWs(state: MvpStatusSnapshot["wsState"], registered: boolean): void {
  const pill = el<HTMLSpanElement>("pillWs");
  pill.className = "pill";
  if (state === "connected" && registered) {
    pill.classList.add("ok");
    pill.textContent = "connected";
  } else if (state === "connecting") {
    pill.classList.add("warn");
    pill.textContent = "connecting";
  } else if (state === "error") {
    pill.classList.add("err");
    pill.textContent = "error";
  } else {
    pill.classList.add("neutral");
    pill.textContent = "disconnected";
  }
}

function setPillReg(registered: boolean): void {
  const pill = el<HTMLSpanElement>("pillReg");
  pill.className = "pill " + (registered ? "ok" : "neutral");
  pill.textContent = registered ? "yes" : "no";
}

function setPillRole(role: MvpStatusSnapshot["deviceRole"]): void {
  const pill = el<HTMLSpanElement>("pillRole");
  pill.className = "pill";
  if (role === "MASTER") {
    pill.classList.add("ok");
    pill.textContent = "MASTER";
  } else if (role === "CONTROL") {
    pill.classList.add("warn");
    pill.textContent = "CONTROL";
  } else {
    pill.classList.add("neutral");
    pill.textContent = "—";
  }
}

function setPillCmdReady(ready: boolean): void {
  const pill = el<HTMLSpanElement>("pillCmdReady");
  pill.className = "pill " + (ready ? "ok" : "neutral");
  pill.textContent = ready ? "yes" : "no";
}

/** Latest snapshot — used to highlight library row after re-fetch. */
let lastStatusSnapshot: MvpStatusSnapshot | null = null;

let desktopHeroWire!: DesktopHeroWire;

function applyStatus(s: MvpStatusSnapshot): void {
  lastStatusSnapshot = s;
  el<HTMLSpanElement>("stDeviceId").textContent = s.deviceId || "—";
  el<HTMLSpanElement>("stBranch").textContent = s.branchId || "—";
  el<HTMLSpanElement>("stWorkspace").textContent = s.workspaceLabel?.trim() || "—";
  el<HTMLSpanElement>("stWsUrl").textContent = s.wsUrl || "—";
  el<HTMLSpanElement>("stToken").textContent = s.hasToken ? "present (hidden)" : "missing";

  renderPlayerHero(mvpSnapshotToPlayerHeroProps(s, desktopHeroWire));
  renderPlaybackDock(mvpSnapshotToPlaybackDockProps(s, desktopHeroWire));
  renderPlayerDeckMetaStrip(mvpSnapshotToDeckMetaStripProps(s));
  renderDesktopDebugPanel(s, typeof window !== "undefined" ? window.location.href : "");

  el<HTMLSpanElement>("stLastMsg").textContent = s.lastServerMessageType ?? "—";
  el<HTMLSpanElement>("stLastCmd").textContent = s.lastCommandSummary ?? "—";
  el<HTMLSpanElement>("stErr").textContent = s.lastError ?? "—";
  setPillWs(s.wsState, s.registered);
  setPillReg(s.registered);
  setPillRole(s.deviceRole);
  setPillCmdReady(s.commandReady);
  flushBranchLibrary();
}

/** Branch library grid — React; selection driven by `lastStatusSnapshot`. */
let branchLibraryApi: SyncBizDesktopMvp | null = null;
let branchLibKind: "idle" | "error" | "ok" = "idle";
let branchLibItems: BranchLibraryListItem[] = [];
let branchLibErr: string | null = null;

function flushBranchLibrary(): void {
  if (!branchLibraryApi) return;
  const api = branchLibraryApi;
  const onSelect = (it: BranchLibraryListItem): void => {
    void (async () => {
      try {
        const snap = await api.selectStationSource(it as BranchLibraryItem);
        applyStatus(snap);
        setFeedback(`Station source: ${it.title}`, "ok");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setFeedback(`Selection failed: ${msg}`, "err");
      }
    })();
  };
  const sel = lastStatusSnapshot?.mockSelectedLibraryId ?? null;
  if (branchLibKind === "idle") {
    renderBranchLibrary({ kind: "idle" });
    return;
  }
  if (branchLibKind === "error") {
    renderBranchLibrary({ kind: "error", message: branchLibErr ?? "—" });
    return;
  }
  renderBranchLibrary({ kind: "ok", items: branchLibItems, selectedId: sel, onSelect });
}

function applyBranchLibrary(sum: BranchLibrarySummary, _api: SyncBizDesktopMvp): void {
  el<HTMLSpanElement>("branchLibStatus").textContent =
    sum.status === "ok"
      ? `OK · branch ${sum.branchId ?? "—"}`
      : sum.status === "error"
        ? `Error`
        : "—";
  if (sum.status === "ok") {
    el<HTMLSpanElement>("branchLibCounts").textContent = [
      `playlists ${sum.playlistCount ?? 0}`,
      `radio ${sum.radioCount ?? 0}`,
      `sources ${sum.sourceCount ?? 0}`,
    ].join(", ");
    branchLibKind = "ok";
    branchLibItems = (sum.items ?? []) as BranchLibraryListItem[];
    branchLibErr = null;
  } else if (sum.status === "error") {
    el<HTMLSpanElement>("branchLibCounts").textContent = "—";
    branchLibKind = "error";
    branchLibErr = sum.errorMessage ?? "—";
    branchLibItems = [];
  } else {
    el<HTMLSpanElement>("branchLibCounts").textContent = "—";
    branchLibKind = "idle";
    branchLibErr = null;
    branchLibItems = [];
  }
  flushBranchLibrary();
}

function formatExpiryIso(iso: string): string {
  const d = Date.parse(iso);
  if (Number.isNaN(d)) return iso;
  return new Date(d).toLocaleString();
}

function fillForm(c: DesktopRuntimeConfig): void {
  el<HTMLInputElement>("workspaceLabel").value = c.workspaceLabel ?? "";
  el<HTMLInputElement>("branchId").value = c.branchId ?? "default";
  el<HTMLInputElement>("deviceId").value = c.deviceId ?? "";
  el<HTMLInputElement>("apiBaseUrl").value = c.apiBaseUrl ?? "";
  el<HTMLInputElement>("wsUrl").value = c.wsUrl ?? "";
  el<HTMLTextAreaElement>("wsToken").value = c.wsToken ?? "";
  el<HTMLInputElement>("authEmail").value = c.lastAuthEmail ?? "";
  el<HTMLInputElement>("authPassword").value = "";
  el<HTMLSpanElement>("stTokenExp").textContent = c.desktopTokenExpiresAtIso?.trim()
    ? formatExpiryIso(c.desktopTokenExpiresAtIso.trim())
    : "—";
}

function readPatchFromForm(): DesktopRuntimeConfig {
  return {
    workspaceLabel: el<HTMLInputElement>("workspaceLabel").value,
    branchId: el<HTMLInputElement>("branchId").value,
    deviceId: el<HTMLInputElement>("deviceId").value,
    apiBaseUrl: el<HTMLInputElement>("apiBaseUrl").value,
    wsUrl: el<HTMLInputElement>("wsUrl").value,
    wsToken: el<HTMLTextAreaElement>("wsToken").value,
  };
}

async function bootstrap(): Promise<void> {
  console.log("[SyncBiz desktop] renderer: bootstrap start");
  const api = window.syncbizDesktop;
  if (!api) {
    document.body.innerHTML =
      "<p style='color:#f87171;padding:1rem'>syncbizDesktop API missing — preload not loaded.</p>";
    return;
  }

  branchLibraryApi = api;
  mountPlayerHero(el<HTMLDivElement>("playerHeroRoot"));
  mountPlayerDeckMetaStrip(el<HTMLDivElement>("playerDeckMetaRoot"));
  mountPlaybackDock(el<HTMLDivElement>("playbackDockRoot"));
  mountBranchLibrary(el<HTMLDivElement>("branchLibList"));
  const debugRoot = document.getElementById("desktopDebugPanelRoot");
  if (debugRoot) mountDesktopDebugPanel(debugRoot);

  const jinglesRoot = document.getElementById("jinglesShellRoot");
  const pageLayout = document.getElementById("playerPageLayout");
  // Jingles: isolated root only — does not mount/unmount player hero, dock, or transport.
  if (
    typeof __DESKTOP_JINGLES_CONTROL_UI__ !== "undefined" &&
    __DESKTOP_JINGLES_CONTROL_UI__ &&
    jinglesRoot &&
    pageLayout
  ) {
    jinglesRoot.removeAttribute("hidden");
    pageLayout.classList.add("player-page-layout--with-jingles");
    mountJinglesShell(jinglesRoot);
  }

  flushBranchLibrary();

  let volumeDebounce: ReturnType<typeof setTimeout> | null = null;
  const scheduleVolume = (v: number): void => {
    if (volumeDebounce) clearTimeout(volumeDebounce);
    volumeDebounce = setTimeout(() => {
      void (async () => {
        try {
          const snap = await api.localMockTransport({ command: "SET_VOLUME", volume: v });
          applyStatus(snap);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          setFeedback(`Volume: ${msg}`, "err");
        }
      })();
    }, 100);
  };

  async function localTransport(
    command: "PLAY" | "PAUSE" | "STOP" | "PREV" | "NEXT",
  ): Promise<void> {
    try {
      const snap = await api.localMockTransport({ command });
      applyStatus(snap);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setFeedback(`Transport: ${msg}`, "err");
    }
  }

  desktopHeroWire = {
    onPlay: () => void localTransport("PLAY"),
    onPause: () => void localTransport("PAUSE"),
    onStop: () => void localTransport("STOP"),
    onPrev: () => void localTransport("PREV"),
    onNext: () => void localTransport("NEXT"),
    onVolumeChange: (v) => {
      scheduleVolume(v);
    },
  };

  /** First paint: roots were empty until applyStatus ran after async IPC (looked like a full player regression). */
  renderPlayerHero(mvpSnapshotToPlayerHeroProps(DESKTOP_IDLE_STATUS_SNAPSHOT, desktopHeroWire));
  renderPlaybackDock(mvpSnapshotToPlaybackDockProps(DESKTOP_IDLE_STATUS_SNAPSHOT, desktopHeroWire));
  renderPlayerDeckMetaStrip(mvpSnapshotToDeckMetaStripProps(DESKTOP_IDLE_STATUS_SNAPSHOT));
  renderDesktopDebugPanel(DESKTOP_IDLE_STATUS_SNAPSHOT, typeof window !== "undefined" ? window.location.href : "");

  /** Subscribe before any await so we do not miss `mvp:status` emissions from the main process. */
  api.onStatus((s) => {
    applyStatus(s);
  });

  try {
    const snap = await api.getStatus();
    applyStatus(snap);
    const cfg = await api.getConfig();
    fillForm(cfg);
    setFeedback("Ready. Edit fields and Save, or Connect.", "info");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setFeedback(`Failed to load config/status: ${msg}`, "err");
  }

  el<HTMLButtonElement>("btnSignIn").addEventListener("click", async () => {
    el<HTMLButtonElement>("btnSignIn").disabled = true;
    try {
      setFeedback("Signing in…", "info");
      const email = el<HTMLInputElement>("authEmail").value;
      const password = el<HTMLInputElement>("authPassword").value;
      const result = await api.signInWithPassword(email, password);
      if (!result.ok) {
        setFeedback(result.error, "err");
        return;
      }
      fillForm(result.config);
      const snap = await api.getStatus();
      applyStatus(snap);
      setFeedback("Signed in. Token saved — use Connect or Refresh branch library.", "ok");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setFeedback(`Sign-in failed: ${msg}`, "err");
    } finally {
      el<HTMLButtonElement>("btnSignIn").disabled = false;
    }
  });

  el<HTMLButtonElement>("btnSave").addEventListener("click", async () => {
    try {
      setFeedback("Saving…", "info");
      const patch = readPatchFromForm();
      const next = await api.saveConfig(patch);
      fillForm(next);
      const snap = await api.getStatus();
      applyStatus(snap);
      setFeedback(`Config saved (${new Date().toLocaleTimeString()}).`, "ok");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setFeedback(`Save failed: ${msg}`, "err");
    }
  });

  el<HTMLButtonElement>("btnConnect").addEventListener("click", async () => {
    el<HTMLButtonElement>("btnConnect").disabled = true;
    try {
      setFeedback("Saving and connecting…", "info");
      await api.saveConfig(readPatchFromForm());
      fillForm(await api.getConfig());
      const snap = await api.connectCloud();
      applyStatus(snap);
      if (snap.wsState === "error" || snap.lastError) {
        setFeedback(`Connect finished with error: ${snap.lastError ?? snap.wsState}`, "err");
      } else if (snap.registered && snap.wsState === "connected") {
        setFeedback("Connected and registered with SyncBiz WS.", "ok");
      } else {
        setFeedback("Connect attempt finished — see Runtime status and Last error.", "warn");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setFeedback(`Connect failed: ${msg}`, "err");
      try {
        const snap = await api.getStatus();
        applyStatus(snap);
      } catch {
        /* ignore */
      }
    } finally {
      el<HTMLButtonElement>("btnConnect").disabled = false;
    }
  });

  el<HTMLButtonElement>("btnDisconnect").addEventListener("click", async () => {
    try {
      setFeedback("Disconnecting…", "info");
      const snap = await api.disconnectCloud();
      applyStatus(snap);
      setFeedback("Disconnected.", "ok");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setFeedback(`Disconnect failed: ${msg}`, "err");
    }
  });

  el<HTMLButtonElement>("btnBranchLibrary").addEventListener("click", async () => {
    el<HTMLButtonElement>("btnBranchLibrary").disabled = true;
    try {
      await api.saveConfig(readPatchFromForm());
      fillForm(await api.getConfig());
      const sum = await api.fetchBranchLibrary();
      applyBranchLibrary(sum, api);
      if (sum.status === "ok") {
        setFeedback("Branch library snapshot loaded.", "ok");
      } else {
        setFeedback(sum.errorMessage ?? "Branch library fetch failed.", "err");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      applyBranchLibrary({ status: "error", errorMessage: msg }, api);
      setFeedback(`Branch library: ${msg}`, "err");
    } finally {
      el<HTMLButtonElement>("btnBranchLibrary").disabled = false;
    }
  });

  console.log("[SyncBiz desktop] renderer: handlers attached");
}

void bootstrap();
