/**
 * Phase B1 — VONO Protection service (MAIN, dependency-injected, no Electron/child_process imports here).
 *
 * Owns ONLY the Protection ON/OFF machine state + the "VONO Protection" Scheduled Task + the intentional-stop
 * marker. It NEVER touches deviceId / durable-device-id / StationDevice / branchId / workspace / MASTER-CONTROL /
 * WS registration / playback. All OS interaction is injected via ProtectionDeps so the logic is unit-testable.
 *
 * Fail-CLOSED throughout: task status is a tri-state (present / absent / unknown) and a query failure never
 * collapses to a successful transition, a false migration, or a silent Exit.
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

/** Tri-state Scheduled Task probe: present, absent, or query-failed (unknown). */
export type TaskStatus = { ok: true; present: boolean } | { ok: false; error: string };

/** Drift between the persisted desired state and the live Scheduled Task (incl. unknown). */
export type ProtectionDrift = "none" | "task_missing" | "task_unexpected" | "task_unknown";

export type EffectiveProtection = {
  /** persisted desired state. */
  enabled: boolean;
  /** false on non-Windows (the Scheduled Task mechanism is Windows-only). */
  supported: boolean;
  /** true/false = live task presence; null = the task status could not be determined. */
  taskPresent: boolean | null;
  source: ProtectionSource | "default";
  drift: ProtectionDrift;
  /** true only when supported AND no drift AND task status known. */
  healthy: boolean;
  error?: string;
};

export type SetProtectionResult = { ok: boolean; state: EffectiveProtection };
export type ExitDecision = { ok: boolean; error?: string };
export type ClearResult = { ok: boolean; hadMarker: boolean; error?: string };

export interface ProtectionDeps {
  now: () => number;
  platform: NodeJS.Platform;
  readFile: (path: string) => string | null;
  writeFile: (path: string, data: string) => void;
  removeFile: (path: string) => void;
  protectionStatePath: () => string;
  controlPath: () => string;
  /** Tri-state probe for the "VONO Protection" Scheduled Task (never fail-open). */
  taskStatus: () => TaskStatus;
  /** Are node.exe / watchdog.cjs / launch-watchdog.ps1 / provision-vono-protection.ps1 present in InstallDir? */
  requiredWatchdogFilesPresent: () => boolean;
  /** Run provision-vono-protection.ps1 -Action install|uninstall. */
  provision: (action: "install" | "uninstall") => { ok: boolean; error?: string };
  /** Turn OFF legacy Electron openAtLogin AND VERIFY it (set fail, verify-read fail, or still-on ⇒ ok:false). */
  disableElectronAutostart: () => { ok: boolean; error?: string };
  log: (event: string, fields?: Record<string, unknown>) => void;
}

