/**
 * Owner 2026-11-04 (Dev-PC 20:34Z, PROVEN BY RUNTIME): after a restart the one-shot LOCAL restore ("1980's - Easy",
 * saved 6.5 h earlier) awaited the library ~40 s; meanwhile the owner selected a URL playlist (MAIN played it). The
 * restore then autoplayed the old local MP3 over it — speakers = old song, screen = the selection.
 * Rule: a restore that is superseded (a newer playSource, or MAIN now owns a URL session) never replaces the queue /
 * display and never starts. Static pins (the provider is a React effect; runtime acceptance on the station).
 * Run: npx tsx scripts/verify-restore-superseded.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { mainOwnsUrlPlayback } from "../lib/device-mode-guard";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const rd = (p: string) => readFileSync(path.join(__dirname, "..", p), "utf-8").replace(/\r\n/g, "\n");
const pp = rd("lib/playback-provider.tsx");
const dpc = rd("lib/device-player-context.tsx");

assert("G1 the shared MAIN-owns-URL flag exists and defaults to false (browser / no MAIN → unchanged behavior)", mainOwnsUrlPlayback.current === false);
assert("G2 the renderer sets it from EVERY MAIN snapshot (mainUrlAutoAdvance)", /mainOwnsUrlPlayback\.current = s\?\.mainUrlAutoAdvance === true;/.test(dpc));
const ps = pp.slice(pp.indexOf("const playSource = useCallback("), pp.indexOf("const playSource = useCallback(") + 300);
assert("E1 every playSource bumps the play-intent epoch (first statement)", /playIntentEpochRef\.current \+= 1;/.test(ps));
const rs = pp.slice(pp.indexOf('restoreDiag("restoring"') - 900, pp.indexOf('restoreDiag("restoring"'));
assert("E2 the epoch is captured when the restore starts", /const intentEpochAtStart = playIntentEpochRef\.current;/.test(rs));
assert("E3 superseded = a newer selection OR MAIN plays a URL session", /playIntentEpochRef\.current !== intentEpochAtStart \? "a newer selection" : mainOwnsUrlPlayback\.current \? "MAIN plays a URL session" : null/.test(rs));
const iSet = pp.indexOf("recoveryPositionRef.current = persistedV2.positionSeconds;");
const iGuard = pp.lastIndexOf("const newer = supersededBy();", iSet);
assert("R1 checked BEFORE the restore replaces queue / display (setState) — a superseded restore touches nothing", iGuard > 0 && iSet - iGuard < 500);
const iPlay = pp.indexOf("playSourceRef.current(source, effectiveTrackIndex);");
const iGuard2 = pp.lastIndexOf("supersededBy()", iPlay);
assert("R2 checked again right before the autoplay (after the media-token wait)", iGuard2 > 0 && iPlay - iGuard2 < 300);
const iV1 = pp.indexOf("playSourceRef.current(resolvedV1, persistedV1!.trackIndex);");
assert("R3 the legacy V1 restore path is guarded too", pp.lastIndexOf("supersededBy()", iV1) > 0 && iV1 - pp.lastIndexOf("supersededBy()", iV1) < 200);
assert("R4 a superseded restore logs why (grep restore-diag 'skipped: superseded')", (pp.match(/restoreDiag\("skipped: superseded"/g) ?? []).length >= 3);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(process.exitCode ?? 0);
