/**
 * Owner 2026-11-04 (Dev-PC 21:27Z, PROVEN BY RUNTIME): a click within seconds of opening the desktop app met the Electron
 * "MASTER" default (the server had not decided the screen's role yet) → the renderer played the URL itself (PLAY_REQUEST
 * attempt 1), stopped MAIN's session, kept MAIN's old title on screen, then went silent at that song's end.
 * Rule: before the FIRST role decision, a non-local selection in the desktop app is held and released through the
 * normal routing once the role is known (or after EARLY_SELECT_MAX_MS the old way). Static pins on the provider.
 * Run: npx tsx scripts/verify-early-select-hold.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const src = readFileSync(path.join(__dirname, "..", "lib", "device-player-context.tsx"), "utf-8").replace(/\r\n/g, "\n");
const pso = src.slice(src.indexOf("const playSourceOrSend = useCallback("), src.indexOf("const playSourceOrSendRef = useRef("));

assert("H1 'role decided' = the server decided at least once (a remembered mode) or decides now — reconnect blips are NOT a hold window",
  /const roleDecided = lastConnectedModeRef\.current !== null \|\| \(status === "connected" && modeAssigned\);/.test(src));
assert("H2 held ONLY in the desktop app, never for the phone's local playback, only before the first decision",
  /const holdEarlySelect = isElectronShell === true && !isMobileLocalPlayback && !roleDecided;/.test(src));
assert("H3 the hold is the FIRST check, only on the local-transport path, never for a LOCAL source, and skipped while a held one is released",
  /if \(useLocalDeviceTransport && holdEarlySelect && !releasingEarlySelectRef\.current && source\?\.type !== "local"\) \{/.test(pso) && pso.indexOf("holdEarlySelect && !releasing") < pso.indexOf("localSessionOwnedRef.current = true;"));
assert("H4 a held selection never plays and never changes the session (it returns before any ref / playSource)",
  /earlySelectRef\.current = \{ source, trackIndex, at: Date\.now\(\) \};[\s\S]{0,300}setEarlySelectTick\(\(t\) => t \+ 1\);\n\s*return;/.test(pso));
assert("R1 released through the NORMAL routing once decided (MASTER → here; CONTROL → only when the MASTER's id is known)",
  /if \(roleDecided && \(effectiveDeviceMode === "MASTER" \|\| !!masterDeviceId\)\) \{ release\("role decided"\); return; \}/.test(src));
assert("R2 never held forever: after EARLY_SELECT_MAX_MS it plays the old way (no cloud at all)",
  /setTimeout\(\(\) => release\("timeout"\), Math\.max\(0, EARLY_SELECT_MAX_MS - \(Date\.now\(\) - held\.at\)\)\)/.test(src) && /const EARLY_SELECT_MAX_MS = 12_000;/.test(src));
assert("R3 the release re-enters playSourceOrSend once, flagged so it is never held again (one code path for every outcome)",
  /releasingEarlySelectRef\.current = true;\n\s*try \{\n\s*playSourceOrSendRef\.current\(held\.source, held\.trackIndex\);\n\s*\} finally \{\n\s*releasingEarlySelectRef\.current = false;/.test(src));
assert("R4 one pending selection at most — a release only fires for the selection it was armed for",
  /if \(earlySelectRef\.current !== held\) return;\n\s*earlySelectRef\.current = null;/.test(src));
assert("U1 the existing local-transport branch body is unchanged (refs + playSource)",
  /if \(useLocalDeviceTransport\) \{\n\s*localSessionOwnedRef\.current = true;\n\s*lastLocalPushKeyRef\.current = null;[^\n]*\n\s*localUserIntentRef\.current = true;[^\n]*\n\s*lastSentUrlLeafRef\.current = null;\n\s*setUrlTransition\(null\);[^\n]*\n\s*playSource\(source, trackIndex \?\? 0\);/.test(pso));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(process.exitCode ?? 0);
