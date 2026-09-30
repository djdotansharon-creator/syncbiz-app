/**
 * Phase B1 — VONO Protection service (MAIN, dependency-injected, no Electron/child_process imports here).
 *
 * Owns ONLY the Protection ON/OFF machine state + the "VONO Protection" Scheduled Task + the intentional-stop
 * marker. It NEVER touches deviceId / durable-device-id / StationDevice / branchId / workspace / MASTER-CONTROL /
 * WS registration / playback. All OS interaction (schtasks, provision script, Electron login-item, fs) is
 * injected via ProtectionDeps so the logic is unit-testable with fakes + temp dirs.
 *
 * State file: C:\ProgramData\VONO\state\protection.json  { schemaVersion, enabled, updatedAt, source }
 * Marker:     C:\ProgramData\VONO\state\control.json     (VonoControlState mode="intentional_stop")
 */
import type { VonoControlState } from "../shared/vono-runtime-state";

export const PROTECTION_SCHEMA_VERSION = 1;
export const VONO_PROTECTION_TASK_NAME = "VONO Protection";
/** Bounded safety expiry for an intentional-stop marker so a stale marker can never keep a branch dark. */
export const INTENTIONAL_STOP_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export type ProtectionSource = "installer" | "app" | "migration" | "admin";

export type ProtectionState = {
  schemaVersion: number;
  enabled: boolean;
  updatedAt: number;
  source: ProtectionSource;
};

/** What the renderer/UI needs: the effective state + capability + live task presence. */
export type EffectiveProtection = {
  enabled: boolean;
  /** false on non-Windows (the Scheduled Task mechanism is Windows-only). */
  supported: boolean;
  /** whether the "VONO Protection" Scheduled Task is currently present. */
  taskPresent: boolean;
  source: ProtectionSource | "default";
  /** set when the last transition failed; the effective state is the UNCHANGED prior state. */
  error?: string;
};

export type SetProtectionResult = { ok: boolean; state: EffectiveProtection };

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
  /** Defense-in-depth: turn OFF the legacy Electron openAtLogin so the Scheduled Task is the ONE start mechanism. */
  disableElectronAutostart: () => void;
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

  /**
   * Read the effective state. Migration when protection.json is absent:
   *   - existing "VONO Protection" task present → enabled=true (preserves the pilot Lenovo), persisted.
   *   - no task → enabled=false, persisted.
   */
  function getEffective(): EffectiveProtection {
    const supported = isWindows(deps);
    const taskPresent = supported ? safe(() => deps.taskExists(), false) : false;
    const existing = parseState(deps.readFile(deps.protectionStatePath()));
    if (existing) {
      return { enabled: existing.enabled, supported, taskPresent, source: existing.source };
    }
    // No persisted state → migrate from the presence of the legacy task.
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
    return { enabled: migrated.enabled, supported, taskPresent, source: "migration" };
  }

  /** Enable/disable Protection. Persists the new state ONLY after the task operation is verified to have
   *  succeeded; on failure the prior effective state is kept and returned with an error. */
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
      const res = deps.provision("install");
      if (!res.ok) {
        deps.log("protection_enable_provision_failed", { err: res.error });
        return { ok: false, state: { ...before, error: res.error || "Failed to install the Protection task." } };
      }
      if (!safe(() => deps.taskExists(), false)) {
        deps.log("protection_enable_task_missing_after_install", {});
        return { ok: false, state: { ...before, error: "Protection task did not register." } };
      }
      safe(() => deps.disableElectronAutostart(), undefined); // the Scheduled Task is the sole start mechanism
      persist({ schemaVersion: PROTECTION_SCHEMA_VERSION, enabled: true, updatedAt: deps.now(), source });
      deps.log("protection_enabled", { source });
      return { ok: true, state: { enabled: true, supported: true, taskPresent: true, source } };
    }

    // target === false
    const res = deps.provision("uninstall");
    if (!res.ok) {
      deps.log("protection_disable_provision_failed", { err: res.error });
      return { ok: false, state: { ...before, error: res.error || "Failed to remove the Protection task." } };
    }
    if (safe(() => deps.taskExists(), false)) {
      deps.log("protection_disable_task_still_present", {});
      return { ok: false, state: { ...before, error: "Protection task is still present after removal." } };
    }
    safe(() => deps.disableElectronAutostart(), undefined); // defense-in-depth (never auto-start when OFF)
    // NB: we intentionally do NOT kill the running VONO app or MPV — switching OFF leaves playback untouched.
    persist({ schemaVersion: PROTECTION_SCHEMA_VERSION, enabled: false, updatedAt: deps.now(), source });
    deps.log("protection_disabled", { source });
    return { ok: true, state: { enabled: false, supported: true, taskPresent: false, source } };
  }

  /** Write the intentional-stop marker (explicit "Exit VONO" while Protection ON). Bounded 7-day expiry. */
  function writeIntentionalStop(reason: string): void {
    const now = deps.now();
    const control: VonoControlState = {
      schemaVersion: PROTECTION_SCHEMA_VERSION,
      mode: "intentional_stop",
      reason: reason.slice(0, 200),
      source: "app",
      createdAt: now,
      expiresAt: now + INTENTIONAL_STOP_TTL_MS,
      bootId: null,
    };
    deps.writeFile(deps.controlPath(), JSON.stringify(control));
    deps.log("intentional_stop_written", { expiresAt: control.expiresAt });
  }

  /** Clear an intentional-stop marker on manual startup so Protection recovery resumes. No-op if none/other. */
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
      // Corrupt control.json → remove it so it can't linger.
      deps.removeFile(deps.controlPath());
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
