/**
 * STATION STABILITY (owner 2026-10-15, 400-branch network): (1) the schedule poller runs at a FIXED cadence, never per
 * status update; (2) the library always comes up (self-healing load, no button). Static guards.
 * Run: npx tsx scripts/verify-station-load-stability.ts
 */
import { readFileSync } from "fs";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

const sap = read("components/schedule-auto-player.tsx");
assert("S1 schedules are checked every 30 s", /const POLL_MS = 30_000;/.test(sap));
assert("S2 the polling effect depends ONLY on engine on/off + restore (not on per-update handlers)", /\}, \[engineEnabled, isRestoring\]\);/.test(sap) && !/\[engineEnabled, isRestoring, router/.test(sap));
assert("S3 the latest playback handlers are read from a ref when a schedule fires", /const handlersRef = useRef\(/.test(sap) && /const h = handlersRef\.current;/.test(sap));

const smc = read("components/sources-manager-client.tsx");
assert("L1 the library is not loaded through next/dynamic (React.lazy + Suspense can be starved on a busy station)", !/next\/dynamic/.test(smc) && /import\("@\/components\/sources-manager"\)/.test(smc));
assert("L2 a failed load retries by itself with back-off (no button)", /setTimeout\(load, Math\.min\(1000 \* 2 \*\* \(attempt - 1\), 15_000\)\)/.test(smc) && !/<button/.test(smc));
assert("L3 a load that never settles → automatic page reload after the deadline, at most once per 10 min",
  /const LOAD_DEADLINE_MS = 25_000;/.test(smc) && /const RELOAD_COOLDOWN_MS = 10 \* 60 \* 1000;/.test(smc) && /window\.location\.reload\(\)/.test(smc));
assert("L4 once loaded, the auto-reload is cancelled", /if \(deadline\) clearTimeout\(deadline\); \/\/ loaded → never auto-reload/.test(smc));
assert("L5 every failure is logged (desktop: main.log)", (smc.match(/console\.error\("\[VONO library\]/g) ?? []).length === 3);
console.log(`\n${pass} passed, ${fail} failed`);
