import path from "node:path";
import { existsSync } from "node:fs";
import { app, BrowserWindow } from "electron";

import { registerMvpIpc } from "./ipc-mvp";
import { startEmbeddedNextServer, type EmbeddedNextHandle } from "./embedded-next-server";
import { PlaybackOrchestrator } from "./playback-orchestrator";
import { ensureRuntimeBinaries, scheduleBackgroundUpdateCheck } from "./runtime-binaries";

let mainWindow: BrowserWindow | null = null;
let embeddedNext: EmbeddedNextHandle | null = null;
let orchestrator: PlaybackOrchestrator | undefined;

function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

const LEGACY_RENDERER_HTML = path.join(__dirname, "../renderer/index.html");

function packagedStandalonePath(): string {
  return path.join(process.resourcesPath, "syncbiz-web");
}

function shutdownEmbeddedNext(): void {
  if (!embeddedNext) return;
  try {
    embeddedNext.child.kill();
  } catch {
    /* ignore */
  }
  embeddedNext = null;
}

async function resolveMainWindowUrl(): Promise<{ kind: "legacy" } | { kind: "url"; url: string }> {
  const forceLegacy = process.env.SYNCBIZ_DESKTOP_USE_LEGACY_RENDERER === "1";
  if (forceLegacy) return { kind: "legacy" };

  if (embeddedNext) {
    return { kind: "url", url: embeddedNext.baseUrl };
  }

  // Must match the hostname users log in on in the browser (Next dev prints http://localhost:3000).
  // Cookie `syncbiz-session` is host-scoped; 127.0.0.1 vs localhost are different origins.
  const devDefault = (process.env.SYNCBIZ_DESKTOP_DEV_WEB_URL ?? "http://localhost:3000").trim();
  const hostedUrl = (process.env.SYNCBIZ_DESKTOP_WEB_APP_URL ?? "").trim();
  const standaloneEnv = (process.env.SYNCBIZ_DESKTOP_STANDALONE_DIR ?? "").trim();

  if (standaloneEnv) {
    const root = path.isAbsolute(standaloneEnv) ? standaloneEnv : path.join(process.cwd(), standaloneEnv);
    embeddedNext = await startEmbeddedNextServer(root);
    return { kind: "url", url: embeddedNext.baseUrl };
  }

  if (!app.isPackaged) {
    return { kind: "url", url: devDefault };
  }

  if (hostedUrl) {
    return { kind: "url", url: hostedUrl };
  }

  const bundled = packagedStandalonePath();
  if (existsSync(path.join(bundled, "server.js"))) {
    embeddedNext = await startEmbeddedNextServer(bundled);
    return { kind: "url", url: embeddedNext.baseUrl };
  }

  console.warn(
    "[SyncBiz desktop] Packaged app: no embedded Next under resources/syncbiz-web and no SYNCBIZ_DESKTOP_WEB_APP_URL; loading legacy renderer.",
  );
  return { kind: "legacy" };
}

function applyMainWindowContent(
  win: BrowserWindow,
  resolved: { kind: "legacy" } | { kind: "url"; url: string },
): void {
  if (resolved.kind === "legacy") {
    win.loadFile(LEGACY_RENDERER_HTML);
    return;
  }
  void win.loadURL(resolved.url).catch((err) => {
    console.error("[SyncBiz desktop] loadURL failed:", resolved.url, err);
  });
}

/**
 * In packaged builds, electron-builder embeds `build/icon.ico` into the .exe so the
 * window/taskbar/Start Menu icons all pick it up automatically. For unpackaged dev
 * runs we have to point Electron at the file ourselves, otherwise the BrowserWindow
 * (and the taskbar entry it creates) falls back to the default Electron logo —
 * which is the gap that made dev sessions look unbranded.
 */
function resolveBrandIconPath(): string | undefined {
  const candidates = [
    // dev / unpackaged: desktop/build/icon.ico (Windows) or icon.png (cross-platform fallback)
    path.join(__dirname, "..", "..", "..", "build", "icon.ico"),
    path.join(__dirname, "..", "..", "..", "build", "icon.png"),
    // packaged: electron-builder copies build resources next to the asar — these paths
    // are mostly redundant (the .exe already has the icon embedded) but they let the
    // window object expose a canonical icon if anything queries it.
    path.join(process.resourcesPath ?? "", "icon.ico"),
    path.join(process.resourcesPath ?? "", "icon.png"),
  ];
  for (const p of candidates) {
    if (p && existsSync(p)) return p;
  }
  return undefined;
}

function createBrowserWindow(): BrowserWindow {
  const iconPath = resolveBrandIconPath();
  return new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 640,
    minHeight: 520,
    title: "SyncBiz Player",
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
}

async function openMainWindow(): Promise<void> {
  const resolved = await resolveMainWindowUrl();
  if (resolved.kind === "url") {
    const mode = !app.isPackaged
      ? "dev (loads Next from SYNCBIZ_DESKTOP_DEV_WEB_URL or http://localhost:3000 when unpackaged — always matches local next dev if running)"
      : (process.env.SYNCBIZ_DESKTOP_WEB_APP_URL ?? "").trim()
        ? "hosted (SYNCBIZ_DESKTOP_WEB_APP_URL)"
        : embeddedNext
          ? "embedded (staged Next from last `npm run build:electron-web` under resources/syncbiz-web; rebuild before dist:win to refresh UI)"
          : "url (embedded server not tracked here)";
    console.log("[SyncBiz desktop] Web UI source:", mode);
    console.log("[SyncBiz desktop] Web UI URL:", resolved.url);
  } else {
    console.warn(
      "[SyncBiz desktop] Web UI: LEGACY desktop/renderer/index.html (not the Next app). Use unpackaged+localhost, SYNCBIZ_DESKTOP_WEB_APP_URL, or a packaged build with server.js in extraResources (run build:electron-web before dist).",
    );
  }
  const win = createBrowserWindow();
  // Mute all Chromium audio output — in desktop mode every sound goes through MPV.
  win.webContents.setAudioMuted(true);
  console.log("[SyncBiz desktop] Chromium audio muted — all playback routes through MPV");
  applyMainWindowContent(win, resolved);
  mainWindow = win;
}

app.whenReady().then(async () => {
  // Runtime binaries FIRST. `ensureRuntimeBinaries` either returns instantly
  // (cached) or opens its own first-run splash and downloads mpv + yt-dlp
  // into userData/bin/. We block launch on this because the orchestrator
  // can't do anything useful without mpv — an unresolvable failure surfaces
  // via its own retry/quit dialog.
  let binaries: { mpvBin: string; ytDlpBin: string | null };
  try {
    binaries = await ensureRuntimeBinaries();
  } catch (err) {
    console.error("[SyncBiz desktop] runtime-binaries setup failed:", err);
    shutdownEmbeddedNext();
    app.quit();
    return;
  }

  orchestrator = new PlaybackOrchestrator();
  orchestrator.start(binaries);
  registerMvpIpc(getMainWindow, orchestrator);

  void openMainWindow().catch((err) => {
    console.error("[SyncBiz desktop] failed to open main window:", err);
    shutdownEmbeddedNext();
    app.quit();
  });

  // Fire-and-forget: once the app is running, start watching for yt-dlp
  // updates in the background. Never blocks, never crashes.
  scheduleBackgroundUpdateCheck();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void openMainWindow().catch((err) => {
        console.error("[SyncBiz desktop] failed to reopen window:", err);
      });
    }
  });
});

app.on("before-quit", () => {
  orchestrator?.kill();
  shutdownEmbeddedNext();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
