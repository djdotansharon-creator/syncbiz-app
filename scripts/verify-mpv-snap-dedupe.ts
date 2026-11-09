/**
 * 2026-11-09 (CDP measurement on the live Dev-PC station, owner-approved fix): the player re-rendered ~17× a second because
 * desktop MAIN pushes a status snapshot on every MPV `time-pos` event while the position it sends is whole seconds — so almost
 * every push repeated the previous values. Rule: every push still feeds the refs (freeze clock, attempt confirmation, startup
 * progress — the playback-safety logic is untouched); only the React state skips a push whose values are identical.
 * Run: npx tsx scripts/verify-mpv-snap-dedupe.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { sameMpvSnap } from "../lib/same-mpv-snap";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const root = path.join(__dirname, "..");
const ap = readFileSync(path.join(root, "components", "audio-player.tsx"), "utf-8").replace(/\r\n/g, "\n");

const base = { status: "playing", volume: 80, position: 391, duration: 4078, catalogCount: 0, engineReady: true, lastError: null as string | null, attemptId: 7, attemptMode: "cold", currentMediaKey: "k1" };
assert("D1 no previous snapshot → draw", sameMpvSnap(null, base) === false);
assert("D2 identical values (a NEW object, as MAIN sends) → skip", sameMpvSnap(base, { ...base }) === true);
assert("D3 any single field change → draw (position, status, duration, volume, attempt, error, media key, engine)",
  (["position", "status", "duration", "volume", "attemptId", "lastError", "currentMediaKey", "engineReady", "attemptMode", "catalogCount"] as const)
    .every((k) => sameMpvSnap(base, { ...base, [k]: k === "status" ? "paused" : k === "lastError" ? "x" : k === "currentMediaKey" ? "k2" : k === "engineReady" ? false : k === "attemptMode" ? "crossfade" : (base[k] as number) + 1 }) === false));
assert("D4 a different key set → draw", sameMpvSnap(base, { ...base, extra: 1 } as typeof base) === false);
assert("D5 NaN equals NaN (Object.is) — a NaN duration repeated is not a change", sameMpvSnap({ ...base, duration: NaN }, { ...base, duration: NaN }) === true);

const applyStart = ap.indexOf("const applySnap = (s: any) => {");
const applyEnd = ap.indexOf("const unsub = desktop.onStatus((s: any) => applySnap(s));");
const apply = ap.slice(applyStart, applyEnd);
assert("D6 setDesktopMpvSnap is called in exactly one place, behind the same-values gate",
  (ap.match(/setDesktopMpvSnap\(/g) ?? []).length === 1
  && /if \(!sameMpvSnap\(lastDrawnSnap, snap\)\) \{\n\s*lastDrawnSnap = snap;\n\s*setDesktopMpvSnap\(snap\);\n\s*\}/.test(apply));
const gateAt = apply.indexOf("if (!sameMpvSnap(");
assert("D7 every push still feeds the safety refs BEFORE the gate (freeze clock, snap ref, confirmation, startup progress)",
  applyStart > 0 && applyEnd > applyStart && gateAt > 0
  && ["desktopSnapPositionAtRef.current = fc.baseline;", "desktopSnapLastPosRef.current = fc.lastPos;", "desktopMpvSnapRef.current = snap;", "attemptConfirmedRef.current = true;", "attemptProgressCountRef.current += 1;"]
    .every((s) => { const i = apply.indexOf(s); return i > 0 && i < gateAt; }));
assert("D8 the gate's memory is per mount (a remount draws its first push)", /let lastDrawnSnap: DesktopMpvSnap \| null = null;\n\s*const applySnap = /.test(ap));
assert("D9 the stale 'playing at 0:00' check keeps its own tick (it no longer gets the repeated pushes)",
  /if \(!desktopZeroWatch\) return;\n\s*const id = setInterval\(\(\) => setDesktopProgressTick\(\(n\) => n \+ 1\), 250\);/.test(ap));

console.log(`\n${pass} passed, ${fail} failed`);
