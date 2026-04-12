import path from "node:path";
import { existsSync } from "node:fs";
import { app, BrowserWindow } from "electron";

import { registerMvpIpc } from "./ipc-mvp";
import { startEmbeddedNextServer, type EmbeddedNextHandle } from "./embedded-next-server";

let mainWindow: BrowserWindow | null = null;
let embeddedNext: EmbeddedNextHandle | null = null;

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

function createBrowserWindow(): BrowserWindow {
  return new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 640,
    minHeight: 520,
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
  const win = createBrowserWindow();
  applyMainWindowContent(win, resolved);
  mainWindow = win;
}

app.whenReady().then(() => {
  registerMvpIpc(getMainWindow);
  void openMainWindow().catch((err) => {
    console.error("[SyncBiz desktop] failed to open main window:", err);
    shutdownEmbeddedNext();
    app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void openMainWindow().catch((err) => {
        console.error("[SyncBiz desktop] failed to reopen window:", err);
      });
    }
  });
});

app.on("before-quit", () => {
  shutdownEmbeddedNext();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
