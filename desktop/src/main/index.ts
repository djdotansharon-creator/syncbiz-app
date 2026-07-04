import path from "node:path";
import { existsSync } from "node:fs";
import { app, BrowserWindow, screen } from "electron";

import { initFileLogger, fileLog, getLogFilePath } from "./file-logger";
import { registerMvpIpc } from "./ipc-mvp";
import { startEmbeddedNextServer, type EmbeddedNextHandle } from "./embedded-next-server";
import { flushLocalCollectionTagSnapshotWrites } from "./local-collection-snapshot";
import { PlaybackOrchestrator } from "./playback-orchestrator";
import { ensureRuntimeBinaries, scheduleBackgroundUpdateCheck } from "./runtime-binaries";
import { SYNCBIZ_HOSTED_WEB_APP_URL, SYNCBIZ_ALLOWED_ORIGIN } from "./hosted-url";

// ─── Process-level crash guards (must be registered as early as possible) ────
process.on("uncaughtException", (err) => {
  fileLog("ERROR", "uncaughtException", { message: err?.message, stack: err?.stack });
  // Do NOT call process.exit here — let Electron handle it so the renderer
  // can show an error rather than an abrupt exit with no log.
});

process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;
  fileLog("ERROR", "unhandledRejection", { message: msg, stack });
});

// ─── State ────────────────────────────────────────────────────────────────────
let mainWindow: BrowserWindow | null = null;
let embeddedNext: EmbeddedNextHandle | null = null;
let orchestrator: PlaybackOrchestrator | undefined;
let desktopQuitAfterTagSnapshotFlush = false;

function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

const LEGACY_RENDERER_HTML = path.join(__dirname, "../renderer/index.html");

function packagedStandalonePath(): string {
  return path.join(process.resourcesPath, "syncbiz-web");
}

function shutdownEmbeddedNext(): void {
  if (!embeddedNext) return;
  fileLog("INFO", "shutting down embedded Next server");
  try {
    embeddedNext.child.kill();
  } catch {
    /* ignore */
  }
  embeddedNext = null;
}

async function resolveMainWindowUrl(): Promise<{ kind: "legacy" } | { kind: "url"; url: string }> {
  const forceLegacy = process.env.SYNCBIZ_DESKTOP_USE_LEGACY_RENDERER === "1";
  if (forceLegacy) {
    fileLog("WARN", "resolveMainWindowUrl: SYNCBIZ_DESKTOP_USE_LEGACY_RENDERER=1 → legacy renderer");
    return { kind: "legacy" };
  }

  if (embeddedNext) {
    fileLog("INFO", "resolveMainWindowUrl: reusing existing embeddedNext", { url: embeddedNext.baseUrl });
    return { kind: "url", url: embeddedNext.baseUrl };
  }

  // env override > baked constant (packaged) > "" (dev, where devDefault is used instead)
  const hostedUrl =
    (process.env.SYNCBIZ_DESKTOP_WEB_APP_URL ?? "").trim() ||
    (app.isPackaged ? SYNCBIZ_HOSTED_WEB_APP_URL : "");
  const standaloneEnv = (process.env.SYNCBIZ_DESKTOP_STANDALONE_DIR ?? "").trim();
  const devDefault = (process.env.SYNCBIZ_DESKTOP_DEV_WEB_URL ?? "http://localhost:3000").trim();

  fileLog("INFO", "resolveMainWindowUrl: checking sources", {
    isPackaged: app.isPackaged,
    hostedUrl: hostedUrl || "(empty)",
    standaloneEnv: standaloneEnv || "(empty)",
    devDefault,
    hostedUrlSource: process.env.SYNCBIZ_DESKTOP_WEB_APP_URL?.trim()
      ? "env-override"
      : app.isPackaged
        ? "baked-constant"
        : "(none)",
  });

  // ── Packaged build ─────────────────────────────────────────────────────────
  // Always loads the hosted web app. No embedded server, no DATABASE_URL,
  // no secrets bundled with the installer.
  if (app.isPackaged) {
    fileLog("INFO", "resolveMainWindowUrl: packaged build → hosted URL (no embedded server)", { url: hostedUrl });
    return { kind: "url", url: hostedUrl };
  }

  // ── Dev / unpackaged ────────────────────────────────────────────────────────
  // Allow local testing against a staged web bundle via env var.
  if (standaloneEnv) {
    const root = path.isAbsolute(standaloneEnv) ? standaloneEnv : path.join(process.cwd(), standaloneEnv);
    fileLog("INFO", "resolveMainWindowUrl: dev — starting embedded Next from SYNCBIZ_DESKTOP_STANDALONE_DIR", { root });
    embeddedNext = await startEmbeddedNextServer(root);
    fileLog("INFO", "resolveMainWindowUrl: embeddedNext ready", { url: embeddedNext.baseUrl });
    return { kind: "url", url: embeddedNext.baseUrl };
  }

  // Allow explicit hosted URL override in dev too.
  if (hostedUrl) {
    fileLog("INFO", "resolveMainWindowUrl: dev — using SYNCBIZ_DESKTOP_WEB_APP_URL", { url: hostedUrl });
    return { kind: "url", url: hostedUrl };
  }

  // Default: local Next.js dev server.
  fileLog("INFO", "resolveMainWindowUrl: dev — using devDefault", { url: devDefault });
  return { kind: "url", url: devDefault };
}

