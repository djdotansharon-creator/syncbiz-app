/**
 * Phase B1 regression — VONO Protection service (protection-service.ts) with injected fakes + temp state.
 * No real Scheduled Task, no Electron, no network. Plus static guards for isolation and the hosted Settings UI.
 *
 * Run: npx tsx desktop/scripts/verify-protection-service.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  createProtectionService,
  INTENTIONAL_STOP_TTL_MS,
  type ProtectionDeps,
} from "../src/main/protection-service";

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
      state.taskPresent = action === "install"; // default: reflect reality
      return { ok: true };
    },
    disableElectronAutostart: () => { calls.disableAutostart++; },
    log: () => {},
  };
  return { svc: createProtectionService(deps), files, state, calls };
}
const readState = (files: Map<string, string>) => (files.has(P) ? JSON.parse(files.get(P)!) : null);

// 1. no state + no task → OFF (migration)
{
  const h = harness({ taskPresent: false });
  const eff = h.svc.getEffective();
  assert("1. no protection.json + no task → OFF", eff.enabled === false && eff.supported === true && eff.taskPresent === false);
  assert("1. migration persisted enabled=false", readState(h.files)?.enabled === false && readState(h.files)?.source === "migration");
}
// 2. no state + existing task → migrate ON (preserves pilot Lenovo)
{
  const h = harness({ taskPresent: true });
  const eff = h.svc.getEffective();
  assert("2. no protection.json + existing task → migrate ON", eff.enabled === true && eff.taskPresent === true);
  assert("2. migration persisted enabled=true", readState(h.files)?.enabled === true);
}
// 3/4. persisted state survives read
{
  const h = harness({ taskPresent: true });
  h.files.set(P, JSON.stringify({ schemaVersion: 1, enabled: true, updatedAt: 1, source: "app" }));
  assert("3. persisted ON survives read", h.svc.getEffective().enabled === true);
  const h2 = harness({ taskPresent: false });
  h2.files.set(P, JSON.stringify({ schemaVersion: 1, enabled: false, updatedAt: 1, source: "app" }));
  assert("4. persisted OFF survives read", h2.svc.getEffective().enabled === false);
}
// 5. OFF → ON: provision install, task verified, state ON, autostart disabled
{
  const h = harness({ taskPresent: false });
  const res = h.svc.setEnabled(true);
  assert("5. OFF→ON ok", res.ok && res.state.enabled === true && res.state.taskPresent === true);
  assert("5. provision install called", h.calls.provision.includes("install"));
  assert("5. legacy Electron autostart disabled on ON", h.calls.disableAutostart === 1);
  assert("5. persisted ON", readState(h.files)?.enabled === true);
}
// 6. failed ON provisioning → NOT ON
{
  const h = harness({ taskPresent: false, provision: () => ({ ok: false, error: "provision failed" }) });
  const res = h.svc.setEnabled(true);
  assert("6. failed ON provisioning → not ok, state stays OFF", !res.ok && res.state.enabled === false && !!res.state.error);
  assert("6. no false ON persisted", readState(h.files)?.enabled !== true);
}
// 6b. missing watchdog files → not ON
{
  const h = harness({ taskPresent: false, filesPresent: false });
  const res = h.svc.setEnabled(true);
  assert("6b. missing watchdog files → not ON", !res.ok && res.state.enabled === false && h.calls.provision.length === 0);
}
// 7. ON → OFF: uninstall, task absent, state OFF; no kill capability exists
{
  const h = harness({ taskPresent: true });
  const res = h.svc.setEnabled(false);
  assert("7. ON→OFF ok", res.ok && res.state.enabled === false && res.state.taskPresent === false);
  assert("7. provision uninstall called", h.calls.provision.includes("uninstall"));
  assert("7. legacy Electron autostart disabled on OFF", h.calls.disableAutostart === 1);
}
// 8. failed OFF (task still present after uninstall) → NOT OFF
{
  const h = harness({ taskPresent: true, provision: () => ({ ok: true }) }); // provision "succeeds" but task not removed
  const res = h.svc.setEnabled(false);
  assert("8. failed OFF (task still present) → not ok, stays ON", !res.ok && res.state.enabled === true && !!res.state.error);
}
// 9. non-Windows unsupported
{
  const h = harness({ platform: "darwin" });
  assert("9. non-Windows: supported=false", h.svc.getEffective().supported === false);
  const res = h.svc.setEnabled(true);
  assert("9. non-Windows: setEnabled rejected", !res.ok && !!res.state.error);
}
// 10. explicit Exit → valid intentional_stop control.json; does NOT mutate protection.enabled
{
  const h = harness({ taskPresent: true });
  h.files.set(P, JSON.stringify({ schemaVersion: 1, enabled: true, updatedAt: 1, source: "app" }));
  h.svc.writeIntentionalStop("explicit user exit");
  const control = JSON.parse(h.files.get(C)!);
  assert("10. control.json mode=intentional_stop, source=app", control.mode === "intentional_stop" && control.source === "app");
  assert("10. bounded expiry = now + 7d", control.expiresAt === NOW + INTENTIONAL_STOP_TTL_MS && INTENTIONAL_STOP_TTL_MS === 7 * 24 * 3600 * 1000);
  assert("10. protection.enabled unchanged by Exit", readState(h.files)?.enabled === true);
}
// 11. manual startup clears intentional_stop (but leaves other control modes intact)
{
  const h = harness();
  h.files.set(C, JSON.stringify({ mode: "intentional_stop", schemaVersion: 1 }));
  h.svc.clearIntentionalStop();
  assert("11. manual startup clears intentional_stop", !h.files.has(C));
  h.files.set(C, JSON.stringify({ mode: "maintenance", schemaVersion: 1 }));
  h.svc.clearIntentionalStop();
  assert("11. non-intentional (maintenance) marker is left intact", h.files.has(C));
}
// 12. crash path: a normal getEffective/setEnabled cycle NEVER writes a control.json marker (only explicit Exit does)
{
  const h = harness({ taskPresent: false });
  h.svc.getEffective();
  h.svc.setEnabled(true);
  h.svc.setEnabled(false);
  assert("12. crash/normal path never writes intentional_stop marker", !h.files.has(C));
}

// ── Static guards ─────────────────────────────────────────────────────────────────────────────────────────────
{
  const svcSrc = readFileSync(path.join(__dirname, "..", "src", "main", "protection-service.ts"), "utf-8");
  // 13. Protection service never couples to identity/registration/config/MASTER.
  assert("13. protection-service imports no identity/registration/config modules",
    !/from ["']\.\/(device-identity-reconcile|station-device-store|station-device-prisma|station-device-registration|durable-device-id|runtime-config-service)["']/.test(svcSrc));
  assert("13. protection-service does not mutate config or reference master maps",
    !/patchRuntimeConfig|saveRuntimeConfig|masterByBranch|\.branchId\b/.test(svcSrc));
}
{
  const uiSrc = readFileSync(path.join(__dirname, "..", "..", "components", "desktop-settings-controls.tsx"), "utf-8");
  const start = uiSrc.indexOf("export function DesktopStartupSettingsCard");
  const body = uiSrc.slice(start, uiSrc.indexOf("export function DesktopLocalMusicSettingsCard"));
  // 14. Hosted Settings card uses the Protection API and NOT autostart as the visible switch.
  assert("14. Settings card uses getProtectionState/setProtectionState", /getProtectionState/.test(body) && /setProtectionState/.test(body));
  assert("14. Settings card no longer uses getAutoStart/setAutoStart", !/getAutoStart|setAutoStart/.test(body));
  assert("14. Settings card offers Exit VONO", /exitVono/.test(body));
}

console.log(`\n${pass} passed, ${fail} failed`);
