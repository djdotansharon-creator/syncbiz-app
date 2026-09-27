/**
 * VONO Watchdog — recovery EXECUTOR (PR-C).
 *
 * Turns a decided RecoveryAction into a real action against the VONO process. All OS interaction is
 * injected via `RecoveryDeps`, so the ladder/ordering/escalation logic is unit-testable with fakes
 * (no real spawn/kill). The observer supplies the real deps (spawn detached / taskkill / signal-0).
 *
 * Guarantees:
 *   - launch_app fires ONLY when no live VONO pid is detected (never creates a duplicate).
 *   - restart_app is strictly kill → confirm-dead → launch (never launches while the old pid lives).
 *   - graceful (non-force) kill first, then force (/F) only if still alive, then confirm before launch.
 *   - reload_renderer is RESERVED (no external channel exists) → logged no-op, never invents a signal.
 *   - No network. No playback-code interaction.
 */

import { WD, type RecoveryAction } from "./contract";

export interface RecoveryDeps {
  /** Validate execPath is safe to spawn: absolute, exists, regular file, allowlisted VONO basename.
   *  The executor refuses to launch/restart when this returns false — no arbitrary path is ever run. */
  isValidExe: (execPath: string) => boolean;
  /** Spawn a fresh detached VONO from execPath. Returns true if spawn was issued. */
  launch: (execPath: string) => boolean;
  /** Kill the process tree for pid. `force` = the /F (hard) variant. Returns true if the kill was issued. */
  killTree: (pid: number, force: boolean) => boolean;
  /** True if pid is still alive (signal-0 style probe). Used only to poll for exit AFTER identity is
   *  verified — NEVER as the sole basis for killing. */
  isAlive: (pid: number) => boolean;
  /** True ONLY if pid is alive AND its process image is an allowlisted VONO executable. This is the
   *  gate for any kill/skip decision, so a reused PID (now some other process) is never touched. */
  isVonoPid: (pid: number) => boolean;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  log: (line: string) => void;
}

export interface RecoveryContext {
  action: RecoveryAction;
  fromState: string;
  pid: number | null; // the VONO pid from the last heartbeat (may be gone)
  execPath: string | null; // resolved exe path to (re)launch
}

export interface RecoveryResult {
  action: RecoveryAction;
  ok: boolean;
  detail: string;
}

/** Graceful → force kill escalation. Returns true once the process is confirmed dead. */
export async function killWithEscalation(pid: number, deps: RecoveryDeps): Promise<boolean> {
  if (!deps.isAlive(pid)) return true; // already gone

  // 1) Non-force kill first (ask the process tree to terminate).
  deps.killTree(pid, false);
  const graceDeadline = deps.now() + WD.killGraceMs;
  while (deps.now() < graceDeadline) {
    await deps.sleep(WD.killPollMs);
    if (!deps.isAlive(pid)) return true;
  }

  // 2) Still alive → force kill (/F).
  deps.log(`[RECOVERY] pid ${pid} survived graceful kill after ${WD.killGraceMs}ms — escalating to force`);
  deps.killTree(pid, true);
  const forceDeadline = deps.now() + WD.killForceMs;
  while (deps.now() < forceDeadline) {
    await deps.sleep(WD.killPollMs);
    if (!deps.isAlive(pid)) return true;
  }
  return !deps.isAlive(pid);
}

/** Execute a decided recovery action. The caller must already have checked it is NOT suppressed. */
export async function executeRecovery(ctx: RecoveryContext, deps: RecoveryDeps): Promise<RecoveryResult> {
  const { action, pid, execPath } = ctx;

  if (action === "none" || action === "await_recovery") {
    return { action, ok: true, detail: "no-op" };
  }

  if (action === "reload_renderer") {
    // Reserved: there is no external channel to reload the renderer yet — never invent one.
    deps.log(`[RECOVERY] reload_renderer is RESERVED (no renderer-recovery channel) — no action taken`);
    return { action, ok: true, detail: "reserved-noop" };
  }

  if (action === "launch_app") {
    // Never create a duplicate: skip ONLY when the pid is a live VONO. A live-but-reused pid (some
    // other process) must NOT block a launch and must NEVER be killed.
    if (pid != null && deps.isVonoPid(pid)) {
      deps.log(`[RECOVERY] launch_app skipped — pid ${pid} is a live VONO (avoid duplicate)`);
      return { action, ok: false, detail: "skipped: live VONO" };
    }
    if (!execPath) {
      deps.log(`[RECOVERY] launch_app FAILED — no execPath resolved`);
      return { action, ok: false, detail: "no execPath" };
    }
    if (!deps.isValidExe(execPath)) {
      deps.log(`[RECOVERY] launch_app REJECTED — execPath failed validation (not launching)`);
      return { action, ok: false, detail: "execPath rejected" };
    }
    const ok = deps.launch(execPath);
    deps.log(`[RECOVERY] launch_app ${ok ? "issued" : "FAILED"} exe=${execPath}`);
    return { action, ok, detail: ok ? "launched" : "spawn failed" };
  }

  if (action === "restart_app") {
    if (!execPath) {
      deps.log(`[RECOVERY] restart_app FAILED — no execPath resolved`);
      return { action, ok: false, detail: "no execPath" };
    }
    // Validate BEFORE killing — never kill a running (hung) VONO if we can't safely relaunch it.
    if (!deps.isValidExe(execPath)) {
      deps.log(`[RECOVERY] restart_app REJECTED — execPath failed validation (NOT killing/relaunching)`);
      return { action, ok: false, detail: "execPath rejected" };
    }
    // Kill ONLY a VERIFIED live VONO (never a reused/foreign pid), graceful→force, confirm dead, THEN
    // launch. If the pid is not a live VONO (dead, or reused by another process), do NOT kill anything
    // — just launch a fresh VONO (single-instance lock covers any unknown live instance).
    if (pid != null && deps.isVonoPid(pid)) {
      const dead = await killWithEscalation(pid, deps);
      if (!dead) {
        deps.log(`[RECOVERY] restart_app ABORTED — VONO pid ${pid} would not die; NOT launching (no duplicate)`);
        return { action, ok: false, detail: "kill failed; launch aborted" };
      }
    } else if (pid != null) {
      deps.log(`[RECOVERY] restart_app — pid ${pid} is NOT a live VONO (stale/reused) — NOT killing; launching fresh`);
    }
    const ok = deps.launch(execPath);
    deps.log(`[RECOVERY] restart_app ${ok ? "issued" : "FAILED"} (killed pid=${pid ?? "?"}) exe=${execPath}`);
    return { action, ok, detail: ok ? "restarted" : "spawn failed" };
  }

  return { action, ok: false, detail: "unknown action" };
}
