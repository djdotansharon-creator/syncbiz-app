/**
 * Local playback bridge for Windows (MVP).
 * Runs a Windows command to open a playlist file with the system default app (e.g. Winamp).
 * SyncBiz does not store or stream media – it only sends the command.
 * For local development / Windows only.
 */

import { exec } from "child_process";
import { platform } from "os";
import type { BrowserPreference } from "@/lib/types";

export type PlayLocalResult =
  | { success: true; command: string; fallbackUsed: boolean }
  | { success: false; error: string; command: string; fallbackUsed: boolean };

function execCommand(command: string): Promise<{ ok: true } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    exec(command, { windowsHide: true }, (err, _stdout, stderr) => {
      if (err) {
        resolve({
          ok: false,
          error: (stderr?.trim() || err.message) || "Failed to run command",
        });
        return;
      }
      resolve({ ok: true });
    });
  });
}

function isUrlTarget(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(target);
}

/**
 * Opens a local playlist file with the system default application (e.g. Winamp).
 * Uses: cmd /c start "" "<path>"
 * Only runs on Windows (win32). On other platforms returns an error.
 */
export async function runLocalPlaylist(
  targetPath: string,
  browserPreference: BrowserPreference = "default",
): Promise<PlayLocalResult> {
  const path = (targetPath ?? "").trim();
  if (!path) {
    return Promise.resolve({ success: false, error: "Target path is required", command: "", fallbackUsed: false });
  }

  if (platform() !== "win32") {
    return Promise.resolve({
      success: false,
      error: "Local playback is only supported on Windows",
      command: "",
      fallbackUsed: false,
    });
  }

  // cmd: start "" "<target>" — escape double quotes in target by doubling them
  const escapedTarget = path.replace(/"/g, '""');
  const defaultCommand = `cmd /c start "" "${escapedTarget}"`;

  console.log("[play-local] Target path:", path);
  console.log("[play-local] Browser preference:", browserPreference);

  // For files/local playlists: keep existing logic (default Windows association)
  if (!isUrlTarget(path) || browserPreference === "default") {
    console.log("[play-local] Command:", defaultCommand);
    const result = await execCommand(defaultCommand);
    if (result.ok) {
      console.log("[play-local] Success");
      return { success: true, command: defaultCommand, fallbackUsed: false };
    }
    console.error("[play-local] Failed:", result.error);
    return {
      success: false,
      error: result.error,
      command: defaultCommand,
      fallbackUsed: false,
    };
  }

  const preferredBinary =
    browserPreference === "chrome"
      ? "chrome"
      : browserPreference === "edge"
        ? "msedge"
        : "firefox";

  const preferredCommand = `cmd /c start "" ${preferredBinary} "${escapedTarget}"`;
  console.log("[play-local] Preferred command:", preferredCommand);

  const preferredResult = await execCommand(preferredCommand);
  if (preferredResult.ok) {
    console.log("[play-local] Success (preferred browser)");
    return { success: true, command: preferredCommand, fallbackUsed: false };
  }

  console.warn(
    "[play-local] Preferred browser launch failed, falling back to default browser:",
    preferredResult.error,
  );
  console.log("[play-local] Fallback command:", defaultCommand);

  const fallbackResult = await execCommand(defaultCommand);
  if (fallbackResult.ok) {
    console.log("[play-local] Success (fallback)");
    return { success: true, command: defaultCommand, fallbackUsed: true };
  }

  console.error("[play-local] Fallback failed:", fallbackResult.error);
  return {
    success: false,
    error: fallbackResult.error,
    command: defaultCommand,
    fallbackUsed: true,
  };
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
