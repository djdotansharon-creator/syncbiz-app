/**
 * Phase B1 — VONO Protection service (MAIN, dependency-injected, no Electron/child_process imports here).
 *
 * Owns ONLY the Protection ON/OFF machine state + the "VONO Protection" Scheduled Task + the intentional-stop
 * marker. It NEVER touches deviceId / durable-device-id / StationDevice / branchId / workspace / MASTER-CONTROL /
 * WS registration / playback. All OS interaction (schtasks, provision script, Electron login-item, fs) is
 * injected via ProtectionDeps so the logic is unit-testable with fakes + temp dirs.
 *
 * State file: C:\ProgramData\VONO\state\protection.json  { schemaVersion, enabled, updatedAt, source }
 * Marker:     C:\ProgramData\VONO\state\control.json     (VonoControlState mode="intentional_stop", persistent)
 */
import type { VonoControlState } from "../shared/vono-runtime-state";

export const PROTECTION_SCHEMA_VERSION = 1;
export const VONO_PROTECTION_TASK_NAME = "VONO Protection";

export type ProtectionSource = "installer" | "app" | "migration" | "admin";

export type ProtectionState = {
  schemaVersion: number;
  enabled: boolean;
  updatedAt: number;
  source: ProtectionSource;
};

/** Drift between the persisted desired state and the live Scheduled Task. */
export type ProtectionDrift = "none" | "task_missing" | "task_unexpected";

/** What the renderer/UI needs: persisted desired state + capability + live task presence + drift/error. */
export type EffectiveProtection = {
  /** persisted desired state. */
  enabled: boolean;
  /** false on non-Windows (the Scheduled Task mechanism is Windows-only). */
  supported: boolean;
  /** whether the "VONO Protection" Scheduled Task is currently present. */
  taskPresent: boolean;
  source: ProtectionSource | "default";
  /** desired-vs-live mismatch, surfaced (never silently repaired from GET). */
  drift: ProtectionDrift;
  /** true only when supported AND no drift (used for the green "Protected" affordance). */
  healthy: boolean;
  /** set on drift OR when the last transition failed (then enabled = UNCHANGED prior state). */
  error?: string;
};

export type SetProtectionResult = { ok: boolean; state: EffectiveProtection };
export type ExitResult = { ok: boolean; error?: string };

export interface ProtectionDeps {
  now: () => number;
  platform: NodeJS.Platform;
  readFile: (path: string) => string | null;
  writeFile: (path: string, data: string) => void;
  removeFile: (path: string) => void;
  protectionStatePath: () => string;
  controlPath: () => string;
  /** Is the "VONO Protection" Scheduled Task registered right now? */
  taskExists: () => boolean;
  /** Are node.exe / watchdog.cjs / launch-watchdog.ps1 / provision-vono-protection.ps1 present in InstallDir? */
  requiredWatchdogFilesPresent: () => boolean;
  /** Run provision-vono-protection.ps1 -Action install|uninstall. */
  provision: (action: "install" | "uninstall") => { ok: boolean; error?: string };
  /** Turn OFF legacy Electron openAtLogin AND VERIFY it is off. The Scheduled Task must be the ONE start
   *  mechanism, so a transition must not report success while openAtLogin is still on. */
  disableElectronAutostart: () => { ok: boolean; error?: string };
  log: (event: string, fields?: Record<string, unknown>) => void;
}

function isWindows(deps: ProtectionDeps): boolean {
  return deps.platform === "win32";
}

function parseState(raw: string | null): ProtectionState | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Partial<ProtectionState>;
    if (typeof d.enabled !== "boolean") return null;
    return {
      schemaVersion: typeof d.schemaVersion === "number" ? d.schemaVersion : PROTECTION_SCHEMA_VERSION,
      enabled: d.enabled,
      updatedAt: typeof d.updatedAt === "number" ? d.updatedAt : 0,
      source: (d.source as ProtectionSource) ?? "app",
    };
  } catch {
    return null;
  }
}

