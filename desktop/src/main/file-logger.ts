/**
 * File-based logger for the Electron main process.
 *
 * Log file location:
 *   Windows: %APPDATA%\SyncBiz Player\logs\main.log
 *   macOS:   ~/Library/Logs/SyncBiz Player/main.log
 *   Linux:   ~/.config/SyncBiz Player/logs/main.log
 *
 * Approach: synchronous appendFileSync so we never lose a line even if
 * the process crashes immediately after writing.  Max file size 5 MB —
 * the file is truncated (not rotated) when that threshold is crossed at
 * startup so older boots don't crowd out the current one.
 */

import { appendFileSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "electron";

let logFilePath: string | null = null;

// ─── Path resolution ────────────────────────────────────────────────────────
// app.getPath("userData") is available before app.whenReady() in Electron 20+.
// We still wrap it in a try/catch for safety in case of very early crashes.
function resolveLogDir(): string {
  try {
    return path.join(app.getPath("userData"), "logs");
  } catch {
    // Pre-ready fallback
    const base =
      process.env.APPDATA ??
      (process.platform === "darwin"
        ? path.join(os.homedir(), "Library", "Logs")
        : path.join(os.homedir(), ".config"));
    return path.join(base, "SyncBiz Player", "logs");
  }
}

// ─── Init ────────────────────────────────────────────────────────────────────
export function initFileLogger(): void {
  try {
    const logDir = resolveLogDir();
    mkdirSync(logDir, { recursive: true });
    logFilePath = path.join(logDir, "main.log");

    // Rotate: truncate if already > 5 MB so the current boot is always readable
    try {
      if (statSync(logFilePath).size > 5 * 1024 * 1024) {
        writeFileSync(logFilePath, "");
      }
    } catch {
      /* file doesn't exist yet — first run */
    }

    fileLog("INFO", "═══ SyncBiz Player boot ═══", {
      version: app.getVersion(),
      electron: process.versions.electron,
      node: process.versions.node,
      chrome: process.versions.chrome,
      platform: process.platform,
      arch: process.arch,
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      userData: (() => { try { return app.getPath("userData"); } catch { return "?"; } })(),
      logFile: logFilePath,
      cwd: process.cwd(),
      execPath: process.execPath,
    });
  } catch (err) {
    // Logger init failure must not crash the app
    console.error("[SyncBiz FileLogger] init failed:", err);
  }
}

// ─── Core write ──────────────────────────────────────────────────────────────
export type LogLevel = "INFO" | "WARN" | "ERROR";

export function fileLog(level: LogLevel, message: string, data?: unknown): void {
  // Always mirror to console so Dev Tools / Electron stdout also shows it
  const consoleFn = level === "ERROR" ? console.error : level === "WARN" ? console.warn : console.log;
  consoleFn(`[SyncBiz ${level}] ${message}`, data ?? "");

  if (!logFilePath) return;
  try {
    const ts = new Date().toISOString();
    let line = `[${ts}] [${level}] ${message}`;
    if (data !== undefined) {
      try {
        line += " " + JSON.stringify(data);
      } catch {
        line += " [unserializable]";
      }
    }
    appendFileSync(logFilePath, line + "\n");
  } catch {
    /* disk full, permissions, etc. — never throw from logger */
  }
}

export function getLogFilePath(): string | null {
  return logFilePath;
}
