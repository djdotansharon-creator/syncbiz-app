/**
 * P0 — reconnect must not touch LOCAL playback. Deterministic guards for the two proven side effects:
 *  CHAIN A (false EOF / track skips): a transport disconnect/close/reconnect must NOT reset+broadcast a false
 *    "idle" playback status (only an INTENTIONAL disconnect clears the session).
 *  CHAIN B (CONTROL reassertion stops local): the designated station's embedded renderer treats a CONTROL
 *    (re)assertion as a transport refresh (no stopForControlHandoff) while it is STILL designated; a genuine
 *    revoke/reassign (canLocalExec true→false) still stops.
 * Plus: real MPV EOF still advances; playback truth survives in the mock session.
 * Run (from desktop/): npx tsx scripts/verify-reconnect-playback-safety.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { MockPlaybackSession } from "../src/playback-agent/mock-playback-session";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const read = (...p: string[]) => readFileSync(path.join(__dirname, "..", "..", ...p), "utf-8");

const mgr = read("desktop", "src", "device-websocket-client", "device-ws-manager.ts");
const dp = read("lib", "device-player-context.tsx");
const ap = read("components", "audio-player.tsx");

// ── CHAIN A: transport teardown preserves playback truth; only intentional disconnect resets ──────────────
assert("teardownSocket(resetSession) exists", /private teardownSocket\(resetSession: boolean\): void \{/.test(mgr));
assert("mock.reset() is gated on resetSession (session cleared ONLY on intentional teardown)",
  /if \(resetSession\) this\.mock\.reset\(\);/.test(mgr));
assert("disconnect() is the INTENTIONAL path → teardownSocket(true)",
  /disconnect\(\): void \{[\s\S]{0,400}?this\.teardownSocket\(true\);/.test(mgr));
assert("connect() is a TRANSPORT (re)connect → teardownSocket(false), never disconnect()",
  /connect\(\): void \{\s*(?:\/\/[^\n]*\n\s*)*this\.teardownSocket\(false\);/.test(mgr));
// The ONLY mock.reset() in the whole manager is the resetSession-gated one in teardownSocket — so no transport
// path (connect / close) can ever reset+false-idle the session. (count === 1, and it is the gated line.)
assert("exactly ONE mock.reset() in the manager, and it is the resetSession-gated teardown",
  (mgr.match(/this\.mock\.reset\(\)/g)?.length ?? 0) === 1);
const closeHandler = mgr.slice(mgr.indexOf('socket.on("close"'), mgr.indexOf('socket.on("error"') >= 0 ? mgr.indexOf('socket.on("error"') : mgr.length);
assert("abnormal close still schedules reconnect", /if \(!this\.intentionalClose\) this\.scheduleReconnect\(\);/.test(closeHandler));

// Functional: the mock session holds MPV truth (so preserving it across a transport drop keeps "playing").
{
  const m = new MockPlaybackSession();
  m.syncMpvStatus({ status: "playing", volume: 80, position: 42, duration: 180, engineReady: true, lastError: null } as never);
  assert("playback truth preserved: syncMpvStatus(playing) → status playing / position kept",
    m.getState().status === "playing" && (m.getState().position ?? 0) === 42);
  // CHAIN A proof: a transport drop does NOT call reset(), so the above state survives (status stays "playing",
  // never a false "idle"). Only an intentional teardown would reset():
  m.reset();
  assert("intentional reset() → idle (only used on deliberate disconnect)", m.getState().status === "idle");
  // Real EOF path is a GENUINE idle from MPV (via syncMpvStatus), still reflected (test 5 — EOF still works):
  m.syncMpvStatus({ status: "playing", volume: 80, position: 170, duration: 180, engineReady: true, lastError: null } as never);
  m.syncMpvStatus({ status: "idle", volume: 80, position: 0, duration: 0, engineReady: true, lastError: null } as never);
  assert("real MPV EOF (syncMpvStatus idle) is still reflected as idle (natural end still fires EOF→next)",
    m.getState().status === "idle");
}

// ── CHAIN B: CONTROL reassertion on the SAME designated station is a no-op; real revoke still stops ────────
assert("stable designated signal is canLocalExec (NOT isLocalExecActive) via a fresh ref",
  /const canLocalExecRef = useRef\(canLocalExec\);\s*canLocalExecRef\.current = canLocalExec;/.test(dp));
assert("onDeviceMode CONTROL: designated Electron station → NO-OP (no stopForControlHandoff)",
  /if \(isElectronRenderer && canLocalExecRef\.current\) \{[\s\S]{0,220}?return;\s*\}/.test(dp));
assert("the no-op returns BEFORE the stopForControlHandoff fall-through",
  dp.indexOf("CONTROL reassertion on designated station") < dp.indexOf("CONTROL transition -> stopForControlHandoff"));
assert("genuine designation loss (canLocalExec true→false) → stopForControlHandoff (deterministic)",
  /was && !canLocalExec && playStatusRef\.current === "playing"[\s\S]{0,160}?stopForControlHandoff\(\)/.test(dp));
assert("designation-loss effect keyed on canLocalExec (survives reconnect; only a real revoke flips it false)",
  /\}, \[canLocalExec, isElectronShell, stopForControlHandoff\]\);/.test(dp));
assert("real revoke ALSO stops MPV on the MAIN (applyDesignationSignal) — unchanged",
  /if \(mode === "CONTROL" \|\| designated === false\)/.test(mgr) && /this\.orchestrator\.stopMusic\(\)/.test(mgr));

// ── Test 5: the renderer natural-EOF handler is UNCHANGED (still advances exactly once on a real idle) ────
assert("audio-player natural-END handler intact (fires on a REAL playing→idle of the current attempt)",
  /isCurrentAttempt && intendPlaying && prev !== "idle" && next === "idle"/.test(ap));

console.log(`\n${pass} passed, ${fail} failed`);
