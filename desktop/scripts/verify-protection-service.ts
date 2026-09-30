/**
 * Phase B1 regression — VONO Protection service (protection-service.ts) with injected fakes + temp state.
 * No real Scheduled Task, no Electron, no network. Plus watchdog control-suppression semantics + static guards.
 *
 * Covers PR #45 round-2 safety blockers:
 *   B1 watchdog↔Exit race (startup gate + observer execution-time recheck — static)
 *   B2 SET fail-closed on task-status unknown (never substitute the desired target)
 *   B3 GET/migration must not treat query failure as absent (taskPresent null / drift task_unknown)
 *   B4 EXIT uses LIVE recovery risk (requestExit) not just persisted enabled
 *   B5 autostart verify fail-closed (static guard on the real dep)
 *   B6 verified clearIntentionalStop() → { ok, hadMarker, error }
 *   Log cleanup: deriveState reason for intentional_stop
 *
 * Run: npx tsx desktop/scripts/verify-protection-service.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createProtectionService, type ProtectionDeps, type TaskStatus } from "../src/main/protection-service";
import { isMaintenanceActive } from "../watchdog/state-machine";
import type { VonoControlState } from "../src/shared/vono-runtime-state";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const NOW = 1_700_000_000_000;
const P = "state/protection.json";
const C = "state/control.json";

type Overrides = {
  platform?: NodeJS.Platform;
  taskPresent?: boolean;
  taskUnknown?: boolean; // taskStatus() → { ok:false } (query failed)
  taskThrows?: boolean;  // taskStatus() throws
  filesPresent?: boolean;
  autostartOk?: boolean;
  removeFails?: boolean;     // removeFile is a no-op so the verify read still sees the marker
  renameFails?: boolean;     // renameFile throws (atomic control.json write can't complete)
  writeFailPath?: string;    // writeFile throws for this exact path (simulate a persist failure)
  provision?: (action: "install" | "uninstall", state: { taskPresent: boolean }) => { ok: boolean; error?: string };
};
function harness(o: Overrides = {}) {
  const files = new Map<string, string>();
  const state = { taskPresent: o.taskPresent ?? false };
  const calls = { provision: [] as string[], disableAutostart: 0 };
  const deps: ProtectionDeps = {
    now: () => NOW,
    platform: o.platform ?? "win32",
    readFile: (p) => (files.has(p) ? files.get(p)! : null),
    writeFile: (p, d) => { if (o.writeFailPath && p === o.writeFailPath) throw new Error("write failed"); files.set(p, d); },
    removeFile: (p) => { if (!o.removeFails) files.delete(p); },
    renameFile: (from, to) => { if (o.renameFails) throw new Error("rename failed"); if (files.has(from)) { files.set(to, files.get(from)!); files.delete(from); } },
    protectionStatePath: () => P,
    controlPath: () => C,
    taskStatus: (): TaskStatus => {
      if (o.taskThrows) throw new Error("task query crashed");
      if (o.taskUnknown) return { ok: false, error: "task query failed" };
      return { ok: true, present: state.taskPresent };
    },
    requiredWatchdogFilesPresent: () => o.filesPresent ?? true,
    provision: (action) => {
      calls.provision.push(action);
      if (o.provision) return o.provision(action, state);
      state.taskPresent = action === "install";
      return { ok: true };
    },
    disableElectronAutostart: () => {
      calls.disableAutostart++;
      return o.autostartOk === false ? { ok: false, error: "openAtLogin still on" } : { ok: true };
    },
    log: () => {},
  };
  return { svc: createProtectionService(deps), files, state, calls };
}
const readState = (files: Map<string, string>) => (files.has(P) ? JSON.parse(files.get(P)!) : null);

// ── Migration / persistence ─────────────────────────────────────────────────────────────────────────────────
{
  const h = harness({ taskPresent: false });
  const eff = h.svc.getEffective();
  assert("1. no state + no task → OFF, healthy", !eff.enabled && eff.supported && eff.taskPresent === false && eff.healthy && eff.drift === "none");
  assert("1. migration persisted enabled=false", readState(h.files)?.enabled === false && readState(h.files)?.source === "migration");
}
{
  const h = harness({ taskPresent: true });
  const eff = h.svc.getEffective();
  assert("2. no state + existing task → migrate ON, healthy", eff.enabled && eff.taskPresent === true && eff.healthy);
  assert("2. migration persisted enabled=true", readState(h.files)?.enabled === true);
}
{
  const h = harness({ taskPresent: true });
  h.files.set(P, JSON.stringify({ schemaVersion: 1, enabled: true, updatedAt: 1, source: "app" }));
  assert("3. persisted ON survives read", h.svc.getEffective().enabled === true);
  const h2 = harness({ taskPresent: false });
  h2.files.set(P, JSON.stringify({ schemaVersion: 1, enabled: false, updatedAt: 1, source: "app" }));
  assert("4. persisted OFF survives read", h2.svc.getEffective().enabled === false);
}

// ── B3: task status UNKNOWN must NOT be treated as absent ─────────────────────────────────────────────────────
{
  const h = harness({ taskUnknown: true });
  const eff = h.svc.getEffective();
  assert("B3.1 no state + task UNKNOWN → taskPresent null, drift task_unknown, not healthy, error",
    eff.taskPresent === null && eff.drift === "task_unknown" && !eff.healthy && !!eff.error);
  assert("B3.1 UNKNOWN migration NOT persisted (no false OFF)", readState(h.files) === null);
}
{
  const h = harness({ taskThrows: true });
  const eff = h.svc.getEffective();
  assert("B3.2 taskStatus throwing is caught → task_unknown, not persisted",
    eff.taskPresent === null && eff.drift === "task_unknown" && readState(h.files) === null);
}
{
  const h = harness({ taskUnknown: true });
  h.files.set(P, JSON.stringify({ schemaVersion: 1, enabled: true, updatedAt: 1, source: "app" }));
  const eff = h.svc.getEffective();
  assert("B3.3 existing ON + task UNKNOWN → drift task_unknown, taskPresent null, not healthy",
    eff.enabled && eff.taskPresent === null && eff.drift === "task_unknown" && !eff.healthy);
}

// ── OFF → ON / ON → OFF ───────────────────────────────────────────────────────────────────────────────────────
{
  const h = harness({ taskPresent: false });
  const res = h.svc.setEnabled(true);
  assert("5. OFF→ON ok, healthy", res.ok && res.state.enabled && res.state.taskPresent === true && res.state.healthy);
  assert("5. provision install called + autostart disabled", h.calls.provision.includes("install") && h.calls.disableAutostart === 1);
  assert("5. persisted ON", readState(h.files)?.enabled === true);
}
{
  const h = harness({ taskPresent: false, provision: () => ({ ok: false, error: "provision failed" }) });
  const res = h.svc.setEnabled(true);
  assert("6. failed ON provisioning → not ok, stays OFF", !res.ok && !res.state.enabled && !!res.state.error);
  assert("6. no false ON persisted", readState(h.files)?.enabled !== true);
}
{
  const h = harness({ taskPresent: false, filesPresent: false });
  const res = h.svc.setEnabled(true);
  assert("6b. missing watchdog files → not ON, no provision", !res.ok && !res.state.enabled && h.calls.provision.length === 0);
}
{
  const h = harness({ taskPresent: true });
  const res = h.svc.setEnabled(false);
  assert("7. ON→OFF ok", res.ok && !res.state.enabled && res.state.taskPresent === false && res.state.healthy);
  assert("7. provision uninstall called + autostart disabled", h.calls.provision.includes("uninstall") && h.calls.disableAutostart === 1);
}
{
  const h = harness({ taskPresent: true, provision: () => ({ ok: true }) }); // uninstall "succeeds" but task remains
  const res = h.svc.setEnabled(false);
  assert("8. failed OFF (task still present) → not ok, stays ON", !res.ok && res.state.enabled && !!res.state.error);
}

// ── B2: SET must fail-CLOSED on task-status verification failure (never substitute the desired target) ────────
{
  const h = harness({ taskPresent: false, provision: (a, s) => { s.taskPresent = a === "install"; return { ok: true }; } });
  // Force the post-provision verify to be UNKNOWN by swapping in a service whose taskStatus fails after install.
  let installed = false;
  const svc = createProtectionService({
    now: () => NOW, platform: "win32",
    readFile: (p) => (p === P && installed ? null : null), writeFile: () => {}, removeFile: () => {}, renameFile: () => {},
    protectionStatePath: () => P, controlPath: () => C,
    taskStatus: () => ({ ok: false, error: "verify failed" }),
    requiredWatchdogFilesPresent: () => true,
    provision: () => { installed = true; return { ok: true }; },
    disableElectronAutostart: () => ({ ok: true }), log: () => {},
  });
  void h;
  const res = svc.setEnabled(true);
  assert("B2.1 SET ON + verify UNKNOWN → transition FAILS (no substituted ON)", !res.ok && !res.state.enabled && !!res.state.error);
}
{
  // provision install "succeeds" but the task never actually registers (present stays false)
  const h = harness({ taskPresent: false, provision: () => ({ ok: true }) });
  const res = h.svc.setEnabled(true);
  assert("B2.2 SET ON + task still absent after install → FAILS", !res.ok && !res.state.enabled);
}
{
  // SET OFF but the post-uninstall status is UNKNOWN → must NOT report OFF/manual-mode
  let uninstalled = false;
  const svc = createProtectionService({
    now: () => NOW, platform: "win32",
    readFile: (p) => (p === P ? JSON.stringify({ schemaVersion: 1, enabled: true, updatedAt: 1, source: "app" }) : null),
    writeFile: () => {}, removeFile: () => {}, renameFile: () => {},
    protectionStatePath: () => P, controlPath: () => C,
    taskStatus: () => (uninstalled ? { ok: false, error: "verify failed" } : { ok: true, present: true }),
    requiredWatchdogFilesPresent: () => true,
    provision: () => { uninstalled = true; return { ok: true }; },
    disableElectronAutostart: () => ({ ok: true }), log: () => {},
  });
  const res = svc.setEnabled(false);
  assert("B2.3 SET OFF + verify UNKNOWN → FAILS, stays ON", !res.ok && res.state.enabled === true && !!res.state.error);
}

// ── autostart abort (before provisioning) ─────────────────────────────────────────────────────────────────────
{
  const h = harness({ taskPresent: false, autostartOk: false });
  const res = h.svc.setEnabled(true);
  assert("9. ON aborts if openAtLogin can't be disabled (before provisioning)", !res.ok && !res.state.enabled && h.calls.provision.length === 0);
  const h2 = harness({ taskPresent: true, autostartOk: false });
  const res2 = h2.svc.setEnabled(false);
  assert("9b. OFF never reports manual-mode while openAtLogin stays on", !res2.ok && res2.state.enabled === true && h2.calls.provision.length === 0);
}

// ── Non-Windows ──────────────────────────────────────────────────────────────────────────────────────────────
{
  const h = harness({ platform: "darwin" });
  assert("10. non-Windows supported=false", h.svc.getEffective().supported === false);
  assert("10. non-Windows setEnabled rejected", !h.svc.setEnabled(true).ok);
  assert("10. non-Windows requestExit ok (no watchdog task)", h.svc.requestExit().ok);
}

// ── persistent intentional_stop, verified write ──────────────────────────────────────────────────────────────
{
  const h = harness({ taskPresent: true });
  h.files.set(P, JSON.stringify({ schemaVersion: 1, enabled: true, updatedAt: 1, source: "app" }));
  const res = h.svc.writeIntentionalStop("explicit user exit");
  assert("11. writeIntentionalStop ok", res.ok);
  const control = JSON.parse(h.files.get(C)!) as VonoControlState;
  assert("11. mode=intentional_stop, source=app", control.mode === "intentional_stop" && control.source === "app");
  assert("11. expiresAt is null (PERSISTENT — no 7-day timer)", control.expiresAt === null);
  assert("11. Exit does not mutate protection.enabled", readState(h.files)?.enabled === true);
}
{
  // verified-write failure → ok:false (caller must NOT quit)
  const svc = createProtectionService({
    now: () => NOW, platform: "win32",
    readFile: () => null, writeFile: () => { /* dropped */ }, removeFile: () => {}, renameFile: (f, t) => { void f; void t; },
    protectionStatePath: () => P, controlPath: () => C,
    taskStatus: () => ({ ok: true, present: true }), requiredWatchdogFilesPresent: () => true,
    provision: () => ({ ok: true }), disableElectronAutostart: () => ({ ok: true }), log: () => {},
  });
  const res = svc.writeIntentionalStop("x");
  assert("11b. marker write that doesn't persist → ok:false (do NOT quit)", !res.ok && !!res.error);
}

