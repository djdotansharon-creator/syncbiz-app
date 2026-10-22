/**
 * P0 — Electron MAIN durable WS auto-reconnect. Static, deterministic guards proving the reconnect lifecycle is
 * present and SAFE:
 *  - abnormal close schedules a reconnect; deliberate disconnect / shutdown does NOT
 *  - bounded backoff capped at 30s, retried indefinitely (no permanent give-up / max-attempts cap)
 *  - no duplicate sockets/timers (single pending timer + clean-slate teardown; self-guarded scheduler)
 *  - reuses this.config identity (durable deviceId + latest token) — never mints a new identity
 *  - reconnect/close path never stops the orchestrator/MPV (current LOCAL audio is unaffected)
 *  - intentional shutdown cancels reconnect (before-quit → shutdownStationWs → disconnect)
 * Run (from desktop/): npx tsx scripts/verify-main-ws-reconnect.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const read = (...p: string[]) => readFileSync(path.join(__dirname, "..", "..", ...p), "utf-8");

const mgr = read("desktop", "src", "device-websocket-client", "device-ws-manager.ts");
const ipc = read("desktop", "src", "main", "ipc-mvp.ts");
const idx = read("desktop", "src", "main", "index.ts");

// ── reconnect state + scheduler exist ────────────────────────────────────────────────────────────────────
assert("has intentionalClose flag", /private intentionalClose = false;/.test(mgr));
assert("has single reconnect timer handle", /private reconnectTimer: ReturnType<typeof setTimeout> \| null = null;/.test(mgr));
assert("has reconnectAttempt counter", /private reconnectAttempt = 0;/.test(mgr));
assert("has scheduleReconnect()", /private scheduleReconnect\(\): void \{/.test(mgr));

// ── abnormal close reconnects; the scheduler self-guards against duplicates / live sockets ───────────────
assert("close handler schedules reconnect only when not intentional",
  /if \(!this\.intentionalClose\) this\.scheduleReconnect\(\);/.test(mgr));
assert("scheduleReconnect no-ops on intentional close", /scheduleReconnect\(\): void \{\s*if \(this\.intentionalClose\) return;/.test(mgr));
assert("scheduleReconnect dedupes a pending timer", /if \(this\.reconnectTimer\) return;/.test(mgr));
assert("scheduleReconnect skips when a socket is already OPEN\/CONNECTING",
  /if \(this\.ws && \(this\.ws\.readyState === WebSocket\.OPEN \|\| this\.ws\.readyState === WebSocket\.CONNECTING\)\) return;/.test(mgr));

// ── backoff is bounded AND never gives up (no max-attempts termination) ──────────────────────────────────
assert("backoff capped at 30s", /Math\.min\(30_?000, 1_?000 \* 2 \*\* Math\.min\(attempt, 5\)\)/.test(mgr));
assert("backoff has jitter", /Math\.floor\(Math\.random\(\) \* 1_?000\)/.test(mgr));
assert("no permanent give-up (no MAX_ATTEMPTS / giveUp gate on reconnect)",
  !/MAX_RECONNECT|maxReconnect|giveUp|reconnectAttempt\s*[<>]=?\s*\d/.test(mgr));

// ── intentional disconnect cancels reconnect; connect re-enables it ──────────────────────────────────────
assert("disconnect() sets intentionalClose = true", /disconnect\(\): void \{[\s\S]{0,400}this\.intentionalClose = true;/.test(mgr));
assert("disconnect() clears the reconnect timer", /this\.intentionalClose = true;\s*this\.clearReconnectTimer\(\);/.test(mgr));
assert("connect() re-enables reconnect for the live attempt", /this\.intentionalClose = false;\s*this\.clearReconnectTimer\(\);/.test(mgr));
assert("connect() tears down the old socket first (clean slate, no duplicate)", /connect\(\): void \{\s*(?:\/\/[^\n]*\n\s*)*this\.teardownSocket\(false\);/.test(mgr));
assert("successful open resets the backoff", /socket\.on\("open", \(\) => \{\s*this\.reconnectAttempt = 0;/.test(mgr));

// ── identity reuse: reconnect reuses this.config; never mints a new device id ────────────────────────────
assert("reconnect dials via connect() which reads this.config", /this\.connect\(\); \/\/ reuses this\.config/.test(mgr));
assert("connect() reads identity from this.config (durable id + token)", /const \{ wsUrl, wsToken, deviceId, branchId \} = this\.config;/.test(mgr));
assert("manager never generates a device id (no new durable identity here)", !/randomUUID|newDeviceId|crypto\.randomUUID/.test(mgr));

// ── reconnect/close path must NOT stop the orchestrator/MPV (LOCAL audio unaffected) ─────────────────────
// The close handler + scheduleReconnect must contain no orchestrator stop/kill calls.
const closeToEnd = mgr.slice(mgr.indexOf('socket.on("close"'));
assert("close/reconnect path does not stop or kill MPV/orchestrator",
  !/orch(estrator)?\.(stop|stopMusic|stopInterrupt|kill)\(/.test(closeToEnd) && !/mpv\w*\.(stop|kill)\(/i.test(closeToEnd));

// ── intentional app shutdown cancels reconnect ──────────────────────────────────────────────────────────
assert("ipc-mvp exports shutdownStationWs()", /export function shutdownStationWs\(\): void \{\s*if \(manager\) manager\.disconnect\(\);/.test(ipc));
assert("index imports shutdownStationWs", /import \{[^}]*shutdownStationWs[^}]*\} from "\.\/ipc-mvp";/.test(idx));
assert("before-quit calls shutdownStationWs (both quit branches)", (idx.match(/shutdownStationWs\(\);/g)?.length ?? 0) >= 2);

console.log(`\n${pass} passed, ${fail} failed`);
