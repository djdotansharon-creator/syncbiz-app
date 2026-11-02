/**
 * Player self-update — Electron wiring for self-update-core.ts (owner 2026-11-02). See the core for the rules.
 * The small white "VONO <version>" window with a moving black bar (no frame, no percentage) is shown while the installer is downloaded and verified,
 * and stays until the installer stops this player (or a 5-minute safety timeout closes it).
 */
import { app, BrowserWindow, screen, shell } from "electron";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { downloadToFile, fetchJson } from "./runtime-binaries/net";
import { SYNCBIZ_HOSTED_WEB_APP_URL } from "./hosted-url";
import { fileLog } from "./file-logger";
import { updateWindowHtml } from "./self-update-window-html";
import { INSTALLER_ARGS, performSelfUpdate, resetSelfUpdateBusy, type SelfUpdateDeps, type SelfUpdateResult, type UpdateInfo } from "./self-update-core";

const INSTALL_SAFETY_TIMEOUT_MS = 5 * 60_000;
let win: BrowserWindow | null = null;

function showWindow(version: string): void {
  if (win && !win.isDestroyed()) return;
  const wa = screen.getPrimaryDisplay().workArea;
  const w = 340, h = 112;
  win = new BrowserWindow({
    width: w, height: h, x: Math.round(wa.x + (wa.width - w) / 2), y: Math.round(wa.y + (wa.height - h) / 2),
    frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
    skipTaskbar: true, alwaysOnTop: true, hasShadow: false, show: false, backgroundColor: "#00000000",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.setAlwaysOnTop(true, "screen-saver");
  void win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(updateWindowHtml(version)));
  win.once("ready-to-show", () => win?.showInactive());
  win.on("closed", () => { win = null; });
}

function closeWindow(): void {
  if (win && !win.isDestroyed()) win.destroy();
  win = null;
}

function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    const s = createReadStream(file);
    s.on("error", reject);
    s.on("data", (c) => h.update(c));
    s.on("end", () => resolve(h.digest("hex")));
  });
}

async function fetchInfo(): Promise<UpdateInfo | null> {
  try {
    const base = SYNCBIZ_HOSTED_WEB_APP_URL.replace(/\/+$/, "");
    const d = await fetchJson<{ ok?: boolean; version?: string; url?: string | null; sha256?: string | null }>(`${base}/api/desktop/download?platform=win`);
    if (!d || d.ok !== true || typeof d.version !== "string" || typeof d.url !== "string" || !d.url) return null;
    const installerUrl = d.url.startsWith("/") ? base + d.url : d.url;
    if (!/^https:\/\//i.test(installerUrl)) return null; // never an insecure installer URL
    return { version: d.version.trim(), installerUrl, sha256: typeof d.sha256 === "string" ? d.sha256 : null };
  } catch (e) {
    fileLog("WARN", "SELF_UPDATE_INFO_FAILED", { message: (e as Error)?.message });
    return null;
  }
}

function runInstaller(file: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, [...INSTALLER_ARGS], { detached: true, stdio: "ignore", windowsHide: true });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      // safety: if the installer never stops this player (it failed after starting) the window must not stay forever
      setTimeout(() => { closeWindow(); resetSelfUpdateBusy(); fileLog("WARN", "SELF_UPDATE_INSTALLER_TIMEOUT"); }, INSTALL_SAFETY_TIMEOUT_MS).unref();
      resolve();
    });
  });
}

const deps: SelfUpdateDeps = {
  fetchInfo,
  showWindow,
  closeWindow,
  tempPath: (version) => path.join(app.getPath("temp"), "vono-update", `VONO-Player-Setup-${version.replace(/[^0-9A-Za-z.-]/g, "")}-x64.exe`),
  download: (url, dest) => downloadToFile(url, dest),
  sha256File,
  removeFile: (p) => fs.rm(p, { force: true }),
  runInstaller,
  openInBrowser: (url) => { void shell.openExternal(url); },
  log: (event, data) => fileLog("INFO", event, data),
};

/** IPC entry: the renderer's "Update" pill. Windows packaged app only — anything else answers `unsupported` and the pill keeps its download link. */
export async function startSelfUpdate(): Promise<SelfUpdateResult | { ok: false; reason: "unsupported" }> {
  if (process.platform !== "win32" || !app.isPackaged) return { ok: false, reason: "unsupported" };
  return performSelfUpdate(deps, app.getVersion());
}