// ── B4: requestExit uses LIVE risk (desired enabled OR live task present) ─────────────────────────────────────
{
  const h = harness({ taskPresent: true });
  h.files.set(P, JSON.stringify({ schemaVersion: 1, enabled: true, updatedAt: 1, source: "app" }));
  const res = h.svc.requestExit();
  assert("B4.1 ON + task present → marker written, ok", res.ok && h.files.has(C) && (JSON.parse(h.files.get(C)!) as VonoControlState).mode === "intentional_stop");
}
{
  const h = harness({ taskPresent: true });
  h.files.set(P, JSON.stringify({ schemaVersion: 1, enabled: false, updatedAt: 1, source: "app" }));
  const res = h.svc.requestExit();
  assert("B4.2 OFF but live task present (drift) → marker STILL written, ok", res.ok && h.files.has(C));
}
{
  const h = harness({ taskPresent: false });
  h.files.set(P, JSON.stringify({ schemaVersion: 1, enabled: true, updatedAt: 1, source: "app" }));
  const res = h.svc.requestExit();
  assert("B4.3 ON + task missing → marker acceptable, ok", res.ok && h.files.has(C));
}
{
  const h = harness({ taskPresent: false });
  h.files.set(P, JSON.stringify({ schemaVersion: 1, enabled: false, updatedAt: 1, source: "app" }));
  const res = h.svc.requestExit();
  assert("B4.4 OFF + task absent → NO marker, ok (clean quit)", res.ok && !h.files.has(C));
}
{
  const h = harness({ taskUnknown: true });
  h.files.set(P, JSON.stringify({ schemaVersion: 1, enabled: true, updatedAt: 1, source: "app" }));
  const res = h.svc.requestExit();
  assert("B4.5 task status UNKNOWN → do NOT quit (ok:false), NO marker", !res.ok && !!res.error && !h.files.has(C));
}
{
  // required marker write fails → requestExit fails (do not quit)
  const svc = createProtectionService({
    now: () => NOW, platform: "win32",
    readFile: (p) => (p === P ? JSON.stringify({ schemaVersion: 1, enabled: true, updatedAt: 1, source: "app" }) : null),
    writeFile: () => { /* dropped */ }, removeFile: () => {}, renameFile: () => {},
    protectionStatePath: () => P, controlPath: () => C,
    taskStatus: () => ({ ok: true, present: true }), requiredWatchdogFilesPresent: () => true,
    provision: () => ({ ok: true }), disableElectronAutostart: () => ({ ok: true }), log: () => {},
  });
  assert("B4.6 required marker write fails → requestExit ok:false", !svc.requestExit().ok);
}

