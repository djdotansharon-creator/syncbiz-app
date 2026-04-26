/**
 * Public entry point of the runtime-binaries module.
 *
 * The rest of the main process should ONLY touch this file — not `resolver`,
 * not `net`, not `platform`. That way we can reshape internals (add a CDN
 * strategy, switch archive lib, replace the progress UI) without chasing
 * imports across `index.ts` / `mpv-manager.ts` / `playback-orchestrator.ts`.
 */

import { dialog } from "electron";

import type { BinaryName } from "./types";
import { resolveAll, resolveBinary, hasUpstreamUpdate } from "./resolver";
import { openFirstRunWindow, type FirstRunWindowHandle } from "./first-run-window";
import { getEntry } from "./manifest";

export type RuntimeBinaries = {
  mpvBin: string;
  ytDlpBin: string | null;
};

/**
 * Main-process entry point — call this exactly once, early in
 * `app.whenReady()`, BEFORE the playback orchestrator starts MPV.
 *
 * Behaviour:
 *   - Checks manifest/cache/PATH for both binaries.
 *   - If anything has to be downloaded, opens the first-run window and
 *     reports progress while downloading.
 *   - On success: resolves with the absolute paths.
 *   - On failure: shows a blocking error dialog offering Retry / Quit.
 */
export async function ensureRuntimeBinaries(): Promise<RuntimeBinaries> {
  const names: BinaryName[] = ["mpv", "yt-dlp"];

  // Pre-flight: does anything need a download? We DON'T want to flash a
  // setup window when both binaries are already cached — so we peek at the
  // manifest first and only open the window if at least one is missing.
  const needsAnyDownload = await needsFirstRun(names);

  let win: FirstRunWindowHandle | null = null;
  if (needsAnyDownload) {
    win = await openFirstRunWindow();
  }

  try {
    const paths = await resolveAll(names, (p) => {
      if (!win) return;
      if (p.error) {
        win.setError(p.error);
      } else {
        win.setProgress(p);
      }
    });
    win?.setDone();
    // Brief "Ready." flash so the user sees success rather than a fast blink.
    if (win) await delay(400);
    return { mpvBin: paths.mpv, ytDlpBin: paths["yt-dlp"] };
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    if (win) {
      win.setError(message);
      // Leave window on-screen for 1.2s so the user can read the error
      // before the dialog box takes over.
      await delay(1200);
    }
    const retry = await showErrorAndAskRetry(message);
    if (retry) {
      win?.close();
      return ensureRuntimeBinaries();
    }
    throw err;
  } finally {
    win?.close();
  }
}

/**
 * Opportunistic background update for fast-moving binaries (yt-dlp).
 * Runs asynchronously after the main window opens; does NOT block launch.
 *
 * Strategy: if we haven't checked in 24h, hit GitHub once; if a newer
 * version is published, re-resolve (downloads into userData/bin/, atomic
 * rename replaces the current file). Because yt-dlp is spawned as a child
 * process on demand (not held open), the rename is safe mid-session.
 */
export function scheduleBackgroundUpdateCheck(): void {
  // Delay the first check so we don't hammer GitHub right when 1000 users
  // launch in the same minute.
  setTimeout(() => void runUpdateCheck(), 30_000);
  // And repeat once a day in case the user keeps the app open long.
  setInterval(() => void runUpdateCheck(), 24 * 60 * 60 * 1000);
}

async function runUpdateCheck(): Promise<void> {
  // yt-dlp is the only one worth auto-updating — mpv changes slowly enough
  // that a regular SyncBiz release ships a fresh enough version.
  const name: BinaryName = "yt-dlp";
  try {
    const entry = await getEntry(name);
    if (entry?.sourceKind !== "github-release") return; // system/dev-fallback — nothing to update
    const last = entry?.lastCheckedAt ? Date.parse(entry.lastCheckedAt) : 0;
    if (Date.now() - last < 24 * 60 * 60 * 1000) return;

    const needsUpdate = await hasUpstreamUpdate(name);
    if (!needsUpdate) return;

    console.log(`[runtime-binaries] background update available for ${name} — fetching`);
    await resolveBinary(name, { forceRefresh: true });
    console.log(`[runtime-binaries] ${name} updated in background`);
  } catch (err) {
    // Background check must never crash the app; log and move on.
    console.warn(`[runtime-binaries] background update check for ${name} failed:`, (err as Error).message);
  }
}

async function needsFirstRun(names: BinaryName[]): Promise<boolean> {
  for (const name of names) {
    const entry = await getEntry(name);
    if (!entry) return true;
  }
  return false;
}

async function showErrorAndAskRetry(message: string): Promise<boolean> {
  const response = await dialog.showMessageBox({
    type: "error",
    title: "SyncBiz — setup failed",
    message: "SyncBiz couldn't finish first-run setup.",
    detail: message,
    buttons: ["Retry", "Quit"],
    defaultId: 0,
    cancelId: 1,
  });
  return response.response === 0;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { resolveBinary } from "./resolver";
export type { BinaryName } from "./types";