function applyMainWindowContent(
  win: BrowserWindow,
  resolved: { kind: "legacy" } | { kind: "url"; url: string },
): void {
  if (resolved.kind === "legacy") {
    fileLog("WARN", "applyMainWindowContent: loading legacy renderer HTML", { path: LEGACY_RENDERER_HTML, exists: existsSync(LEGACY_RENDERER_HTML) });
    win.loadFile(LEGACY_RENDERER_HTML);
    return;
  }
  fileLog("INFO", "applyMainWindowContent: calling loadURL", { url: resolved.url });
  void win.loadURL(resolved.url).then(() => {
    fileLog("INFO", "applyMainWindowContent: loadURL resolved (page load committed)");
  }).catch((err) => {
    fileLog("ERROR", "applyMainWindowContent: loadURL rejected", { url: resolved.url, message: (err as Error)?.message, code: (err as { errorCode?: number })?.errorCode });
    console.error("[SyncBiz desktop] loadURL failed:", resolved.url, err);
  });
}

function resolveBrandIconPath(): string | undefined {
  const candidates = [
    path.join(__dirname, "..", "..", "..", "build", "icon.ico"),
    path.join(__dirname, "..", "..", "..", "build", "icon.png"),
    path.join(process.resourcesPath ?? "", "icon.ico"),
    path.join(process.resourcesPath ?? "", "icon.png"),
  ];
  for (const p of candidates) {
    if (p && existsSync(p)) return p;
  }
  return undefined;
}

// ─── Security helpers ─────────────────────────────────────────────────────────

/**
 * Block navigation away from the authorized origin and deny all popups.
 * Applied to the BrowserWindow when loading a remote hosted URL.
 */
function attachRemoteSecurity(win: BrowserWindow, allowedOrigin: string): void {
  // Block full-page navigation to other origins (e.g. OAuth redirects to
  // unexpected domains, malicious script trying location.href = "...").
  // Same-origin navigation (route changes within the Next.js app) is allowed.
  win.webContents.on("will-navigate", (event, targetUrl) => {
    try {
      if (new URL(targetUrl).origin === allowedOrigin) return; // same origin → ok
    } catch {
      /* invalid URL — block it */
    }
    fileLog("WARN", "security: blocked unauthorized navigation", { targetUrl, allowedOrigin });
    event.preventDefault();
  });

  // Deny window.open and target="_blank" links.
  win.webContents.setWindowOpenHandler(({ url }) => {
    fileLog("WARN", "security: denied popup / window.open", { url });
    return { action: "deny" };
  });

  fileLog("INFO", "attachRemoteSecurity: navigation guard + popup block active", { allowedOrigin });
}

/**
 * Minimal offline error page shown when the hosted URL cannot be reached.
 * Displayed by loadURL("data:text/html,...") so it works without a server.
 */
