/**
 * Phase B1 regression — VONO Protection service (protection-service.ts) with injected fakes + temp state.
 * No real Scheduled Task, no Electron, no network. Plus watchdog control-suppression semantics + static guards.
 *
 * Run: npx tsx desktop/scripts/verify-protection-service.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createProtectionService, type ProtectionDeps } from "../src/main/protection-service";
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
  filesPresent?: boolean;
  autostartOk?: boolean;
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
    writeFile: (p, d) => { files.set(p, d); },
    removeFile: (p) => { files.delete(p); },
    protectionStatePath: () => P,
    controlPath: () => C,
    taskExists: () => state.taskPresent,
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
  assert("1. no state + no task → OFF, healthy", !eff.enabled && eff.supported && !eff.taskPresent && eff.healthy && eff.drift === "none");
  assert("1. migration persisted enabled=false", readState(h.files)?.enabled === false && readState(h.files)?.source === "migration");
}
{
  const h = harness({ taskPresent: true });
  const eff = h.svc.getEffective();
  assert("2. no state + existing task → migrate ON, healthy", eff.enabled && eff.taskPresent && eff.healthy);
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

// ── OFF → ON / ON → OFF ───────────────────────────────────────────────────────────────────────────────────────
{
  const h = harness({ taskPresent: false });
  const res = h.svc.setEnabled(true);
  assert("5. OFF→ON ok, healthy", res.ok && res.state.enabled && res.state.taskPresent && res.state.healthy);
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
  assert("7. ON→OFF ok", res.ok && !res.state.enabled && !res.state.taskPresent && res.state.healthy);
  assert("7. provision uninstall called + autostart disabled", h.calls.provision.includes("uninstall") && h.calls.disableAutostart === 1);
}
{
  const h = harness({ taskPresent: true, provision: () => ({ ok: true }) }); // uninstall "succeeds" but task remains
  const res = h.svc.setEnabled(false);
  assert("8. failed OFF (task still present) → not ok, stays ON", !res.ok && res.state.enabled && !!res.state.error);
}

// ── BLOCKER 4: verifiable autostart disable ───────────────────────────────────────────────────────────────────
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
}

// ── BLOCKER 1 + 3: persistent intentional_stop, verified write ───────────────────────────────────────────────
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
  const h = harness();
  // make write a no-op so the verify read finds nothing
  const svc = createProtectionService({
    now: () => NOW, platform: "win32",
    readFile: () => null, writeFile: () => { /* dropped */ }, removeFile: () => {},
    protectionStatePath: () => P, controlPath: () => C,
    taskExists: () => true, requiredWatchdogFilesPresent: () => true,
    provision: () => ({ ok: true }), disableElectronAutostart: () => ({ ok: true }), log: () => {},
  });
  void h;
  const res = svc.writeIntentionalStop("x");
  assert("3. marker write that doesn't persist → ok:false (do NOT quit)", !res.ok && !!res.error);
}

// ── Watchdog control-suppression semantics (BLOCKER 1) ───────────────────────────────────────────────────────
{
  const stop: VonoControlState = { schemaVersion: 1, mode: "intentional_stop", reason: "exit", source: "app", createdAt: NOW, expiresAt: null, bootId: null };
  assert("intentional_stop active now", isMaintenanceActive(stop, NOW));
  assert("intentional_stop active after 1 day", isMaintenanceActive(stop, NOW + 86_400_000));
  assert("intentional_stop active after 30 days", isMaintenanceActive(stop, NOW + 30 * 86_400_000));
  assert("intentional_stop active at arbitrary far future", isMaintenanceActive(stop, NOW + 3650 * 86_400_000));
  const maint: VonoControlState = { schemaVersion: 1, mode: "maintenance", reason: "upgrade", source: "installer", createdAt: NOW, expiresAt: NOW + 60_000, bootId: null };
  assert("maintenance active before expiry", isMaintenanceActive(maint, NOW + 30_000));
  assert("maintenance INACTIVE after expiry (bounded)", !isMaintenanceActive(maint, NOW + 120_000));
  const none: VonoControlState = { schemaVersion: 1, mode: "none", reason: "", source: "app", createdAt: NOW, expiresAt: null, bootId: null };
  assert("mode none inactive", !isMaintenanceActive(none, NOW));
  assert("null control inactive", !isMaintenanceActive(null, NOW));
}