// ── Watchdog control-suppression semantics ───────────────────────────────────────────────────────────────────
{
  const stop: VonoControlState = { schemaVersion: 1, mode: "intentional_stop", reason: "exit", source: "app", createdAt: NOW, expiresAt: null, bootId: null };
  assert("intentional_stop active now", isMaintenanceActive(stop, NOW));
  assert("intentional_stop active after 30 days", isMaintenanceActive(stop, NOW + 30 * 86_400_000));
  assert("intentional_stop active at arbitrary far future", isMaintenanceActive(stop, NOW + 3650 * 86_400_000));
  const maint: VonoControlState = { schemaVersion: 1, mode: "maintenance", reason: "upgrade", source: "installer", createdAt: NOW, expiresAt: NOW + 60_000, bootId: null };
  assert("maintenance active before expiry", isMaintenanceActive(maint, NOW + 30_000));
  assert("maintenance INACTIVE after expiry (bounded)", !isMaintenanceActive(maint, NOW + 120_000));
  const none: VonoControlState = { schemaVersion: 1, mode: "none", reason: "", source: "app", createdAt: NOW, expiresAt: null, bootId: null };
  assert("mode none inactive", !isMaintenanceActive(none, NOW));
  assert("null control inactive", !isMaintenanceActive(null, NOW));
}