function isWindows(deps: ProtectionDeps): boolean {
  return deps.platform === "win32";
}
function safeTaskStatus(deps: ProtectionDeps): TaskStatus {
  try { return deps.taskStatus(); } catch (e) { return { ok: false, error: errMsg(e) }; }
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

  function driftFor(enabled: boolean, supported: boolean, taskPresent: boolean | null): { drift: ProtectionDrift; error?: string } {
    if (!supported) return { drift: "none" };
    if (taskPresent === null) return { drift: "task_unknown", error: "Protection status could not be determined." };
    if (enabled && !taskPresent) return { drift: "task_missing", error: "Protection is enabled but the watchdog task is missing." };
    if (!enabled && taskPresent) return { drift: "task_unexpected", error: "Protection is off but the watchdog task is still active." };
    return { drift: "none" };
  }

  function effective(enabled: boolean, source: ProtectionState["source"] | "default", supported: boolean, taskPresent: boolean | null, overrideError?: string): EffectiveProtection {
    const { drift, error } = driftFor(enabled, supported, taskPresent);
    return { enabled, supported, taskPresent, source, drift, healthy: supported && drift === "none", error: overrideError ?? error };
  }

  /**
   * Read effective state (diagnostic; never provisions). Migration when protection.json is absent: existing task
   * ⇒ ON (preserves the pilot Lenovo), no task ⇒ OFF — but ONLY when the task status is KNOWN. If the status is
   * unknown, do NOT persist a migration and return an unhealthy task_unknown state.
   */
  function getEffective(): EffectiveProtection {
    const supported = isWindows(deps);
    const ts: TaskStatus = supported ? safeTaskStatus(deps) : { ok: true, present: false };
    const taskPresent: boolean | null = ts.ok ? ts.present : null;
    const existing = parseState(deps.readFile(deps.protectionStatePath()));
    if (existing) {
      return effective(existing.enabled, existing.source, supported, taskPresent);
    }
    if (!ts.ok) {
      // Unknown task status + no persisted state → do NOT persist a (possibly wrong) migration.
      deps.log("protection_migrate_skipped_unknown_task", { err: ts.error });
      return effective(false, "default", supported, null);
    }
    const migrated: ProtectionState = { schemaVersion: PROTECTION_SCHEMA_VERSION, enabled: ts.present, updatedAt: deps.now(), source: "migration" };
    try {
      persist(migrated);
      deps.log("protection_migrated", { enabled: migrated.enabled });
    } catch (e) {
      deps.log("protection_migrate_persist_failed", { err: errMsg(e) });
    }
    return effective(migrated.enabled, "migration", supported, ts.present);
  }

  /**
   * Enable/disable. openAtLogin is disabled+verified FIRST (abort before touching the task on failure), then the
   * task op, then a REQUIRED tri-state verify (unknown ⇒ fail — never substitute the desired state), then persist.
   * Failure keeps the prior persisted state + returns an error. Never kills VONO/MPV.
   */
  function setEnabled(target: boolean, source: ProtectionSource = "app"): SetProtectionResult {
    const before = getEffective();
    if (!before.supported) return { ok: false, state: { ...before, error: "Protection is only supported on Windows." } };
    if (target && !deps.requiredWatchdogFilesPresent()) {
      deps.log("protection_enable_missing_files", {});
      return { ok: false, state: { ...before, error: "Watchdog files are missing from the install; cannot enable Protection." } };
    }

    const da = safe(() => deps.disableElectronAutostart(), { ok: false, error: "Failed to disable OS auto-start." });
    if (!da.ok) {
      deps.log("protection_autostart_disable_failed", { target, err: da.error });
      return { ok: false, state: { ...before, error: da.error || "Could not disable the OS auto-start entry." } };
    }

    const action = target ? "install" : "uninstall";
    const res = deps.provision(action);
    if (!res.ok) {
      deps.log("protection_provision_failed", { action, err: res.error });
      return { ok: false, state: { ...before, error: res.error || `Failed to ${action} the Protection task.` } };
    }

    const ts = safeTaskStatus(deps);
    if (!ts.ok) {
      deps.log("protection_verify_unknown", { action, err: ts.error });
      return { ok: false, state: { ...before, error: `Could not verify the Protection task after ${action}.` } };
    }
    if (target && !ts.present) {
      deps.log("protection_enable_task_missing_after_install", {});
      return { ok: false, state: { ...before, error: "Protection task did not register." } };
    }
    if (!target && ts.present) {
      deps.log("protection_disable_task_still_present", {});
      return { ok: false, state: { ...before, error: "Protection task is still present after removal." } };
    }

    persist({ schemaVersion: PROTECTION_SCHEMA_VERSION, enabled: target, updatedAt: deps.now(), source });
    deps.log(target ? "protection_enabled" : "protection_disabled", { source });
    return { ok: true, state: effective(target, source, true, ts.present) };
  }

  /** Is a persistent intentional-stop marker currently on disk? (startup defense-in-depth). */
  function isIntentionalStopActive(): boolean {
    const raw = deps.readFile(deps.controlPath());
    if (!raw) return false;
    try {
      return (JSON.parse(raw) as { mode?: string }).mode === "intentional_stop";
    } catch {
      return false; // corrupt → not a valid active stop (manual clear will remove it)
    }
  }

  /** Write + verify the PERSISTENT intentional-stop marker (expiresAt=null → never times out). */
  function writeIntentionalStop(reason: string): ExitDecision {
    const control: VonoControlState = {
      schemaVersion: PROTECTION_SCHEMA_VERSION,
      mode: "intentional_stop",
      reason: reason.slice(0, 200),
      source: "app",
      createdAt: deps.now(),
      expiresAt: null,
      bootId: null,
    };
    try {
      deps.writeFile(deps.controlPath(), JSON.stringify(control));
    } catch (e) {
      deps.log("intentional_stop_write_failed", { err: errMsg(e) });
      return { ok: false, error: "Could not write the Exit marker; VONO was not stopped to avoid an auto-restart." };
    }
    try {
      const back = JSON.parse(deps.readFile(deps.controlPath()) ?? "null") as { mode?: string } | null;
      if (back?.mode !== "intentional_stop") return { ok: false, error: "Exit marker verification failed; VONO was not stopped." };
    } catch {
      return { ok: false, error: "Exit marker verification failed; VONO was not stopped." };
    }
    deps.log("intentional_stop_written", {});
    return { ok: true };
  }

  /**
   * Decide + perform an explicit "Exit VONO" using LIVE recovery risk (not just persisted enabled). A stop marker
   * is required when Protection is desired ON OR a live task is present. If the task status is UNKNOWN → do NOT
   * quit (fail closed). Returns { ok:true } only when it is safe to quit.
   */
  function requestExit(): ExitDecision {
    const supported = isWindows(deps);
    if (!supported) return { ok: true }; // no watchdog task off-Windows
    const ts = safeTaskStatus(deps);
    if (!ts.ok) {
      deps.log("exit_blocked_task_unknown", { err: ts.error });
      return { ok: false, error: "Protection status could not be determined; VONO was not stopped." };
    }
    const existing = parseState(deps.readFile(deps.protectionStatePath()));
    const desiredEnabled = existing?.enabled ?? ts.present; // no state → migration semantics
    const markerRequired = desiredEnabled === true || ts.present === true;
    if (markerRequired) {
      const w = writeIntentionalStop("explicit user exit (Exit VONO)");
      if (!w.ok) return w;
    }
    return { ok: true };
  }

  /**
   * Clear an intentional-stop marker on manual startup, VERIFIED. Returns hadMarker + ok. Maintenance markers are
   * left intact. If removal cannot be verified, ok:false (caller should refuse normal protected runtime).
   */
  function clearIntentionalStop(): ClearResult {
    const raw = deps.readFile(deps.controlPath());
    if (!raw) return { ok: true, hadMarker: false };
    let mode: string | undefined;
    try { mode = (JSON.parse(raw) as { mode?: string }).mode; } catch { mode = "__corrupt__"; }
    if (mode === "maintenance") return { ok: true, hadMarker: false }; // not our marker — leave it
    // intentional_stop or corrupt → remove + verify.
    try { deps.removeFile(deps.controlPath()); } catch (e) {
      return { ok: false, hadMarker: true, error: errMsg(e) };
    }
    if (deps.readFile(deps.controlPath()) !== null) {
      deps.log("intentional_stop_clear_unverified", {});
      return { ok: false, hadMarker: true, error: "Could not remove the Exit marker." };
    }
    deps.log("intentional_stop_cleared", {});
    return { ok: true, hadMarker: true };
  }

  return { getEffective, setEnabled, writeIntentionalStop, clearIntentionalStop, isIntentionalStopActive, requestExit };
}

export type ProtectionService = ReturnType<typeof createProtectionService>;

function safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}
function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
