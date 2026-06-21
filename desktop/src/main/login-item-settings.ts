import { app } from "electron";

import type { AutoStartState } from "../shared/mvp-types";

/**
 * Windows/macOS unpackaged runs use `electron.exe` as `process.execPath`. Login items
 * must pass the app folder as an argument — otherwise the OS launches bare
 * `electron.exe`, which opens Electron's default demo window alongside SyncBiz.
 */
function loginItemQueryOptions(): { path: string; args: string[] } | undefined {
  if (app.isPackaged) return undefined;
  return {
    path: process.execPath,
    args: [app.getAppPath()],
  };
}

export function applyAutoStart(enabled: boolean): void {
  const query = loginItemQueryOptions();
  if (query) {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      path: query.path,
      args: query.args,
    });
    return;
  }
  app.setLoginItemSettings({ openAtLogin: enabled });
}

export function readAutoStartState(): AutoStartState {
  const supported = process.platform === "win32" || process.platform === "darwin";
  try {
    const query = loginItemQueryOptions();
    const settings = query
      ? app.getLoginItemSettings({ path: query.path, args: query.args })
      : app.getLoginItemSettings();
    return {
      enabled: Boolean(settings.openAtLogin),
      supported,
    };
  } catch (err) {
    console.error("[SyncBiz desktop] getLoginItemSettings failed:", err);
    return { enabled: false, supported };
  }
}

/** Re-register login item with correct args when an older build left a bare electron.exe entry. */
export function repairAutoStartLoginItemIfEnabled(): void {
  if (process.platform !== "win32" && process.platform !== "darwin") return;
  try {
    const legacy = app.getLoginItemSettings();
    if (!legacy.openAtLogin) return;
    applyAutoStart(true);
  } catch (err) {
    console.error("[SyncBiz desktop] repairAutoStartLoginItemIfEnabled failed:", err);
  }
}