// ── isIntentionalStopActive (startup gate helper) ────────────────────────────────────────────────────────────
{
  const h = harness();
  assert("isIntentionalStopActive false when no marker", !h.svc.isIntentionalStopActive());
  h.files.set(C, JSON.stringify({ mode: "intentional_stop", schemaVersion: 1 }));
  assert("isIntentionalStopActive true for intentional_stop", h.svc.isIntentionalStopActive());
  h.files.set(C, JSON.stringify({ mode: "maintenance", schemaVersion: 1 }));
  assert("isIntentionalStopActive false for maintenance marker", !h.svc.isIntentionalStopActive());
  h.files.set(C, "{ not json");
  assert("isIntentionalStopActive false for corrupt marker", !h.svc.isIntentionalStopActive());
}

// ── B6: VERIFIED clearIntentionalStop → { ok, hadMarker, error } ──────────────────────────────────────────────
{
  const h = harness();
  h.files.set(C, JSON.stringify({ mode: "intentional_stop", schemaVersion: 1 }));
  const r = h.svc.clearIntentionalStop();
  assert("B6.1 clears intentional_stop → ok + hadMarker, file gone", r.ok && r.hadMarker && !h.files.has(C));
}
{
  const h = harness();
  h.files.set(C, JSON.stringify({ mode: "maintenance", schemaVersion: 1 }));
  const r = h.svc.clearIntentionalStop();
  assert("B6.2 maintenance marker left intact → ok, hadMarker=false", r.ok && !r.hadMarker && h.files.has(C));
}
{
  const h = harness();
  const r = h.svc.clearIntentionalStop();
  assert("B6.3 no marker → ok, hadMarker=false", r.ok && !r.hadMarker);
}
{
  const h = harness({ removeFails: true });
  h.files.set(C, JSON.stringify({ mode: "intentional_stop", schemaVersion: 1 }));
  const r = h.svc.clearIntentionalStop();
  assert("B6.4 removal not verified (still present) → ok:false + hadMarker + error", !r.ok && r.hadMarker && !!r.error);
}
{
  const h = harness();
  h.files.set(C, "{ corrupt json");
  const r = h.svc.clearIntentionalStop();
  assert("B6.5 corrupt marker removed + verified → ok, hadMarker", r.ok && r.hadMarker && !h.files.has(C));
}
{
  const h = harness({ taskPresent: false });
  h.svc.getEffective(); h.svc.setEnabled(true); h.svc.setEnabled(false);
  assert("12. crash/normal path never writes intentional_stop marker", !h.files.has(C));
}

