// A song / playlist / link DROPPED on the player: a Remote (a browser that only controls a branch) must SEND it to the station like a library card's play does — before, it only changed this screen's own queue (owner 2026-11-25).
// Static guard (the behaviour was measured in a two-window browser test: Remote drop -> PLAY_SOURCE sent and the Player switches; Player drop unchanged).
import { readFileSync } from "node:fs";
import path from "node:path";
let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = "") { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); if (cond) pass++; else { fail++; process.exitCode = 1; } }
const rd = (p: string) => readFileSync(path.join(__dirname, "..", p), "utf-8").replace(/\r\n/g, "\n");
const shell = rd("components/app-shell.tsx");

assert("D1 the drop's play is the station-aware one ONLY for a pure controller: not the desktop app, branch connected, not the MASTER; everywhere else it is the provider's playSource as before",
  /const dropDeviceCtx = useDevicePlayer\(\);/.test(shell)
  && /const dropSendsToStation = !isDesktopApp && !!dropDeviceCtx\?\.isBranchConnected && dropDeviceCtx\.deviceMode !== "MASTER";/.test(shell)
  && /const dropPlaySource: typeof playSource = dropSendsToStation && dropDeviceCtx \? dropDeviceCtx\.playSourceOrSend : playSource;/.test(shell));

const a = shell.indexOf("const playDroppedUrl = async (rawUrl: string) => {");
const b = shell.indexOf("// Dedicated branch streamer (GOtv / Android TV)");
const seg = a >= 0 && b > a ? shell.slice(a, b) : "";
assert("D2 every play in the two drop paths (a dropped link, a dropped song / playlist / folder) goes through dropPlaySource — no bare playSource( is left in them", seg.length > 1000 && !/(?<![\w.])playSource\(/.test(seg) && (seg.match(/dropPlaySource\(/g) ?? []).length >= 10, `${(seg.match(/dropPlaySource\(/g) ?? []).length} calls`);

const sm = rd("components/sources-manager.tsx");
assert("D3 it is the same rule the library cards already use (sources-manager: playSourceOverride = playSourceOrSend when a device player, not the MASTER)", /const playSourceOverride = isDevicePlayer && !isMaster \? deviceCtx\?\.playSourceOrSend : undefined;/.test(sm));
console.log(`\n${pass} passed, ${fail} failed`);
