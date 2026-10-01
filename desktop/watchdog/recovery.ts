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
  /** Spawn a fresh detached VONO from execPath. Resolves true only when the process actually spawned;
   *  false on spawn error (the impl attaches an error handler so a failed spawn never crashes). */
  launch: (execPath: string) => boolean | Promise<boolean>;
  /** Kill the process tree for pid. `force` = the /F (hard) variant. Returns true if the kill was issued. */
  killTree: (pid: number, force: boolean) => boolean;
  /** True if pid is still alive (signal-0 style probe). Used only to poll for exit AFTER identity is
   *  verified — NEVER as the sole basis for killing. */
  isAlive: (pid: number) => boolean;
  /** True ONLY if pid is alive AND its process image is an allowlisted VONO executable. This is the
   *  gate for any kill/skip decision, so a reused PID (now some other process) is never touched. */
  isVonoPid: (pid: number) => boolean;
  /**
   * PR-D — re-read the CURRENT heartbeat and report whether THIS pid's own VONO is genuinely HEALTHY again
   * (fresh heartbeat written by exactly `pid`, engine ready, and — if it intends to play — not stalled).
   * Used to ABORT an in-flight restart when the app recovers during the kill sequence. Must tie to the
   * same pid (never abort on a different/reused instance's heartbeat), and must NOT change any threshold.
   */
  isAppHealthy: (pid: number) => boolean;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  log: (line: string) => void;
}

/**
 * Outcome of killWithEscalation:
 *  - "dead"            — our VONO is no longer at this pid (exited or the pid is now foreign) → safe to launch.
 *  - "alive"           — a live VONO is STILL here after force → caller aborts the launch (no duplicate).
 *  - "aborted_healthy" — the SAME VONO recovered to HEALTHY during the wait → abort: do NOT force-kill,
 *                        do NOT launch. This is NOT "pid died" and must never fall through to relaunch.
 */
export type KillOutcome = "dead" | "alive" | "aborted_healthy";

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

/**
 * Graceful → force kill escalation, with an IDENTITY RE-CHECK before every kill and on every poll
 * (TOCTOU / PID-reuse safety). We only ever kill a pid that is, AT THAT MOMENT, a live VONO. If the
 * pid stops being a live VONO — it exited, or (Windows PID reuse) now belongs to another process — we
 * stop immediately and never issue another kill. Returns true when OUR VONO is no longer at this pid
 * (exited or the pid is now foreign), false only if a live VONO is still there after force.
 */
export async function killWithEscalation(pid: number, deps: RecoveryDeps): Promise<KillOutcome> {
  // Re-verify RIGHT BEFORE the graceful kill (identity may have changed since decide()).
  if (!deps.isVonoPid(pid)) {
    deps.log(`[RECOVERY] pid ${pid} is not a live VONO at kill time — NOT killing`);
    return "dead"; // our VONO isn't here (dead or reused) → safe to proceed / launch fresh
  }

  // 1) Non-force kill first (ask the process tree to terminate).
  deps.killTree(pid, false);
  const graceDeadline = deps.now() + WD.killGraceMs;
  while (deps.now() < graceDeadline) {
    await deps.sleep(WD.killPollMs);
    if (!deps.isAlive(pid)) return "dead"; // exited
    // Alive but identity changed ⇒ our VONO died and the PID was reused ⇒ do NOT force-kill a stranger.
    if (!deps.isVonoPid(pid)) {
      deps.log(`[RECOVERY] pid ${pid} alive but no longer VONO (PID reused) — NOT force-killing`);
      return "dead";
    }
    // PR-D — the SAME VONO recovered to HEALTHY during the graceful wait ⇒ ABORT: do not force-kill it.
    if (deps.isAppHealthy(pid)) {
      deps.log(`[RECOVERY] pid ${pid} recovered HEALTHY during graceful wait — ABORTING restart (no force-kill)`);
      return "aborted_healthy";
    }
  }

  // 2) Still a live VONO → re-verify IMMEDIATELY before force, then force (/F).
  if (!deps.isVonoPid(pid)) {
    deps.log(`[RECOVERY] pid ${pid} no longer VONO just before force — NOT force-killing`);
    return "dead";
  }
  // PR-D — final health re-check immediately before force-kill: a healthy VONO must never be force-killed.
  if (deps.isAppHealthy(pid)) {
    deps.log(`[RECOVERY] pid ${pid} is HEALTHY just before force — ABORTING restart (no force-kill)`);
    return "aborted_healthy";
  }
  deps.log(`[RECOVERY] pid ${pid} survived graceful kill after ${WD.killGraceMs}ms — escalating to force`);
  deps.killTree(pid, true);
  const forceDeadline = deps.now() + WD.killForceMs;
  while (deps.now() < forceDeadline) {
    await deps.sleep(WD.killPollMs);
    if (!deps.isAlive(pid)) return "dead"; // exited
    if (!deps.isVonoPid(pid)) {
      deps.log(`[RECOVERY] pid ${pid} alive but no longer VONO during force — stopping`);
      return "dead";
    }
  }
  // A live VONO is still here after force ⇒ report "alive" (caller aborts the launch — no duplicate).
  return deps.isVonoPid(pid) ? "alive" : "dead";
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
    const ok = await deps.launch(execPath);
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
      const outcome = await killWithEscalation(pid, deps);
      if (outcome === "aborted_healthy") {
        // PR-D — the app recovered HEALTHY during the kill sequence. This is a SUCCESSFUL no-op: do NOT
        // force-kill, do NOT launch (no duplicate). Distinct from "kill failed" — the app is fine.
        deps.log(`[RECOVERY] restart_app ABORTED — VONO pid ${pid} recovered HEALTHY during recovery; NOT force-killing or relaunching`);
        return { action, ok: true, detail: "aborted: app recovered healthy" };
      }
      if (outcome === "alive") {
        deps.log(`[RECOVERY] restart_app ABORTED — VONO pid ${pid} would not die; NOT launching (no duplicate)`);
        return { action, ok: false, detail: "kill failed; launch aborted" };
      }
      // outcome === "dead" → our VONO is gone → safe to launch a fresh instance below.
    } else if (pid != null) {
      deps.log(`[RECOVERY] restart_app — pid ${pid} is NOT a live VONO (stale/reused) — NOT killing; launching fresh`);
    }
    const ok = await deps.launch(execPath);
    deps.log(`[RECOVERY] restart_app ${ok ? "issued" : "FAILED"} (killed pid=${pid ?? "?"}) exe=${execPath}`);
    return { action, ok, detail: ok ? "restarted" : "spawn failed" };
  }

  return { action, ok: false, detail: "unknown action" };
}