// ── drift surfacing ──────────────────────────────────────────────────────────────────────────────────────────
{
  const h = harness({ taskPresent: false });
  h.files.set(P, JSON.stringify({ schemaVersion: 1, enabled: true, updatedAt: 1, source: "app" }));
  const eff = h.svc.getEffective();
  assert("13. ON + task absent → drift task_missing, not healthy, error", eff.enabled && eff.drift === "task_missing" && !eff.healthy && !!eff.error);
  assert("13. GET did not provision", h.calls.provision.length === 0);
}
{
  const h = harness({ taskPresent: true });
  h.files.set(P, JSON.stringify({ schemaVersion: 1, enabled: false, updatedAt: 1, source: "app" }));
  const eff = h.svc.getEffective();
  assert("13b. OFF + task present → drift task_unexpected, not healthy, error", !eff.enabled && eff.drift === "task_unexpected" && !eff.healthy && !!eff.error);
}

// ── Item #2: ATOMIC control.json write (temp + rename) ───────────────────────────────────────────────────────
{
  const h = harness({ taskPresent: true });
  h.files.set(P, JSON.stringify({ schemaVersion: 1, enabled: true, updatedAt: 1, source: "app" }));
  const res = h.svc.writeIntentionalStop("exit");
  assert("#2.1 atomic write → final control.json present, no leftover .tmp",
    res.ok && h.files.has(C) && !h.files.has(C + ".tmp") && (JSON.parse(h.files.get(C)!) as VonoControlState).mode === "intentional_stop");
}
{
  // rename failure must fail-CLOSED (marker not committed → do not quit)
  const h = harness({ taskPresent: true, renameFails: true });
  h.files.set(P, JSON.stringify({ schemaVersion: 1, enabled: true, updatedAt: 1, source: "app" }));
  const res = h.svc.writeIntentionalStop("exit");
  assert("#2.2 rename failure → ok:false, marker NOT committed", !res.ok && !!res.error && !h.files.has(C));
  const exit = h.svc.requestExit();
  assert("#2.3 requestExit fails-closed when atomic marker can't be committed", !exit.ok && !h.files.has(C));
}