// ── clearIntentionalStop ─────────────────────────────────────────────────────────────────────────────────────
{
  const h = harness();
  h.files.set(C, JSON.stringify({ mode: "intentional_stop", schemaVersion: 1 }));
  h.svc.clearIntentionalStop();
  assert("manual startup clears intentional_stop", !h.files.has(C));
  h.files.set(C, JSON.stringify({ mode: "maintenance", schemaVersion: 1 }));
  h.svc.clearIntentionalStop();
  assert("maintenance marker left intact", h.files.has(C));
}
{
  const h = harness({ taskPresent: false });
  h.svc.getEffective(); h.svc.setEnabled(true); h.svc.setEnabled(false);
  assert("12. crash/normal path never writes intentional_stop marker", !h.files.has(C));
}

// ── BLOCKER 5: drift surfacing ───────────────────────────────────────────────────────────────────────────────
{
  const h = harness({ taskPresent: false });
  h.files.set(P, JSON.stringify({ schemaVersion: 1, enabled: true, updatedAt: 1, source: "app" }));
  const eff = h.svc.getEffective();
  assert("13. ON + task absent → drift task_missing, not healthy, error", eff.enabled && eff.drift === "task_missing" && !eff.healthy && !!eff.error);
  // GET must NOT repair (no provision from GET)
  assert("13. GET did not provision", h.calls.provision.length === 0);
}
{
  const h = harness({ taskPresent: true });
  h.files.set(P, JSON.stringify({ schemaVersion: 1, enabled: false, updatedAt: 1, source: "app" }));
  const eff = h.svc.getEffective();
  assert("13b. OFF + task present → drift task_unexpected, not healthy, error", !eff.enabled && eff.drift === "task_unexpected" && !eff.healthy && !!eff.error);
}

// ── Static guards ─────────────────────────────────────────────────────────────────────────────────────────────
{
  const svcSrc = readFileSync(path.join(__dirname, "..", "src", "main", "protection-service.ts"), "utf-8");
  assert("guard: no 7-day / TTL constant remains", !/INTENTIONAL_STOP_TTL_MS|7 \* 24/.test(svcSrc));
  assert("guard: intentional_stop written with expiresAt null", /mode: "intentional_stop"[\s\S]*expiresAt: null/.test(svcSrc));
  assert("guard: protection-service has no identity/config/master coupling",
    !/from ["']\.\/(device-identity-reconcile|station-device-store|station-device-prisma|station-device-registration|durable-device-id|runtime-config-service)["']/.test(svcSrc) &&
    !/patchRuntimeConfig|saveRuntimeConfig|masterByBranch|\.branchId\b/.test(svcSrc));
}
{
  const idx = readFileSync(path.join(__dirname, "..", "src", "main", "index.ts"), "utf-8");
  assert("14. index clears marker ONLY when launch source !== watchdog",
    /VONO_LAUNCH_SOURCE !== "watchdog"[\s\S]*clearIntentionalStop\(\)/.test(idx));
  const obs = readFileSync(path.join(__dirname, "..", "watchdog", "observer.ts"), "utf-8");
  assert("14. watchdog launch tags VONO_LAUNCH_SOURCE=watchdog", /VONO_LAUNCH_SOURCE: "watchdog"/.test(obs));
}
{
  const ipc = readFileSync(path.join(__dirname, "..", "src", "main", "ipc-mvp.ts"), "utf-8");
  assert("EXIT_VONO returns error + does not quit on marker failure",
    /return \{ ok: false, error: res\.error \}/.test(ipc) && /setImmediate\(\(\) => app\.quit\(\)\)/.test(ipc));
}
{
  const uiSrc = readFileSync(path.join(__dirname, "..", "..", "components", "desktop-settings-controls.tsx"), "utf-8");
  const body = uiSrc.slice(uiSrc.indexOf("export function DesktopStartupSettingsCard"), uiSrc.indexOf("export function DesktopLocalMusicSettingsCard"));
  assert("UI uses getProtectionState/setProtectionState, not autostart", /getProtectionState/.test(body) && /setProtectionState/.test(body) && !/getAutoStart|setAutoStart/.test(body));
  assert("UI handles exitVono result (ok:false surfaces error)", /res\.ok/.test(body) && /exitVono/.test(body));
  assert("UI surfaces drift", /task_missing|drift/.test(body));
}

console.log(`\n${pass} passed, ${fail} failed`);
