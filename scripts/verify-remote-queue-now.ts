/**
 * The Remote's live queue (owner 2026-10-30: "the songs in the list aren't updated with what's playing live"): while a Play Next song plays (e.g. the recommended next song), the MASTER's own panel draws it as the
 * "Now playing" row; the Remote must do the same instead of showing the baseline list's highlighted track as "Now playing". Source-text guard (the behaviour was reproduced at runtime with a fake player + a real
 * Remote screen: before the fix the Remote showed "Track 04" while "Recommended A" played). Run: npx tsx scripts/verify-remote-queue-now.ts
 */
import { readFileSync } from "node:fs";

let pass = 0;
let fail = 0;
function assert(name: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (ok) pass++;
  else fail++;
}
const src = readFileSync("components/live-queue-panel.tsx", "utf8");
const a = src.indexOf("const nowPlayingDetached = (() => {");
const body = src.slice(a, src.indexOf("})();", a));
const control = body.slice(body.indexOf("if (isControlMirror) {"), body.indexOf("if (highlightShown && !isPlayNextSourceId(currentSource?.id)) return null;"));
assert("R1 the MASTER's panel detaches the now-playing row when a Play Next song plays (unchanged)", /if \(highlightShown && !isPlayNextSourceId\(currentSource\?\.id\)\) return null;/.test(body));
assert("R2 the Remote does the same, from the MASTER's mirrored current source", /if \(highlightShown && !isPlayNextSourceId\(masterState\?\.currentSource\?\.id\)\) return null;/.test(control));
assert("R3 the Remote's detached row shows the MASTER's live track (title + cover), never the baseline highlight", /const mt = masterState\?\.currentTrack;/.test(control) && /title: mt\?\.title \?\? msrc\?\.title/.test(control));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