// ── Item #3(b): guarded protection.json persist failure AFTER task mutation ───────────────────────────────────
{
  // ON: watchdog files present, autostart ok, provision installs, verify present — but persist(P) throws.
  const h = harness({ taskPresent: false, writeFailPath: P });
  const res = h.svc.setEnabled(true);
  assert("#3b.1 persist failure after install → ok:false (not a thrown exception)", res.ok === false);
  assert("#3b.1 controlled degraded result carries a save-failure error", !!res.state.error && /could not be saved/i.test(res.state.error!));
  assert("#3b.1 task WAS mutated (install ran)", h.calls.provision.includes("install") && h.state.taskPresent === true);
  assert("#3b.1 no successful ON persisted to protection.json", !h.files.has(P));
}
{
  // OFF: persisted ON exists, uninstall runs, verify absent — but persist(P) throws → degraded, stays truthful.
  const h = harness({ taskPresent: true, writeFailPath: P });
  h.files.set(P, JSON.stringify({ schemaVersion: 1, enabled: true, updatedAt: 1, source: "app" }));
  const res = h.svc.setEnabled(false);
  assert("#3b.2 OFF persist failure → ok:false + error, no throw", res.ok === false && !!res.state.error);
  assert("#3b.2 protection.json NOT overwritten (still prior value)", JSON.parse(h.files.get(P)!).enabled === true);
}

