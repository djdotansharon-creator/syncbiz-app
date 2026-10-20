/**
 * USER-FACING MASTER / CONTROL station badge (DISPLAY ONLY).
 *  A designated Electron station → MASTER (green)
 *  B designated station never shows CONTROL as the primary badge (even though its renderer socket is CONTROL)
 *  C designated station never shows Standalone (even when its renderer socket is disconnected / offline)
 *  D non-designated Electron → CONTROL when connected
 *  E browser CONTROL stays CONTROL (and legacy browser MASTER keeps the previous red badge)
 *  F startup before MAIN status resolves shows nothing (no MASTER/CONTROL flash)
 * plus static guards: canLocalExec unchanged, renderer REGISTER unchanged, display-only wiring.
 * Run: npx tsx scripts/verify-station-badge.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { resolveStationBadge } from "../components/station-badge-logic";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const read = (...p: string[]) => readFileSync(path.join(__dirname, "..", ...p), "utf-8").replace(/\r\n/g, "\n");

const station = {
  isActive: true, isElectronShell: true, isDesignatedAudioStation: true, mainSnapResolved: true,
  isBranchConnected: true, isObserverOnlyBrowser: false, deviceMode: "CONTROL", hasExistingMaster: true, isPlaying: true,
};
const devPc = { ...station, isDesignatedAudioStation: false };
const browser = { ...station, isElectronShell: false, isDesignatedAudioStation: false, mainSnapResolved: false };

// A
const a = resolveStationBadge(station);
assert("A designated station (renderer socket CONTROL) → MASTER, 'Playing store audio'", a.kind === "station-master" && a.subline === "Playing store audio");
assert("A designated station not playing → MASTER, 'Store audio station'",
  (() => { const b = resolveStationBadge({ ...station, isPlaying: false }); return b.kind === "station-master" && b.subline === "Store audio station"; })());
// B
const combos = [
  { deviceMode: "CONTROL", hasExistingMaster: true }, { deviceMode: "CONTROL", hasExistingMaster: false },
  { deviceMode: "MASTER", hasExistingMaster: false },
].flatMap((m) => [true, false].flatMap((conn) => [true, false].map((obs) => ({ ...station, ...m, isBranchConnected: conn, isObserverOnlyBrowser: obs }))));
assert("B designated station NEVER shows CONTROL (all socket/connection combos)", combos.every((c) => resolveStationBadge(c).kind === "station-master"));
// C
assert("C designated station NEVER shows Standalone (renderer socket disconnected / offline boot)",
  resolveStationBadge({ ...station, isBranchConnected: false, isPlaying: true }).kind === "station-master" &&
  resolveStationBadge({ ...station, isBranchConnected: false, isPlaying: false }).kind === "station-master");
// D
const d = resolveStationBadge(devPc);
assert("D non-designated Electron (connected) → CONTROL 'Controlling: Branch Master'", d.kind === "control" && d.subline === "Controlling: Branch Master");
assert("D non-designated Electron disconnected → Standalone (previous behavior)", resolveStationBadge({ ...devPc, isBranchConnected: false }).kind === "standalone");
// E
assert("E browser CONTROL stays CONTROL", resolveStationBadge(browser).kind === "control");
assert("E browser CONTROL without a master → CONTROL, no 'Controlling' sub-line",
  (() => { const b = resolveStationBadge({ ...browser, hasExistingMaster: false }); return b.kind === "control" && b.subline === null; })());
assert("E legacy browser MASTER (non-designated branch) keeps the previous red MASTER badge", resolveStationBadge({ ...browser, deviceMode: "MASTER" }).kind === "ws-master");
assert("E observer-only browser route: hidden when connected, Standalone when not (previous behavior)",
  resolveStationBadge({ ...browser, isObserverOnlyBrowser: true }).kind === "hidden" &&
  resolveStationBadge({ ...browser, isObserverOnlyBrowser: true, isBranchConnected: false }).kind === "standalone");
assert("E inactive device → hidden", resolveStationBadge({ ...browser, isActive: false }).kind === "hidden");
// F
assert("F Electron before MAIN status → hidden (no CONTROL / Standalone / MASTER flash)",
  resolveStationBadge({ ...station, isDesignatedAudioStation: false, mainSnapResolved: false }).kind === "hidden" &&
  resolveStationBadge({ ...station, isDesignatedAudioStation: false, mainSnapResolved: false, isBranchConnected: false }).kind === "hidden" &&
  resolveStationBadge({ ...station, isDesignatedAudioStation: true, mainSnapResolved: false }).kind === "hidden");

// ── static guards ───────────────────────────────────────────────────────────────────────────────────────────
const dpc = read("lib", "device-player-context.tsx");
assert("canLocalExec definition unchanged",
  /const canLocalExec = isElectronShell === true && \(localMainCommandReady \|\| localMainDesignatedOffline\);/.test(dpc));
assert("context exposes isDesignatedAudioStation = canLocalExec and mainSnapResolved (read-only, memo deps updated)",
  /isDesignatedAudioStation: canLocalExec,\s*mainSnapResolved,/.test(dpc) && /localExecCurrent,\s*canLocalExec,\s*mainSnapResolved,/.test(dpc));
const ws = read("lib", "remote-control", "ws-client.ts");
assert("renderer REGISTER unchanged (embedded renderer → CONTROL-only, branch default)",
  /embeddedRenderer: options\?\.isDesktopApp === true,/.test(ws));
const ind = read("components", "device-mode-indicator.tsx");
const sa = read("components", "standalone-indicator.tsx");
assert("indicators are display-only (no commands / WS / playback mutations)",
  ![ind, sa].some((src) => /sendCommandToMaster|sendSetMaster|sendSetControl|playOrSend|stopOrSend|\.play\(|\.stop\(|setState|syncbizDesktop\.[a-z]+\(/.test(src)));
assert("both header chips use the single shared decision", /resolveStationBadge\(/.test(ind) && /useStationBadge\(\)/.test(sa));

console.log(`\n${pass} passed, ${fail} failed`);