function buildOfflineErrorHtml(targetUrl: string, logPath: string): string {
  const safeUrl = targetUrl.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const safeLog = logPath.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SyncBiz — Connection Error</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,sans-serif;background:#0f1117;color:#e5e7eb;
       display:flex;flex-direction:column;align-items:center;justify-content:center;
       min-height:100vh;padding:2rem;text-align:center;gap:1rem}
  h1{font-size:1.4rem;color:#f87171}
  p{color:#9ca3af;font-size:.92rem;line-height:1.5}
  code{font-family:monospace;background:#1e2028;padding:.2em .5em;border-radius:4px;
       font-size:.82rem;color:#fbbf24;word-break:break-all}
  button{margin-top:.5rem;padding:.55rem 1.4rem;background:#3b82f6;color:#fff;
         border:none;border-radius:6px;cursor:pointer;font-size:.92rem}
  button:hover{background:#2563eb}
  .log{margin-top:.5rem;font-size:.78rem;color:#4b5563}
</style></head>
<body>
  <h1>Cannot connect to SyncBiz</h1>
  <p>Could not load the SyncBiz web app.<br>
     Please check your internet connection and try again.</p>
  <p>Connecting to: <code>${safeUrl}</code></p>
  <button onclick="location.reload()">Retry</button>
  <p class="log">Error log: <code>${safeLog}</code></p>
</body></html>`;
}

function createBrowserWindow(): BrowserWindow {
  const iconPath = resolveBrandIconPath();
  const preloadPath = path.join(__dirname, "../preload/index.js");

  // Size the initial window to ~85% of the primary display's work area,
  // capped at 1440×900 so it fits comfortably on all screen sizes.
  // We size on logical (CSS) pixels — Electron handles DPI scaling internally.
  const { width: screenW, height: screenH } =
    screen.getPrimaryDisplay().workAreaSize;
  const initWidth  = Math.min(1440, Math.round(screenW * 0.85));
  const initHeight = Math.min(900,  Math.round(screenH * 0.85));

  fileLog("INFO", "createBrowserWindow", {
    iconPath: iconPath ?? "(none)",
    preloadPath,
    preloadExists: existsSync(preloadPath),
    screenWorkArea: { width: screenW, height: screenH },
    windowSize: { width: initWidth, height: initHeight },
  });

  return new BrowserWindow({
    width:     initWidth,
    height:    initHeight,
    minWidth:  760,
    minHeight: 540,
    title: "SyncBiz Player",
    autoHideMenuBar: true,
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
}

// ─── Desktop zoom helpers ─────────────────────────────────────────────────────

/**
 * The CSS pixel width the web app was designed for.
 * At this width the layout is "full" quality (zoom = 1.0).
 * When the window is narrower, zoom scales down so the full layout still fits.
 *
 * Override at runtime: SYNCBIZ_DESKTOP_DESIGN_WIDTH=<px>
 */
function designWidth(): number {
  const env = parseInt(process.env.SYNCBIZ_DESKTOP_DESIGN_WIDTH ?? "", 10);
  return Number.isFinite(env) && env > 200 ? env : 1440;
}

/**
 * Compute the zoom factor for the current BrowserWindow content size.
 * - windowWidth >= designWidth → zoom = 1.0  (full quality)
 * - windowWidth < designWidth  → zoom proportionally < 1.0  (scaled down)
 * Minimum zoom 0.55 to keep the UI readable in small windows.
 */
function computeZoom(windowWidth: number): number {
  const zoom = windowWidth / designWidth();
  return Math.max(0.55, Math.min(1.0, zoom));
}

/**
 * Read the current BrowserWindow *content* width and apply the matching zoom
 * factor so the full-width layout always fits without wrapping.
 */
function applyDesktopZoom(win: BrowserWindow): void {
  const [contentW] = win.getContentSize();
  const zoom = computeZoom(contentW);
  win.webContents.setZoomFactor(zoom);
  fileLog("INFO", "applyDesktopZoom", { contentW, designWidth: designWidth(), zoom });
}

function attachWindowDiagnostics(win: BrowserWindow): void {
  // Fires when the navigation fails (network error, DNS, bad port, etc.)
  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    fileLog("ERROR", "did-fail-load", { errorCode, errorDescription, validatedURL, isMainFrame });
  });

  // Fires when the page finishes loading (or crashes before finishing)
  win.webContents.on("did-finish-load", () => {
    fileLog("INFO", "did-finish-load", { url: win.webContents.getURL() });
  });

  // Fires if the renderer process crashes or is killed
  win.webContents.on("render-process-gone", (_event, details) => {
    fileLog("ERROR", "render-process-gone", details);
  });

  // Fires if a child process (GPU, network service, etc.) dies
  app.on("child-process-gone", (_event, details) => {
    fileLog("ERROR", "child-process-gone", details);
  });

  // Mirror renderer console errors / warnings to the log file
  win.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    if (level >= 2) {
      // 2 = warning, 3 = error
      const lvl = level === 3 ? "ERROR" : "WARN";
      fileLog(lvl, `renderer console (${lvl.toLowerCase()})`, { message, line, sourceId });
    }
  });

  // Log the IPC preload injection result
  win.webContents.on("preload-error", (_event, preloadPath, error) => {
    fileLog("ERROR", "preload-error", { preloadPath, message: error?.message, stack: error?.stack });
  });
}

async function openMainWindow(): Promise<void> {
  fileLog("INFO", "openMainWindow: start");
  const resolved = await resolveMainWindowUrl();

  if (resolved.kind === "url") {
    const mode = !app.isPackaged
      ? "dev"
      : (process.env.SYNCBIZ_DESKTOP_WEB_APP_URL ?? "").trim()
        ? "hosted-env-override"
        : "hosted-baked";
    fileLog("INFO", "openMainWindow: Web UI source", { mode, url: resolved.url });
    console.log("[SyncBiz desktop] Web UI source:", mode);
    console.log("[SyncBiz desktop] Web UI URL:", resolved.url);
  } else {
    fileLog("WARN", "openMainWindow: using legacy renderer HTML");
    console.warn("[SyncBiz desktop] Web UI: LEGACY desktop/renderer/index.html");
  }

  const win = createBrowserWindow();
  attachWindowDiagnostics(win);

  // ── Remote URL security ─────────────────────────────────────────────────────
  if (resolved.kind === "url") {
    // In packaged builds the window always loads the hosted Railway app.
    // Restrict navigation and popups to the authorized origin only.
    const allowedOrigin = app.isPackaged
      ? SYNCBIZ_ALLOWED_ORIGIN
      : new URL(resolved.url).origin;
    attachRemoteSecurity(win, allowedOrigin);

    // Show a user-friendly offline error page when the initial load fails.
    // -3 (ERR_ABORTED) is a normal cancellation (e.g. during redirect) — ignore it.
    const targetUrl = resolved.url;
    win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return;
      if (errorCode === -3) return; // ERR_ABORTED — redirect or navigation cancelled
      fileLog("ERROR", "openMainWindow: main-frame load failed — showing offline error page", {
        errorCode, errorDescription, validatedURL,
      });
      const html = buildOfflineErrorHtml(targetUrl, getLogFilePath() ?? "(log unavailable)");
      void win.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    });
  }

  // Mute all Chromium audio output — in desktop mode every sound goes through MPV.
  win.webContents.setAudioMuted(true);
  fileLog("INFO", "openMainWindow: Chromium audio muted");

  // ── Desktop zoom ────────────────────────────────────────────────────────────
  // Apply once after the first page load and then on every resize so the
  // full-width layout always fits the window without Tailwind compact-mode
  // breakpoints triggering unintentionally.
  win.webContents.on("did-finish-load", () => {
    applyDesktopZoom(win);
  });
  win.on("resize", () => {
    applyDesktopZoom(win);
  });
  // Fullscreen transitions change content size — update zoom immediately.
  win.on("enter-full-screen", () => {
    // Brief delay so Electron reports the updated content size.
    setTimeout(() => applyDesktopZoom(win), 50);
  });
  win.on("leave-full-screen", () => {
    setTimeout(() => applyDesktopZoom(win), 50);
  });

  applyMainWindowContent(win, resolved);
  mainWindow = win;
  fileLog("INFO", "openMainWindow: mainWindow assigned");
}

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  // Initialize file logger first so every subsequent step is captured.
  initFileLogger();

  // ── Comprehensive startup diagnostics ─────────────────────────────────────
  const bundledServerJs = path.join(packagedStandalonePath(), "server.js");
  fileLog("INFO", "app.whenReady: startup diagnostics", {
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    chromeVersion: process.versions.chrome,
    platform: process.platform,
    arch: process.arch,
    isPackaged: app.isPackaged,
    execPath: process.execPath,
    resourcesPath: process.resourcesPath,
    userData: (() => { try { return app.getPath("userData"); } catch { return "?"; } })(),
    logFile: getLogFilePath(),
    cwd: process.cwd(),
    // Embedded Next server (only used in dev; not in packaged builds)
    syncbizWebPath: packagedStandalonePath(),
    bundledServerJsExists: existsSync(bundledServerJs),
    // Hosted web app (used in packaged builds)
    hostedWebAppUrl: (process.env.SYNCBIZ_DESKTOP_WEB_APP_URL ?? "").trim() || SYNCBIZ_HOSTED_WEB_APP_URL,
    hostedUrlSource: process.env.SYNCBIZ_DESKTOP_WEB_APP_URL?.trim() ? "env-override" : "baked-constant",
    allowedOrigin: SYNCBIZ_ALLOWED_ORIGIN,
    // Env overrides
    SYNCBIZ_DESKTOP_WEB_APP_URL: process.env.SYNCBIZ_DESKTOP_WEB_APP_URL || "(not set)",
    SYNCBIZ_DESKTOP_STANDALONE_DIR: process.env.SYNCBIZ_DESKTOP_STANDALONE_DIR || "(not set)",
  });
  // ─────────────────────────────────────────────────────────────────────────

  fileLog("INFO", "app.whenReady: start", { logFile: getLogFilePath() });

  let binaries: { mpvBin: string; ytDlpBin: string | null };
  try {
    fileLog("INFO", "app.whenReady: calling ensureRuntimeBinaries");
    binaries = await ensureRuntimeBinaries();
    fileLog("INFO", "app.whenReady: ensureRuntimeBinaries OK", {
      mpvBin: binaries.mpvBin,
      mpvExists: existsSync(binaries.mpvBin),
      ytDlpBin: binaries.ytDlpBin,
      ytDlpExists: binaries.ytDlpBin ? existsSync(binaries.ytDlpBin) : false,
    });
  } catch (err) {
    fileLog("ERROR", "app.whenReady: ensureRuntimeBinaries failed", {
      message: (err as Error)?.message,
      stack: (err as Error)?.stack,
    });
    shutdownEmbeddedNext();
    app.quit();
    return;
  }

  fileLog("INFO", "app.whenReady: starting PlaybackOrchestrator");
  orchestrator = new PlaybackOrchestrator();
  orchestrator.start(binaries);
  registerMvpIpc(getMainWindow, orchestrator);

  void openMainWindow().catch((err) => {
    fileLog("ERROR", "app.whenReady: openMainWindow failed", {
      message: (err as Error)?.message,
      stack: (err as Error)?.stack,
    });
    console.error("[SyncBiz desktop] failed to open main window:", err);
    shutdownEmbeddedNext();
    app.quit();
  });

  scheduleBackgroundUpdateCheck();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      fileLog("INFO", "activate: reopening main window");
      void openMainWindow().catch((err) => {
        fileLog("ERROR", "activate: openMainWindow failed", { message: (err as Error)?.message });
        console.error("[SyncBiz desktop] failed to reopen window:", err);
      });
    }
  });
});

app.on("before-quit", (e) => {
  if (!desktopQuitAfterTagSnapshotFlush) {
    e.preventDefault();
    desktopQuitAfterTagSnapshotFlush = true;
    fileLog("INFO", "before-quit: flushing tag snapshot then quitting");
    void flushLocalCollectionTagSnapshotWrites()
      .catch(() => undefined)
      .finally(() => {
        orchestrator?.kill();
        shutdownEmbeddedNext();
        app.quit();
      });
    return;
  }
  fileLog("INFO", "before-quit: final quit");
  orchestrator?.kill();
  shutdownEmbeddedNext();
});

app.on("window-all-closed", () => {
  fileLog("INFO", "window-all-closed");
  if (process.platform !== "darwin") {
    app.quit();
  }
});