// ── Static guards ─────────────────────────────────────────────────────────────────────────────────────────────
{
  const svcSrc = readFileSync(path.join(__dirname, "..", "src", "main", "protection-service.ts"), "utf-8");
  assert("guard: no 7-day / TTL constant remains", !/INTENTIONAL_STOP_TTL_MS|7 \* 24/.test(svcSrc));
  assert("guard: intentional_stop written with expiresAt null", /mode: "intentional_stop"[\s\S]*expiresAt: null/.test(svcSrc));
  assert("guard: deps use taskStatus tri-state, not fail-open taskExists", /taskStatus: \(\) =>/.test(svcSrc) && !/taskExists/.test(svcSrc));
  assert("#2. control marker written atomically (tmp + renameFile)",
    /controlPath\(\) \+ "\.tmp"/.test(svcSrc) && /renameFile\(tmp, deps\.controlPath\(\)\)/.test(svcSrc));
  assert("#3b. setEnabled persist is guarded + returns controlled save-failure result",
    /try \{[\s\S]*persist\(\{ schemaVersion[\s\S]*\} catch[\s\S]*could not be saved/.test(svcSrc));
  assert("guard: protection-service has no identity/config/master coupling",
    !/from ["']\.\/(device-identity-reconcile|station-device-store|station-device-prisma|station-device-registration|durable-device-id|runtime-config-service)["']/.test(svcSrc) &&
    !/patchRuntimeConfig|saveRuntimeConfig|masterByBranch|\.branchId\b/.test(svcSrc));
}
{
  const idx = readFileSync(path.join(__dirname, "..", "src", "main", "index.ts"), "utf-8");
  // B1-B: watchdog-origin launch + active marker → quit; manual → clear. Gate runs BEFORE ensureRuntimeBinaries.
  assert("14. startup gate: watchdog-origin + active intentional-stop → app.quit()",
    /VONO_LAUNCH_SOURCE === "watchdog"[\s\S]*isIntentionalStopActive\(\)[\s\S]*app\.quit\(\)/.test(idx));
  assert("14. startup gate: manual launch → clearIntentionalStop()", /clearIntentionalStop\(\)/.test(idx));
  assert("14. startup gate runs BEFORE ensureRuntimeBinaries",
    idx.indexOf("Protection startup gate") !== -1 &&
      idx.indexOf("Protection startup gate") < idx.indexOf("await ensureRuntimeBinaries"));
  const obs = readFileSync(path.join(__dirname, "..", "watchdog", "observer.ts"), "utf-8");
  assert("14. watchdog launch tags VONO_LAUNCH_SOURCE=watchdog", /VONO_LAUNCH_SOURCE: "watchdog"/.test(obs));
  // B1-A: execution-time control recheck immediately before executeRecovery.
  assert("B1-A. observer re-reads control + aborts on suppression before executeRecovery",
    /isMaintenanceActive\(freshControl[\s\S]*executeRecovery\(ctx/.test(obs) && /aborted before execute/.test(obs));
}
{
  const ipc = readFileSync(path.join(__dirname, "..", "src", "main", "ipc-mvp.ts"), "utf-8");
  // B4: EXIT via requestExit + never quit on ok:false.
  assert("B4. EXIT_VONO uses requestExit() + only quits on ok",
    /svc\.requestExit\(\)/.test(ipc) && /if \(!decision\.ok\)[\s\S]*return \{ ok: false/.test(ipc) && /setImmediate\(\(\) => app\.quit\(\)\)/.test(ipc));
  // B3: real task probe distinguishes present(0)/absent(3)/unknown.
  assert("B3. real taskStatus dep maps exit 0=present / 3=absent / else=unknown",
    /taskStatus: \(\) =>/.test(ipc) && /exit 0/.test(ipc) && /exit 3/.test(ipc) && /return \{ ok: false, error:/.test(ipc));
  // #1: absence POSITIVELY observed (ObjectNotFound), never a broad CimException→absent.
  assert("#1. absence via ObjectNotFound only, no broad CimException→absent",
    /CategoryInfo\.Category -eq 'ObjectNotFound'/.test(ipc) && !/catch \[Microsoft[^\]]*CimException\][^\n]*exit 3/.test(ipc));
  // #2: real renameFile dep for atomic control write.
  assert("#2. real renameFile dep uses renameSync", /renameFile: \(from, to\) => renameSync/.test(ipc));
  // B5: autostart verify fail-closed (verify-read failure and still-on both → ok:false).
  assert("B5. disableElectronAutostart fail-closed on verify-read failure + still-on",
    /getLoginItemSettings\(\)\.openAtLogin === true/.test(ipc) && /return openAtLogin \? \{ ok: false/.test(ipc));
}
{
  const sm = readFileSync(path.join(__dirname, "..", "watchdog", "state-machine.ts"), "utf-8");
  assert("log cleanup: intentional_stop reason is 'intentional stop active', not 'maintenance until null'",
    /intentional stop active \(\$\{control!\.reason\}\)/.test(sm));
}
{
  const uiSrc = readFileSync(path.join(__dirname, "..", "..", "components", "desktop-settings-controls.tsx"), "utf-8");
  const body = uiSrc.slice(uiSrc.indexOf("export function DesktopStartupSettingsCard"), uiSrc.indexOf("export function DesktopLocalMusicSettingsCard"));
  assert("UI uses getProtectionState/setProtectionState, not autostart", /getProtectionState/.test(body) && /setProtectionState/.test(body) && !/getAutoStart|setAutoStart/.test(body));
  assert("UI handles exitVono result (ok:false surfaces error)", /res\.ok/.test(body) && /exitVono/.test(body));
  assert("UI surfaces drift incl. task_unknown", /task_unknown/.test(body) && /could not be determined/.test(body));
  // #4: drift repair RE-APPLIES current desired (no inversion); toggle disabled during drift; explicit Repair.
  assert("#4. drift Repair re-applies current desired (setProtectionState(protection.enabled))",
    /setProtectionState\(protection\.enabled\)/.test(body) && /Repair Protection/.test(body));
  assert("#4. toggle disabled during drift (can't invert desired)", /busy \|\| drifted/.test(body));
  assert("#4. drift copy tells the operator to use Repair, not to toggle", /use Repair/.test(body) && !/toggle Protection to repair/.test(body));
}

console.log(`\n${pass} passed, ${fail} failed`);
