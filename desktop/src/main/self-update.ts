/**
 * Player self-update — Electron wiring for self-update-core.ts (owner 2026-11-02). See the core for the rules.
 * Like a normal app updater: when "Update" is clicked the player's windows are HIDDEN and only the small white "VONO <version>" window (a separate PowerShell/WPF
 * process, self-update-splash.ts) stays on the desktop — through the download, the installer stopping the player, and until the new player's window is up.
 * If anything fails before the installer takes over, the splash is cancelled and the player is shown again.
 */
import { app, BrowserWindow, shell } from "electron";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, mkdirSync, rmSync, writeFileSync, promises as fs } from "node:fs";
import path from "node:path";
import { downloadToFile, fetchJson } from "./runtime-binaries/net";
import { SYNCBIZ_HOSTED_WEB_APP_URL } from "./hosted-url";
import { fileLog } from "./file-logger";
import { splashScript } from "./self-update-splash";
import { INSTALLER_ARGS, performSelfUpdate, resetSelfUpdateBusy, type SelfUpdateDeps, type SelfUpdateResult, type UpdateInfo } from "./self-update-core";

const INSTALL_SAFETY_TIMEOUT_MS = 5 * 60_000;
/** the splash dying this soon after it started means it could not show (blocked PowerShell / WPF) — the player must not stay hidden */
const SPLASH_EARLY_EXIT_MS = 3_000;
let hiddenWindows: BrowserWindow[] = [];

const updateDir = (): string => path.join(app.getPath("temp"), "vono-update");
const cancelFile = (): string => path.join(updateDir(), "cancel");

function hidePlayer(): void {
  hiddenWindows = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && w.isVisible());
  for (const w of hiddenWindows) w.hide();
}

function showPlayer(): void {
  for (const w of hiddenWindows) if (!w.isDestroyed()) w.show();
  hiddenWindows = [];
}

/** Start the small window; the player is hidden only once it really started (if it cannot start, the update still works with the player visible). */
function showWindow(version: string): void {
  try {
    mkdirSync(updateDir(), { recursive: true });
    rmSync(cancelFile(), { force: true });
    const script = path.join(updateDir(), "vono-update-window.ps1");
    writeFileSync(script, splashScript(), "utf8");
    const startedAt = Date.now();
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-STA", "-WindowStyle", "Hidden", "-File", script, "-Version", version, "-OldPid", String(process.pid), "-Cancel", cancelFile()], { detached: true, stdio: "ignore", windowsHide: true });
    child.once("error", (e) => fileLog("WARN", "SELF_UPDATE_SPLASH_FAILED", { message: e.message }));
    child.once("spawn", () => { child.unref(); hidePlayer(); });
    child.once("exit", () => { if (Date.now() - startedAt < SPLASH_EARLY_EXIT_MS) { fileLog("WARN", "SELF_UPDATE_SPLASH_EXITED_EARLY"); showPlayer(); } });
  } catch (e) {
    fileLog("WARN", "SELF_UPDATE_SPLASH_FAILED", { message: (e as Error)?.message });
  }
}

/** The update failed before the installer took over: the splash goes away and the player comes back. */
function closeWindow(): void {
  try { writeFileSync(cancelFile(), "x"); } catch { /* the splash also has its own safety limit */ }
  showPlayer();
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
