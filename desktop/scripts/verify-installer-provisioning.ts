/**
 * Deterministic static verification of the installer-integrated VONO Protection provisioning.
 * No admin, no Scheduled Task registration, no process launch — it asserts the committed installer
 * hooks + provisioning scripts + electron-builder config encode every required behavior.
 *
 * Run: npx tsx desktop/scripts/verify-installer-provisioning.ts
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const root = path.join(__dirname, ".."); // desktop/
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}

// ── NSIS hooks ───────────────────────────────────────────────────────────────
const nsh = read("build/installer.nsh");
assert("nsh: customInstall runs provision (install), hidden, quoted $INSTDIR",
  /!macro\s+customInstall/.test(nsh) &&
  /-WindowStyle Hidden/.test(nsh) &&
  /provision-vono-protection\.ps1" -Action install -InstallDir "\$INSTDIR"/.test(nsh));
assert("nsh: customUnInstall deletes the single task + stale lock",
  /!macro\s+customUnInstall/.test(nsh) &&
  /schtasks \/Delete \/TN "VONO Protection" \/F/.test(nsh) &&
  /VONO\\state\\watchdog\.lock/.test(nsh));
assert("nsh: no blanket/unrelated startup wipe", !/reg delete/i.test(nsh) && !/Startup/i.test(nsh));

// ── launch-watchdog.ps1 (hidden foreground runner) ───────────────────────────
const launch = read("scripts/provisioning/launch-watchdog.ps1");
assert("launcher: uses $PSScriptRoot (spaces-safe, no interpolation)", /\$PSScriptRoot/.test(launch));
assert("launcher: runs node.exe + watchdog.cjs in FOREGROUND", /Join-Path \$PSScriptRoot "node\.exe"/.test(launch) && /watchdog\.cjs/.test(launch) && /&\s+\$node\s+\$cjs/.test(launch));

// ── provision-vono-protection.ps1 (task registration) ────────────────────────
const prov = read("scripts/provisioning/provision-vono-protection.ps1");
assert("provision: hidden action (-WindowStyle Hidden -File launch-watchdog.ps1)", /-WindowStyle Hidden -ExecutionPolicy Bypass -File `"\$runner`"/.test(prov) && /launch-watchdog\.ps1/.test(prov));
assert("provision: correct station user ($env:USERDOMAIN\\$env:USERNAME)", /\$env:USERDOMAIN\\\$env:USERNAME/.test(prov));
assert("provision: InteractiveToken + LeastPrivilege (Limited)", /-LogonType Interactive/.test(prov) && /-RunLevel Limited/.test(prov));
assert("provision: MultipleInstances IgnoreNew", /-MultipleInstances IgnoreNew/.test(prov));
assert("provision: restart-on-failure 1min x3", /-RestartInterval \(New-TimeSpan -Minutes 1\)/.test(prov) && /-RestartCount 3/.test(prov));
assert("provision: StartWhenAvailable + no exec time limit (PT0S)", /-StartWhenAvailable/.test(prov) && /ExecutionTimeLimit = "PT0S"/.test(prov));
assert("provision: idempotent single task (Register -Force)", /Register-ScheduledTask[\s\S]*-Force/.test(prov));
assert("provision: working directory = vono-watchdog", /-WorkingDirectory \$wd/.test(prov) && /Join-Path \$InstallDir "vono-watchdog"/.test(prov));
assert("provision: AtLogOn trigger", /New-ScheduledTaskTrigger -AtLogOn/.test(prov));
assert("provision: legacy VONO Run cleanup — EXACT value only", /Remove-ItemProperty -Path "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run" -Name "electron\.app\.SyncBiz Player"/.test(prov));
// Dangerous forms: whole-key delete (Remove-Item, NOT the safe Remove-ItemProperty) on the Run key,
// or a wildcard -Name. The one allowed line deletes exactly one named value (asserted above).
assert("provision: does NOT wipe unrelated startup (no whole-key delete / wildcard name)", !/Remove-Item(?!Property)[^\n]*CurrentVersion\\Run/.test(prov) && !/-Name "\*"/.test(prov));
assert("provision: start now, else deterministic next logon", /Start-ScheduledTask -TaskName \$TaskName/.test(prov) && /New-ScheduledTaskTrigger -AtLogOn/.test(prov));
assert("provision: uninstall removes the task", /Unregister-ScheduledTask -TaskName \$TaskName/.test(prov));
assert("provision: fails closed (\\$ErrorActionPreference Stop + throw on missing files)", /\$ErrorActionPreference = "Stop"/.test(prov) && /throw "Missing required file/.test(prov));

// ── electron-builder config ──────────────────────────────────────────────────
const pkg = JSON.parse(read("package.json")) as { build: { nsis: { include?: string }; win: { extraFiles?: Array<{ from: string; to: string }> } } };
assert("pkg: nsis.include = build/installer.nsh", pkg.build.nsis.include === "build/installer.nsh");
assert("pkg: win.extraFiles ships vono-watchdog", !!pkg.build.win.extraFiles?.some((e) => e.from === "resources/vono-watchdog" && e.to === "vono-watchdog"));

// ── watchdog child VONO cwd fix (PR #32) still present ────────────────────────
const observer = read("watchdog/observer.ts");
assert("PR#32 intact: launch uses cwd: path.dirname(execPath)", /cwd: path\.dirname\(execPath\)/.test(observer));

// ── build staged the provisioning scripts into resources/vono-watchdog (run build:watchdog first) ──
const staged = (f: string) => existsSync(path.join(root, "resources", "vono-watchdog", f));
assert("build staged launch-watchdog.ps1 + provision script into resources/vono-watchdog (run build:watchdog)",
  staged("launch-watchdog.ps1") && staged("provision-vono-protection.ps1"),
  "if FAIL: run `npm run build:watchdog` first");

console.log(`\n${pass} passed, ${fail} failed`);
