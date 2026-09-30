/**
 * Phase B2 regression — installer Protection migration.
 *
 * Exercises the REAL provisioning PowerShell against a TEMP ProgramData with test seams that skip every real
 * Scheduled-Task mutation (VONO_TEST_NO_TASK_OPS=1) and inject a deterministic task probe result
 * (VONO_TEST_TASK_STATE). No real "VONO Protection" task is ever created/changed/deleted. Plus static guards on
 * installer.nsh + the two .ps1 files. PS-exec cases run on Windows only; static guards always run.
 *
 * Run: npx tsx desktop/scripts/verify-installer-migration.ts
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
function skip(name: string, why: string): void { console.log(`SKIP  ${name}  — ${why}`); }

const PROV_DIR = path.join(__dirname, "..", "scripts", "provisioning");
const STOP_PS = path.join(PROV_DIR, "stop-vono-for-upgrade.ps1");
const PROVISION_PS = path.join(PROV_DIR, "provision-vono-protection.ps1");
const NSH = path.join(__dirname, "..", "build", "installer.nsh");

const isWin = process.platform === "win32";

type Env = Record<string, string | undefined>;
function runPs(script: string, args: string[], env: Env): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, ...args],
    { encoding: "utf-8", env: { ...process.env, ...env } as NodeJS.ProcessEnv, windowsHide: true },
  );
  return { status: r.status, stdout: (r.stdout ?? "").toString(), stderr: (r.stderr ?? "").toString() };
}

/** Fresh temp: returns { programData, stateDir, protJson, installDir } with VONO\state created. */
function tmpEnv() {
  const root = mkdtempSync(path.join(os.tmpdir(), "vono-b2-"));
  const programData = path.join(root, "PD");
  const stateDir = path.join(programData, "VONO", "state");
  mkdirSync(stateDir, { recursive: true });
  const installDir = path.join(root, "Install");
  mkdirSync(installDir, { recursive: true });
  return { root, programData, stateDir, protJson: path.join(stateDir, "protection.json"), installDir };
}
function readRaw(p: string): string | null {
  return existsSync(p) ? readFileSync(p, "utf-8") : null;
}
// NOTE: no BOM stripping — the Node app parses protection.json with a plain JSON.parse, so these tests must
// parse the raw bytes the same way. A BOM (or any leading garbage) makes this return null and the test fail.
function readProt(p: string): { enabled?: unknown; source?: unknown } | null {
  const raw = readRaw(p);
  if (raw === null) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
function isBomFreeJson(p: string): boolean {
  const raw = readRaw(p);
  if (raw === null) return false;
  return raw.charCodeAt(0) === 0x7b /* '{' */ && (() => { try { JSON.parse(raw); return true; } catch { return false; } })();
}

// ── SEED matrix (stop-vono-for-upgrade.ps1) ──────────────────────────────────────────────────────────────────
if (!isWin) {
  skip("seed matrix (PS exec)", "not Windows");
} else {
  // S1 NEW: task absent, no old exe → no seed.
  {
    const t = tmpEnv();
    runPs(STOP_PS, ["-InstallDir", t.installDir], { ProgramData: t.programData, VONO_TEST_NO_TASK_OPS: "1", VONO_TEST_TASK_STATE: "absent" });
    assert("1. NEW (task absent, no old exe) → no seed, protection.json absent", readProt(t.protJson) === null);
    rmSync(t.root, { recursive: true, force: true });
  }
  // S2 LEGACY ON: task present → seed enabled=true source=migration; seed success CONTINUES to teardown.
  {
    const t = tmpEnv();
    const r = runPs(STOP_PS, ["-InstallDir", t.installDir], { ProgramData: t.programData, VONO_TEST_NO_TASK_OPS: "1", VONO_TEST_TASK_STATE: "present" });
    const p = readProt(t.protJson);
    assert("2. LEGACY task present + no json → seed enabled=true, source=migration", !!p && p.enabled === true && p.source === "migration");
    assert("2. seed protection.json is BOM-free (raw starts '{', native JSON.parse works)", isBomFreeJson(t.protJson));
    assert("2. successful seed CONTINUES (exit 0, teardown reached)", r.status === 0 && /Pre-upgrade teardown complete/.test(r.stdout));
    rmSync(t.root, { recursive: true, force: true });
  }
  // S3 unknown + no old exe → do NOT seed (clean first install; probe glitch must not turn ON).
  {
    const t = tmpEnv();
    runPs(STOP_PS, ["-InstallDir", t.installDir], { ProgramData: t.programData, VONO_TEST_NO_TASK_OPS: "1", VONO_TEST_TASK_STATE: "unknown" });
    assert("3. unknown task + clean install (no old exe) → NO seed", readProt(t.protJson) === null);
    rmSync(t.root, { recursive: true, force: true });
  }
  // S4 unknown + old exe present (existing install evidence) → seed ON.
  {
    const t = tmpEnv();
    writeFileSync(path.join(t.installDir, "SyncBiz Player.exe"), "old"); // existing-install evidence
    runPs(STOP_PS, ["-InstallDir", t.installDir], { ProgramData: t.programData, VONO_TEST_NO_TASK_OPS: "1", VONO_TEST_TASK_STATE: "unknown" });
    const p = readProt(t.protJson);
    assert("4. unknown task + existing install (old exe) → seed enabled=true", !!p && p.enabled === true && p.source === "migration");
    rmSync(t.root, { recursive: true, force: true });
  }
  // S5 existing json (enabled=false) is NEVER overwritten by the legacy seed.
  {
    const t = tmpEnv();
    writeFileSync(t.protJson, JSON.stringify({ schemaVersion: 1, enabled: false, updatedAt: 1, source: "app" }));
    runPs(STOP_PS, ["-InstallDir", t.installDir], { ProgramData: t.programData, VONO_TEST_NO_TASK_OPS: "1", VONO_TEST_TASK_STATE: "present" });
    const p = readProt(t.protJson);
    assert("7. existing preference NOT overwritten by seed (stays enabled=false, source=app)", !!p && p.enabled === false && p.source === "app");
    rmSync(t.root, { recursive: true, force: true });
  }
  // FC1 FAIL-CLOSED: required ON seed WRITE failure → non-zero (87), teardown NOT reached.
  {
    const t = tmpEnv();
    const r = runPs(STOP_PS, ["-InstallDir", t.installDir], { ProgramData: t.programData, VONO_TEST_NO_TASK_OPS: "1", VONO_TEST_TASK_STATE: "present", VONO_TEST_SEED_FAIL_WRITE: "1" });
    assert("FC1. seed WRITE failure → exit 87, failure logged", r.status === 87 && /REQUIRED legacy Protection seed FAILED/.test(r.stdout));
    assert("FC1. task teardown NOT reached on seed failure", !/Pre-upgrade teardown complete/.test(r.stdout) && !/skipping real schtasks/.test(r.stdout));
    assert("FC1. no protection.json left behind on write failure", readProt(t.protJson) === null);
    rmSync(t.root, { recursive: true, force: true });
  }
  // FC2 FAIL-CLOSED: required ON seed VERIFY failure → non-zero (87), teardown NOT reached.
  {
    const t = tmpEnv();
    const r = runPs(STOP_PS, ["-InstallDir", t.installDir], { ProgramData: t.programData, VONO_TEST_NO_TASK_OPS: "1", VONO_TEST_TASK_STATE: "present", VONO_TEST_SEED_FAIL_VERIFY: "1" });
    assert("FC2. seed VERIFY failure → exit 87, failure logged", r.status === 87 && /REQUIRED legacy Protection seed FAILED/.test(r.stdout));
    assert("FC2. task teardown NOT reached on verify failure", !/Pre-upgrade teardown complete/.test(r.stdout));
    rmSync(t.root, { recursive: true, force: true });
  }
  // FC3 fail-closed is scoped to the REQUIRED seed: a NEW install (no seed needed) with the same seams still exits 0.
  {
    const t = tmpEnv();
    const r = runPs(STOP_PS, ["-InstallDir", t.installDir], { ProgramData: t.programData, VONO_TEST_NO_TASK_OPS: "1", VONO_TEST_TASK_STATE: "absent", VONO_TEST_SEED_FAIL_WRITE: "1" });
    assert("FC3. no-seed path is never fatal (NEW install → exit 0, continues)", r.status === 0 && /Pre-upgrade teardown complete/.test(r.stdout));
    rmSync(t.root, { recursive: true, force: true });
  }

  // S6 seed run does NOT touch control.json / device-id.json / heartbeat.json.
  {
    const t = tmpEnv();
    const ctl = path.join(t.stateDir, "control.json");
    const did = path.join(t.stateDir, "device-id.json");
    const hb = path.join(t.stateDir, "heartbeat.json");
    writeFileSync(ctl, "CTL-SENTINEL");
    writeFileSync(did, "DID-SENTINEL");
    writeFileSync(hb, "HB-SENTINEL");
    runPs(STOP_PS, ["-InstallDir", t.installDir], { ProgramData: t.programData, VONO_TEST_NO_TASK_OPS: "1", VONO_TEST_TASK_STATE: "present" });
    assert("8. control.json untouched by seed", existsSync(ctl) && readFileSync(ctl, "utf-8") === "CTL-SENTINEL");
    assert("9. device-id.json untouched by seed", existsSync(did) && readFileSync(did, "utf-8") === "DID-SENTINEL");
    assert("8b. heartbeat.json untouched by seed", existsSync(hb) && readFileSync(hb, "utf-8") === "HB-SENTINEL");
    rmSync(t.root, { recursive: true, force: true });
  }
}

// ── ENSURE matrix (provision-vono-protection.ps1 -Action ensure) ─────────────────────────────────────────────
if (!isWin) {
  skip("ensure matrix (PS exec)", "not Windows");
} else {
  // E1 NEW (no json) → OFF written deterministically, no task.
  {
    const t = tmpEnv();
    const r = runPs(PROVISION_PS, ["-Action", "ensure", "-InstallDir", t.installDir], { ProgramData: t.programData, VONO_TEST_NO_TASK_OPS: "1" });
    const p = readProt(t.protJson);
    assert("1b. NEW ensure → exit 0, protection.json enabled=false source=installer, no provision",
      r.status === 0 && !!p && p.enabled === false && p.source === "installer" && !/would install task/.test(r.stdout));
    assert("1b. new-install protection.json is BOM-free (raw '{', native JSON.parse works)", isBomFreeJson(t.protJson));
    rmSync(t.root, { recursive: true, force: true });
  }
  // E2 enabled=true → provisions (test seam emits marker), exit 0.
  {
    const t = tmpEnv();
    writeFileSync(t.protJson, JSON.stringify({ schemaVersion: 1, enabled: true, updatedAt: 1, source: "app" }));
    const r = runPs(PROVISION_PS, ["-Action", "ensure", "-InstallDir", t.installDir], { ProgramData: t.programData, VONO_TEST_NO_TASK_OPS: "1" });
    assert("3b. B1 ON ensure → would install task, exit 0", r.status === 0 && /would install task/.test(r.stdout));
    rmSync(t.root, { recursive: true, force: true });
  }
  // E3 enabled=false → no provision, exit 0, json unchanged.
  {
    const t = tmpEnv();
    writeFileSync(t.protJson, JSON.stringify({ schemaVersion: 1, enabled: false, updatedAt: 1, source: "app" }));
    const r = runPs(PROVISION_PS, ["-Action", "ensure", "-InstallDir", t.installDir], { ProgramData: t.programData, VONO_TEST_NO_TASK_OPS: "1" });
    const p = readProt(t.protJson);
    assert("4b. B1 OFF ensure → no provision, exit 0, preference preserved",
      r.status === 0 && !/would install task/.test(r.stdout) && !!p && p.enabled === false);
    rmSync(t.root, { recursive: true, force: true });
  }
  // E4 malformed → exit 2, no provision, json unchanged.
  {
    const t = tmpEnv();
    writeFileSync(t.protJson, "{ this is not valid json");
    const r = runPs(PROVISION_PS, ["-Action", "ensure", "-InstallDir", t.installDir], { ProgramData: t.programData, VONO_TEST_NO_TASK_OPS: "1" });
    assert("12. malformed protection.json → exit 2, no provision, reported",
      r.status === 2 && !/would install task/.test(r.stdout) && /malformed/i.test(r.stdout));
    assert("12b. malformed preference left unchanged", readFileSync(t.protJson, "utf-8") === "{ this is not valid json");
    rmSync(t.root, { recursive: true, force: true });
  }
}

// ── Static guards (always run) ───────────────────────────────────────────────────────────────────────────────
{
  const nsh = readFileSync(NSH, "utf-8");
  assert("11. customInstall uses -Action ensure (NOT unconditional -Action install)",
    /-Action ensure/.test(nsh) && !/-Action install/.test(nsh));
  const un = nsh.slice(nsh.indexOf("customUnInstall"));
  // Match the ACTUAL NSIS Delete/Remove-Item instruction form (quoted path), not prose comments.
  assert("10. uninstall preserves protection.json (no delete)", !/Delete\s+"[^"]*protection\.json/i.test(un) && !/Remove-Item\s+"[^"]*protection\.json/i.test(un));
  assert("10b. uninstall preserves device-id.json (no delete)", !/Delete\s+"[^"]*device-id\.json/i.test(un) && !/Remove-Item\s+"[^"]*device-id\.json/i.test(un));
  assert("10c. uninstall still removes the watchdog.lock", /Delete\s+"[^"]*watchdog\.lock/i.test(un));
  assert("14. no direct post-install force-run added (no StartApp/quitAndInstall/--force-run)",
    !/StartApp|quitAndInstall|--force-run|isForceRun/i.test(nsh));
  // Fail-closed: customCheckAppRunning aborts on migration code 87 (runs before uninstallOldVersion by NSIS order).
  const cca = nsh.slice(nsh.indexOf("customCheckAppRunning"), nsh.indexOf("customInstall"));
  assert("FC. customCheckAppRunning aborts the upgrade on migration failure (code 87)",
    /\$0 == 87/.test(cca) && /Abort/.test(cca));
}
{
  const stop = readFileSync(STOP_PS, "utf-8");
  // 13: seed runs BEFORE the stop/disable of the task. Anchor on the CODE markers (unique to the code section),
  // not "Stop + DISABLE" which also appears in the top docstring.
  const iSeed = stop.indexOf("LEGACY SEED");
  const iDisableCode = stop.indexOf("# 1) Stop + DISABLE");
  const iSchtasks = stop.indexOf("schtasks /End");
  assert("13. legacy seed occurs before task stop/disable", iSeed !== -1 && iDisableCode !== -1 && iSchtasks !== -1 && iSeed < iDisableCode && iSeed < iSchtasks);
  assert("13b. seed writes protection.json atomically (temp + Move-Item)", /\$protJson\.tmp/.test(stop) && /Move-Item[^\n]*protJson/.test(stop));
  assert("8c. stop-vono never WRITES control/device-id/heartbeat",
    !/(Set-Content|Move-Item|Out-File|Remove-Item)[^\n]*(control\.json|device-id\.json|heartbeat\.json)/i.test(stop));
  assert("seed: absence positively observed (ObjectNotFound), not blanket unknown→present",
    /CategoryInfo\.Category -eq 'ObjectNotFound'/.test(stop) && /taskState -eq "unknown" -and \$existingInstall/.test(stop));
  assert("seed: has test seam that avoids real schtasks mutation", /VONO_TEST_NO_TASK_OPS/.test(stop) && /VONO_TEST_TASK_STATE/.test(stop));
  assert("seed: BOM-free write (UTF8Encoding(false) + WriteAllText), not Set-Content -Encoding UTF8",
    /UTF8Encoding\(\$false\)/.test(stop) && /WriteAllText/.test(stop) && !/Set-Content[^\n]*-Encoding UTF8/.test(stop));
  assert("seed: fail-closed — required seed failure exits $MIGRATION_FAIL before teardown",
    /\$MIGRATION_FAIL = 87/.test(stop) && /exit \$MIGRATION_FAIL/.test(stop));
  assert("seed: verified (final file parses with enabled=true)", /\$back\.enabled -eq \$true/.test(stop));
}
{
  const prov = readFileSync(PROVISION_PS, "utf-8");
  assert("provision: has -Action ensure", /ValidateSet\("install", "uninstall", "ensure"\)/.test(prov) && /"ensure"\s*\{ Ensure-FromState \}/.test(prov));
  assert("provision: ensure reads protection.json + ConvertFrom-Json", /protection\.json/.test(prov) && /ConvertFrom-Json/.test(prov));
  assert("provision: enabled=true → Install-Task; malformed → exit 2", /if \(\$enabled\) \{ Install-Task; exit 0 \}/.test(prov) && /exit 2/.test(prov));
  assert("provision: NEW writes deterministic enabled=false source=installer", /enabled = \$false[\s\S]*source = "installer"/.test(prov));
  assert("provision: task ops guarded by test seam (no real mutation in tests)", /VONO_TEST_NO_TASK_OPS -eq '1'/.test(prov));
  assert("provision: new-install record BOM-free (UTF8Encoding(false)+WriteAllText, not Set-Content -Encoding UTF8)",
    /UTF8Encoding\(\$false\)/.test(prov) && /WriteAllText/.test(prov) && !/Set-Content[^\n]*-Encoding UTF8/.test(prov));
}

console.log(`\n${pass} passed, ${fail} failed`);