export function createProtectionService(deps: ProtectionDeps) {
  function persist(state: ProtectionState): void {
    deps.writeFile(deps.protectionStatePath(), JSON.stringify(state, null, 2));
  }

  function driftFor(enabled: boolean, supported: boolean, taskPresent: boolean): { drift: ProtectionDrift; error?: string } {
    if (!supported) return { drift: "none" };
    if (enabled && !taskPresent) {
      return { drift: "task_missing", error: "Protection is enabled but the watchdog task is missing." };
    }
    if (!enabled && taskPresent) {
      return { drift: "task_unexpected", error: "Protection is off but the watchdog task is still active." };
    }
    return { drift: "none" };
  }

  function effective(enabled: boolean, source: ProtectionState["source"] | "default", supported: boolean, taskPresent: boolean, overrideError?: string): EffectiveProtection {
    const { drift, error } = driftFor(enabled, supported, taskPresent);
    return {
      enabled,
      supported,
      taskPresent,
      source,
      drift,
      healthy: supported && drift === "none",
      error: overrideError ?? error,
    };
  }

  /**
   * Read the effective state. Migration when protection.json is absent: existing task → enabled=true (preserves
   * the pilot Lenovo), else false; persisted. GET only DIAGNOSES drift — it never repairs/reprovisions the task.
   */
  function getEffective(): EffectiveProtection {
    const supported = isWindows(deps);
    const taskPresent = supported ? safe(() => deps.taskExists(), false) : false;
    const existing = parseState(deps.readFile(deps.protectionStatePath()));
    if (existing) {
      return effective(existing.enabled, existing.source, supported, taskPresent);
    }
    const migrated: ProtectionState = {
      schemaVersion: PROTECTION_SCHEMA_VERSION,
      enabled: taskPresent,
      updatedAt: deps.now(),
      source: "migration",
    };
    try {
      persist(migrated);
      deps.log("protection_migrated", { enabled: migrated.enabled, taskPresent });
    } catch (e) {
      deps.log("protection_migrate_persist_failed", { err: errMsg(e) });
    }
    return effective(migrated.enabled, "migration", supported, taskPresent);
  }

  /**
   * Enable/disable Protection. Ordering makes the state never lie: legacy openAtLogin is turned off AND verified
   * FIRST (abort before touching the task on failure), then the task op is performed + verified, then persisted.
   * SET may repair drift; failure keeps the prior persisted state and returns an error. Never kills VONO/MPV.
   */
  function setEnabled(target: boolean, source: ProtectionSource = "app"): SetProtectionResult {
    const before = getEffective();
    if (!before.supported) {
      return { ok: false, state: { ...before, error: "Protection is only supported on Windows." } };
    }

    if (target) {
      if (!deps.requiredWatchdogFilesPresent()) {
        deps.log("protection_enable_missing_files", {});
        return { ok: false, state: { ...before, error: "Watchdog files are missing from the install; cannot enable Protection." } };
      }
    }

    // Step 1 (both directions): the Scheduled Task must be the ONE start mechanism → openAtLogin OFF + VERIFIED.
    const da = safe(() => deps.disableElectronAutostart(), { ok: false, error: "Failed to disable OS auto-start." });
    if (!da.ok) {
      deps.log("protection_autostart_disable_failed", { target, err: da.error });
      return { ok: false, state: { ...before, error: da.error || "Could not disable the OS auto-start entry." } };
    }

    // Step 2: task op + verify.
    const action = target ? "install" : "uninstall";
    const res = deps.provision(action);
    if (!res.ok) {
      deps.log("protection_provision_failed", { action, err: res.error });
      return { ok: false, state: { ...before, error: res.error || `Failed to ${action} the Protection task.` } };
    }
    const taskNow = safe(() => deps.taskExists(), target); // conservative fallback
    if (target && !taskNow) {
      deps.log("protection_enable_task_missing_after_install", {});
      return { ok: false, state: { ...before, error: "Protection task did not register." } };
    }
    if (!target && taskNow) {
      deps.log("protection_disable_task_still_present", {});
      return { ok: false, state: { ...before, error: "Protection task is still present after removal." } };
    }

    // Step 3: persist. (NB: switching OFF never kills the running VONO app or MPV.)
    persist({ schemaVersion: PROTECTION_SCHEMA_VERSION, enabled: target, updatedAt: deps.now(), source });
    deps.log(target ? "protection_enabled" : "protection_disabled", { source });
    return { ok: true, state: effective(target, source, true, taskNow) };
  }

  /**
   * Write the PERSISTENT intentional-stop marker (explicit "Exit VONO" while Protection ON). expiresAt=null → it
   * NEVER times out; only a manual VONO start clears it. Verifies the write and returns {ok,error} so the caller
   * can refuse to quit if the marker could not be persisted (else the watchdog would relaunch).
   */
  function writeIntentionalStop(reason: string): ExitResult {
    const control: VonoControlState = {
      schemaVersion: PROTECTION_SCHEMA_VERSION,
      mode: "intentional_stop",
      reason: reason.slice(0, 200),
      source: "app",
      createdAt: deps.now(),
      expiresAt: null, // persistent until explicitly cleared
      bootId: null,
    };
    try {
      deps.writeFile(deps.controlPath(), JSON.stringify(control));
    } catch (e) {
      deps.log("intentional_stop_write_failed", { err: errMsg(e) });
      return { ok: false, error: "Could not write the Exit marker; VONO was not stopped to avoid an auto-restart." };
    }
    // Verify it is actually on disk and parses as intentional_stop.
    try {
      const back = JSON.parse(deps.readFile(deps.controlPath()) ?? "null") as { mode?: string } | null;
      if (back?.mode !== "intentional_stop") {
        return { ok: false, error: "Exit marker verification failed; VONO was not stopped." };
      }
    } catch {
      return { ok: false, error: "Exit marker verification failed; VONO was not stopped." };
    }
    deps.log("intentional_stop_written", {});
    return { ok: true };
  }

  /** Clear an intentional-stop marker on manual startup so Protection recovery resumes. No-op if none/other mode. */
  function clearIntentionalStop(): void {
    const raw = deps.readFile(deps.controlPath());
    if (!raw) return;
    try {
      const c = JSON.parse(raw) as { mode?: string };
      if (c.mode === "intentional_stop") {
        deps.removeFile(deps.controlPath());
        deps.log("intentional_stop_cleared", {});
      }
    } catch {
      deps.removeFile(deps.controlPath()); // corrupt control.json → remove so it can't linger
      deps.log("intentional_stop_cleared_corrupt", {});
    }
  }

  return { getEffective, setEnabled, writeIntentionalStop, clearIntentionalStop };
}

export type ProtectionService = ReturnType<typeof createProtectionService>;

function safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}
function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
