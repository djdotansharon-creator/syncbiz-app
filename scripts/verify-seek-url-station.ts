/**
 * Seek on a URL / YouTube track in the desktop station's own window (2026-11-03), source guards — no browser. MAIN's WS command handler has no SEEK, so
 * a SEEK sent over the cloud was dropped and the time bar snapped back. lib/device-player-context.tsx `seekOrSend` now seeks the co-located MPV directly
 * (the same bridge the LOCAL path uses) when THIS machine is the branch's designated station; every other window still sends the WS SEEK.
 * Run: npx tsx scripts/verify-seek-url-station.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";

let pass = 0;
let fail = 0;
function assert(name: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (ok) pass++;
  else fail++;
}
const read = (f: string) => readFileSync(path.join(__dirname, "..", f), "utf-8");
const ctx = read("lib/device-player-context.tsx");
const body = /const seekOrSend = useCallback\([\s\S]*?\n  \);/.exec(ctx)?.[0] ?? "";

const iLocal = body.indexOf("if (useLocalDeviceTransport) seekTo(seconds);");
const iDirect = body.indexOf("canLocalExecRef.current");
const iWs = body.indexOf('sendCommandToMaster("SEEK", { position: seconds })');
assert("S1 three paths in this order: the browser's own transport, then the station's co-located MPV, then the WS SEEK to the master (unchanged)", iLocal >= 0 && iDirect > iLocal && iWs > iDirect && /else sendCommandToMaster\("SEEK", \{ position: seconds \}\);/.test(body));

assert("S2 the direct path needs BOTH 'this machine is the designated station' (canLocalExec) AND the desktop bridge's mpvSeekTo — a window that only controls another station, or a browser, never seeks its own MPV", /canLocalExecRef\.current && typeof window !== "undefined" && typeof \(window as unknown as \{ syncbizDesktop\?: \{ mpvSeekTo\?: unknown \} \}\)\.syncbizDesktop\?\.mpvSeekTo === "function"/.test(body));

assert("S3 it calls the same bridge as the LOCAL path (mpvSeekTo), once, and returns nothing the caller depends on", (body.match(/\.mpvSeekTo\(seconds\)/g) ?? []).length === 1 && /void \(window as unknown as/.test(body));

assert("S4 the dependency list is unchanged (the ref is read at call time)", /\[useLocalDeviceTransport, seekTo, sendCommandToMaster\]/.test(body));

const player = read("components/audio-player.tsx");
assert("S5 the LOCAL direct-seek path in the audio player is untouched and the CONTROL commit still goes through seekOrSend", /if \(isDesktopLocal \|\| isDesignatedLocalExec\) \{[\s\S]*?syncbizDesktop\.mpvSeekTo\(\(pct \/ 100\) \* displayDuration\)/.test(player) && /deviceCtx\?\.seekOrSend\(target\)/.test(player));

const ws = read("desktop/src/device-websocket-client/device-ws-manager.ts");
assert("S6 (documents the gap) MAIN's WS handler still has no SEEK case — remote controllers (phone / browser) seeking a URL track need a MAIN change + installer (parked)", !/case "SEEK"/.test(ws));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
