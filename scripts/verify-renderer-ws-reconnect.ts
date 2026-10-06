/**
 * RENDERER ZERO-TOUCH WS RECONNECT — deterministic coverage.
 * Before: the renderer device socket only reconnected on focus/visibility/pageshow, so an unattended station
 * stayed disconnected forever after a WS restart / network loss / offline boot.
 *
 *  A  socket close schedules a retry automatically (no focus)       — scheduler behavior (fake timers) + wiring
 *  B  backoff 1→2→4→8→16→30s (+jitter), continues indefinitely      — scheduler behavior
 *  C  successful registration resets/cancels the retry              — scheduler behavior + wiring
 *  D  cleanup / intentional teardown cancels and never reconnects   — scheduler behavior + wiring
 *  E  repeated close/focus/online never create duplicate loops      — scheduler behavior + wiring
 *  F  token network failure retries automatically                   — wiring
 *  G  successful token fetch stops the token retry loop             — wiring
 *  H  renderer REGISTER stays a CONTROL-only embedded renderer      — wiring
 * Run: npx tsx scripts/verify-renderer-ws-reconnect.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createReconnectScheduler, reconnectBackoffMs, RECONNECT_MAX_MS } from "../lib/remote-control/ws-client";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const read = (...p: string[]) => readFileSync(path.join(__dirname, "..", ...p), "utf-8").replace(/\r\n/g, "\n");

// Fake timer harness (deterministic).
function harness(random = () => 0) {
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let nextId = 1;
  let fires = 0;
  const s = createReconnectScheduler({
    onFire: () => { fires++; },
    setTimer: (fn, ms) => { const id = nextId++; timers.set(id, { fn, ms }); return id; },
    clearTimer: (h) => { timers.delete(h as number); },
    random,
  });
  const runAll = () => { const t = [...timers.entries()]; timers.clear(); for (const [, v] of t) v.fn(); };
  return { s, timers, runAll, get fires() { return fires; } };
}

// ── backoff curve ────────────────────────────────────────────────────────────────────────────────────────────
assert("B backoff curve 1,2,4,8,16,30,30s (no jitter)",
  [0, 1, 2, 3, 4, 5, 6, 50].map((a) => reconnectBackoffMs(a, () => 0)).join(",") === "1000,2000,4000,8000,16000,30000,30000,30000");
assert("B jitter is small and bounded (<1s), cap respected",
  reconnectBackoffMs(0, () => 0.999) === 1999 && reconnectBackoffMs(99, () => 0.999) <= RECONNECT_MAX_MS + 999);

// ── A: close → automatic retry (no focus involved) ───────────────────────────────────────────────────────────
{
  const h = harness();
  const d = h.s.scheduleRetry();
  assert("A close schedules ONE timer automatically", d === 1000 && h.timers.size === 1 && h.s.pending);
  h.runAll();
  assert("A timer fires the reconnect", h.fires === 1 && !h.s.pending);
}
// ── B: continues indefinitely with backoff ───────────────────────────────────────────────────────────────────
{
  const h = harness();
  const delays: number[] = [];
  for (let i = 0; i < 200; i++) { delays.push(h.s.scheduleRetry() ?? -1); h.runAll(); }
  assert("B 200 consecutive failures → 200 retries, never gives up", h.fires === 200 && delays.every((x) => x > 0));
  assert("B delays grow then stay capped at 30s", delays.slice(0, 6).join(",") === "1000,2000,4000,8000,16000,30000" && delays.slice(6).every((x) => x === 30000));
}
// ── C: success resets + cancels ──────────────────────────────────────────────────────────────────────────────
{
  const h = harness();
  for (let i = 0; i < 4; i++) { h.s.scheduleRetry(); h.runAll(); }
  h.s.scheduleRetry();
  h.s.connected();
  assert("C successful registration cancels the pending retry", h.timers.size === 0 && !h.s.pending && h.s.attempt === 0);
  assert("C next outage starts again at 1s", h.s.scheduleRetry() === 1000);
}
// ── D: dispose / intentional teardown ────────────────────────────────────────────────────────────────────────
{
  const h = harness();
  h.s.scheduleRetry();
  h.s.dispose();
  assert("D dispose cancels the pending timer", h.timers.size === 0);
  assert("D after dispose no retry can be armed", h.s.scheduleRetry() === null && h.timers.size === 0 && h.fires === 0);
}
// ── E: no duplicate loops ────────────────────────────────────────────────────────────────────────────────────
{
  const h = harness();
  const a = h.s.scheduleRetry();
  const b = h.s.scheduleRetry();
  const c = h.s.scheduleRetry();
  assert("E repeated close events → still ONE timer", a === 1000 && b === null && c === null && h.timers.size === 1);
  h.s.cancelPending(); // a focus/online-triggered socket attempt starts
  assert("E new socket attempt cancels the pending timer (no second socket from the timer)", h.timers.size === 0 && h.fires === 0);
  assert("E cancelPending keeps the backoff level (a failing attempt continues the curve)", h.s.scheduleRetry() === 2000);
}

// ── wiring in the real hook ──────────────────────────────────────────────────────────────────────────────────
const ws = read("lib", "remote-control", "ws-client.ts");
const hookStart = ws.indexOf("export function useRemoteControlWs(");
const hookEnd = ws.indexOf("export function useRemoteController(");
const hook = ws.slice(hookStart, hookEnd);
assert("scheduler created per mount BEFORE the socket effect", hook.indexOf("const scheduler = createReconnectScheduler({") > 0 &&
  hook.indexOf("const scheduler = createReconnectScheduler({") < hook.indexOf("const ws = new globalThis.WebSocket(url);"));
assert("E timer fire reconnects only when no socket is OPEN/CONNECTING",
  /onFire: \(\) => \{\s*const cur = wsRef\.current;\s*if \(cur && \(cur\.readyState === WebSocket\.OPEN \|\| cur\.readyState === WebSocket\.CONNECTING\)\) return;\s*setReconnectTrigger\(\(k\) => k \+ 1\);/.test(hook));
assert("E every new socket attempt cancels a pending retry", /reconnectSchedulerRef\.current\?\.cancelPending\(\);\s*\/\/[^\n]*\n\s*let intentionalClose = false;\s*const ws = new globalThis\.WebSocket\(url\);/.test(hook));
assert("A onclose schedules a retry unless the close was intentional",
  /ws\.onclose = [\s\S]*?if \(!intentionalClose\) \{\s*const delay = reconnectSchedulerRef\.current\?\.scheduleRetry\(\);/.test(hook));
assert("D cleanup marks the close intentional BEFORE closing", /return \(\) => \{\s*intentionalClose = true;\s*ws\.close\(\);/.test(hook));
assert("D unmount disposes the scheduler", /return \(\) => \{\s*scheduler\.dispose\(\);/.test(hook));
assert("C backoff resets only after the server accepted us (REGISTERED / SET_DEVICE_MODE)",
  /if \(data\.type === "REGISTERED" \|\| data\.type === "SET_DEVICE_MODE"\) \{\s*setStatus\("connected"\);[\s\S]{0,300}?reconnectSchedulerRef\.current\?\.connected\(\);/.test(hook));
assert("online is an immediate retry trigger; focus/visibility/pageshow kept",
  /window\.addEventListener\("online", onOnline\);/.test(hook) && /window\.removeEventListener\("online", onOnline\);/.test(hook) &&
  /window\.addEventListener\("focus", onFocus\);/.test(hook) && /document\.addEventListener\("visibilitychange", onVisible\);/.test(hook));
assert("controller / owner hooks untouched by this change", !/reconnectSchedulerRef|createReconnectScheduler\(/.test(ws.slice(hookEnd)));

// ── H: REGISTER payload unchanged (embedded renderer = CONTROL-only, branch "default") ───────────────────────
assert("H device REGISTER still flags the packaged desktop renderer as embeddedRenderer (server forces CONTROL)",
  /embeddedRenderer: options\?\.isDesktopApp === true,/.test(hook) && /branchId: "default",/.test(hook));
const server = read("server", "index.ts");
assert("H server still forces an embedded renderer to CONTROL",
  /embeddedRenderer/.test(server) && /permanent designation: embedded renderer -> CONTROL/.test(server));

// ── F/G: token fetch retry ───────────────────────────────────────────────────────────────────────────────────
const dpc = read("lib", "device-player-context.tsx");
const tok = dpc.slice(dpc.indexOf("let retryAttempt = 0;"), dpc.indexOf("}, [isActive, authLoaded, userId, tokenRefreshTrigger]);"));
assert("F network failure schedules a token retry", /\.catch\(\(\) => \{[\s\S]*?scheduleTokenRetry\("network"\);/.test(tok));
assert("F non-OK (non-401) response schedules a token retry", /if \(!r\.ok\) \{\s*scheduleTokenRetry\(`http_\$\{r\.status\}`\);/.test(tok));
assert("F uses the shared bounded backoff and ONE timer", /const delay = reconnectBackoffMs\(retryAttempt\);/.test(tok) && /if \(cancelled \|\| retryTimer\) return;/.test(tok));
assert("F 401 keeps existing behavior (no retry loop)", /if \(r\.status === 401\) \{\s*setWsToken\(null\);[\s\S]*?return;\s*\}/.test(tok) &&
  !/r\.status === 401\) \{[^}]*scheduleTokenRetry/.test(tok));
assert("G success resets the backoff and sets the token (no further retries scheduled)", /retryAttempt = 0;\s*setWsToken\(data\.token\);/.test(tok));
assert("G cleanup cancels the token retry timer (no parallel loops across re-runs)",
  /return \(\) => \{\s*cancelled = true;\s*if \(retryTimer\) clearTimeout\(retryTimer\);/.test(tok));
assert("only the token effect changed in device-player-context (no playback symbols in the diff region)",
  !/playSource|stopForControlHandoff|onDeviceMode|canLocalExec|mpv/i.test(tok));

console.log(`\n${pass} passed, ${fail} failed`);
