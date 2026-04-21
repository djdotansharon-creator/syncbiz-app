/**
 * First-run progress window.
 *
 * Shown only when at least one runtime binary is missing and has to be
 * downloaded. On subsequent launches the resolver hits the cache in <50ms
 * and this window never appears.
 *
 * Implementation notes:
 *   - The HTML is a single inline string served via `data:` URL. No file
 *     I/O at runtime, nothing to copy into `dist/`.
 *   - We drive the UI by `webContents.executeJavaScript()` because (a) it
 *     avoids an extra preload script and (b) the payload is tiny — just a
 *     progress number and a status string.
 *   - Frameless + non-resizable + always-on-top so it feels like a splash.
 */

import { BrowserWindow } from "electron";

import type { ResolveProgress } from "./types";

const PROGRESS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>SyncBiz Setup</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    height: 100%;
    background: transparent;
    color: #e2e8f0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    -webkit-app-region: drag;
    user-select: none;
    overflow: hidden;
  }
  body { display: flex; align-items: center; justify-content: center; padding: 0 22px; }
  .card {
    width: 100%;
    padding: 24px 26px;
    background: linear-gradient(180deg, rgba(17, 28, 46, 0.98) 0%, rgba(11, 17, 32, 0.98) 100%);
    border: 1px solid rgba(100, 116, 139, 0.22);
    border-radius: 14px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
    text-align: center;
  }
  h1 { font-size: 15px; font-weight: 600; letter-spacing: 0.3px; margin-bottom: 4px; }
  .sub { font-size: 12px; color: #94a3b8; margin-bottom: 18px; }
  .bar {
    width: 100%; height: 6px;
    background: rgba(255, 255, 255, 0.06);
    border-radius: 999px;
    overflow: hidden;
    margin-bottom: 12px;
  }
  .fill {
    height: 100%; width: 0%;
    background: linear-gradient(90deg, #38bdf8, #0ea5e9);
    transition: width 0.15s linear;
  }
  .fill.indeterminate {
    width: 40% !important;
    animation: slide 1.2s ease-in-out infinite alternate;
  }
  @keyframes slide {
    from { transform: translateX(-30%); }
    to   { transform: translateX(180%); }
  }
  .status { font-size: 12px; color: #cbd5e1; min-height: 16px; line-height: 1.4; }
  .err .fill { background: #ef4444 !important; }
  .err .status { color: #fca5a5; }
</style>
</head>
<body>
<main class="card" id="card">
  <h1>SyncBiz Player</h1>
  <div class="sub" id="sub">One-time setup — preparing playback runtime…</div>
  <div class="bar"><div class="fill indeterminate" id="fill"></div></div>
  <div class="status" id="status">Starting…</div>
</main>
<script>
  window.__applyProgress = function(percent) {
    const fill = document.getElementById('fill');
    if (percent < 0) {
      fill.classList.add('indeterminate');
      fill.style.width = '';
    } else {
      fill.classList.remove('indeterminate');
      fill.style.width = Math.max(0, Math.min(100, percent)) + '%';
    }
  };
  window.__applyStatus = function(text) {
    document.getElementById('status').textContent = text;
  };
  window.__applyError = function(message) {
    document.getElementById('card').classList.add('err');
    document.getElementById('sub').textContent = 'Setup failed';
    document.getElementById('status').textContent = message;
  };
  window.__applyDone = function() {
    document.getElementById('sub').textContent = 'Ready.';
  };
</script>
</body>
</html>`;

export type FirstRunWindowHandle = {
  setProgress: (p: ResolveProgress) => void;
  setError: (message: string) => void;
  setDone: () => void;
  close: () => void;
};

export async function openFirstRunWindow(): Promise<FirstRunWindowHandle> {
  const win = new BrowserWindow({
    width: 420,
    height: 200,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    transparent: false,
    backgroundColor: "#0b1120",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const dataUrl = "data:text/html;charset=utf-8," + encodeURIComponent(PROGRESS_HTML);
  await win.loadURL(dataUrl);

  const exec = async (fn: string, arg?: unknown): Promise<void> => {
    if (win.isDestroyed()) return;
    try {
      const payload = arg === undefined ? "" : JSON.stringify(arg);
      await win.webContents.executeJavaScript(`window.${fn}(${payload})`);
    } catch {
      /* window may have closed mid-exec; ignore */
    }
  };

  return {
    setProgress: (p) => {
      void exec("__applyProgress", p.percent);
      void exec("__applyStatus", p.phase);
    },
    setError: (message) => {
      void exec("__applyError", message);
    },
    setDone: () => {
      void exec("__applyDone");
    },
    close: () => {
      if (!win.isDestroyed()) win.close();
    },
  };
}
