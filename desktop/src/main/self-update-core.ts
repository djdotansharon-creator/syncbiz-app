/**
 * Player self-update (owner 2026-11-02) — the PURE flow, no Electron import (so it is testable without a window or a network).
 *
 * The owner clicks "Update" in the player: the player disappears and a small white window shows "VONO <version>" with a moving black bar (no percentage) —
 * it is a separate process (self-update-splash.ts), so it stays while the installer stops the player and until the new player's window is up — the new installer is
 * downloaded from the SAME site the player already talks to, VERIFIED against the SHA-256 that site publishes (GitHub's asset digest), and only then run
 * silently — the installer's own pre-flight stops VONO Protection + the player and replaces the files (installer.nsh `customCheckAppRunning`).
 *
 * Hard rules: an installer is NEVER run unless its SHA-256 matches; nothing here touches playback / MPV / the WS manager; any failure closes the window and
 * falls back to the old behaviour (the installer link opens in the browser) — the music is never stopped by a failed update.
 * The player does NOT quit itself: starting the installer is exactly a manual install over a running VONO (the proven path) — its pre-flight stops VONO
 * Protection and the player in the right order, so the watchdog never relaunches VONO mid-update. (Its windows are only HIDDEN until then.)
 */

export type UpdateInfo = { version: string; installerUrl: string; sha256: string | null };

export type SelfUpdateDeps = {
  /** what the site publishes (null = unreachable / no installer) */
  fetchInfo: () => Promise<UpdateInfo | null>;
  /** hide the player and show the small update window (the player is NOT closed — a failure brings it straight back) */
  showWindow: (version: string) => void;
  /** the update failed before the installer took over: remove the update window and bring the player back */
  closeWindow: () => void;
  /** where the installer is saved */
  tempPath: (version: string) => string;
  /** download `url` to `dest` (rejects on any failure) */
  download: (url: string, dest: string) => Promise<void>;
  sha256File: (path: string) => Promise<string>;
  removeFile: (path: string) => Promise<void>;
  /** start the installer detached; resolves once it really started, rejects if it could not start (never waits for it to finish) */
  runInstaller: (path: string) => Promise<void>;
  /** failure fallback: let the person download it by hand */
  openInBrowser: (url: string) => void;
  log: (event: string, data?: Record<string, unknown>) => void;
};

export type SelfUpdateResult =
  | { ok: true; version: string }
  | { ok: false; reason: "busy" | "no_info" | "not_newer" | "no_hash" | "download_failed" | "hash_mismatch" | "run_failed" };

/** Silent NSIS upgrade, relaunch the player afterwards (the same arguments electron-updater uses for electron-builder installers). */
export const INSTALLER_ARGS: readonly string[] = ["/S", "--updated", "--force-run"];

function parseSemver(v: string): [number, number, number] | null {
  const m = v.trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** True when `latest` is strictly newer than `current` (pre-release tags ignored — same rule as the web app's lib/desktop-version.ts). */
export function isNewerVersion(latest: string, current: string): boolean {
  const a = parseSemver(latest), b = parseSemver(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}

const HEX64 = /^[0-9a-f]{64}$/;
let busy = false;

/** Run the update. Resolves with the outcome; on success the app is quitting (the installer takes over). */
export async function performSelfUpdate(deps: SelfUpdateDeps, currentVersion: string): Promise<SelfUpdateResult> {
  if (busy) return { ok: false, reason: "busy" };
  busy = true;
  let windowShown = false;
  let started = false;
  let saved: string | null = null;
  let info: UpdateInfo | null = null;
  const fail = async (reason: Exclude<SelfUpdateResult, { ok: true }>["reason"], data?: Record<string, unknown>): Promise<SelfUpdateResult> => {
    deps.log("SELF_UPDATE_FAILED", { reason, ...data });
    if (windowShown) deps.closeWindow();
    if (saved) { try { await deps.removeFile(saved); } catch { /* best effort */ } }
    if (info?.installerUrl && reason !== "not_newer" && reason !== "busy") deps.openInBrowser(info.installerUrl);
    return { ok: false, reason };
  };
  try {
    info = await deps.fetchInfo();
    if (!info) return await fail("no_info");
    if (!isNewerVersion(info.version, currentVersion)) { deps.log("SELF_UPDATE_SKIPPED", { current: currentVersion, latest: info.version }); return await fail("not_newer"); }
    // never run an installer we cannot verify
    const expected = (info.sha256 ?? "").trim().toLowerCase();
    if (!HEX64.test(expected)) return await fail("no_hash", { version: info.version });
    deps.showWindow(info.version);
    windowShown = true;
    deps.log("SELF_UPDATE_START", { current: currentVersion, latest: info.version });
    const dest = deps.tempPath(info.version);
    saved = dest;
    try { await deps.download(info.installerUrl, dest); }
    catch (e) { return await fail("download_failed", { message: (e as Error)?.message }); }
    const actual = (await deps.sha256File(dest).catch(() => "")).toLowerCase();
    if (actual !== expected) return await fail("hash_mismatch", { expected, actual });
    deps.log("SELF_UPDATE_VERIFIED", { version: info.version });
    try { await deps.runInstaller(dest); }
    catch (e) { return await fail("run_failed", { message: (e as Error)?.message }); }
    saved = null; // the installer owns the file now
    started = true; // stays "busy": the installer is about to stop this player; the wiring releases it if that never happens
    deps.log("SELF_UPDATE_INSTALLER_STARTED", { version: info.version });
    return { ok: true, version: info.version };
  } finally {
    if (!started) busy = false;
  }
}

/** Release the single-flight flag (the wiring calls it when the installer never took over; tests call it between cases). */
export function resetSelfUpdateBusy(): void { busy = false; }
