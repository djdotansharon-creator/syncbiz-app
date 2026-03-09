/**
 * Local playback bridge for Windows (MVP).
 * Runs a Windows command to open a playlist file with the system default app (e.g. Winamp).
 * SyncBiz does not store or stream media – it only sends the command.
 * For local development / Windows only.
 */

import { exec } from "child_process";
import { platform } from "os";

export type PlayLocalResult = { success: true } | { success: false; error: string };

/**
 * Opens a local playlist file with the system default application (e.g. Winamp).
 * Uses: cmd /c start "" "<path>"
 * Only runs on Windows (win32). On other platforms returns an error.
 */
export function runLocalPlaylist(targetPath: string): Promise<PlayLocalResult> {
  const path = (targetPath ?? "").trim();
  if (!path) {
    return Promise.resolve({ success: false, error: "Target path is required" });
  }

  if (platform() !== "win32") {
    return Promise.resolve({
      success: false,
      error: "Local playback is only supported on Windows",
    });
  }

  return new Promise((resolve) => {
    // cmd: start "" "<path>" — escape double quotes in path by doubling them
    const escapedPath = path.replace(/"/g, '""');
    const command = `cmd /c start "" "${escapedPath}"`;

    console.log("[play-local] Target path:", path);
    console.log("[play-local] Command:", command);

    exec(command, { windowsHide: true }, (err, _stdout, stderr) => {
      if (err) {
        console.error("[play-local] Failed:", err.message, stderr?.trim());
        resolve({
          success: false,
          error: (stderr?.trim() || err.message) || "Failed to run command",
        });
        return;
      }
      console.log("[play-local] Success");
      resolve({ success: true });
    });
  });
}

export type StopLocalResult = { success: true } | { success: false; error: string };

/**
 * Stops Winamp on Windows (taskkill /IM winamp.exe /F).
 * For local development / Windows only.
 */
export function runStopLocal(): Promise<StopLocalResult> {
  if (platform() !== "win32") {
    return Promise.resolve({
      success: false,
      error: "Local stop is only supported on Windows",
    });
  }

  return new Promise((resolve) => {
    const command = "taskkill /IM winamp.exe /F";
    console.log("[stop-local] Command:", command);

    exec(command, { windowsHide: true }, (err, _stdout, stderr) => {
      if (err) {
        // taskkill exits non-zero if process not found; treat as success for "already stopped"
        const msg = (stderr?.trim() || err.message) || "";
        if (msg.includes("not found") || msg.includes("No such")) {
          console.log("[stop-local] Success (no process found)");
          resolve({ success: true });
          return;
        }
        console.error("[stop-local] Failed:", err.message, stderr?.trim());
        resolve({ success: false, error: msg || "Failed to run taskkill" });
        return;
      }
      console.log("[stop-local] Success");
      resolve({ success: true });
    });
  });
}
