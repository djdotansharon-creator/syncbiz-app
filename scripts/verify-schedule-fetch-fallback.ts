/**
 * SCHEDULE ENGINE — last copy decides when the server cannot answer (2026-11-21). Audit finding F3: a 502 / 401 from /api/schedules skipped the cached-schedules
 * fallback (only a THROWN fetch used it), so during a deploy restart or an expired session a block's start / a closing time was not acted on. Now a server answer
 * that means "I cannot tell right now" (5xx, 401, 408, 429) is treated like a down network; a real "no" (400 / 403 / 404) still does nothing; an ok answer is unchanged.
 * Run: npx tsx scripts/verify-schedule-fetch-fallback.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { cachedCopyMayDecide } from "../lib/schedule-fetch-fallback";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const rd = (p: string) => readFileSync(path.join(__dirname, "..", p), "utf-8").replace(/\r\n/g, "\n");

assert("F1 a restarting / broken server (500, 502, 503, 504, 599) lets the last copy decide", [500, 502, 503, 504, 599].every(cachedCopyMayDecide));
assert("F2 an expired session (401), a timeout (408) and too-many-requests (429) do too", [401, 408, 429].every(cachedCopyMayDecide));
assert("F3 a real 'no' — 400, 403, 404, 410, 422 — does NOT (the cloud answered; nothing starts, nothing stops, as before)", [400, 403, 404, 410, 422].every((s) => !cachedCopyMayDecide(s)));
assert("F4 an ok answer and redirects never reach it", [200, 204, 304, 301].every((s) => !cachedCopyMayDecide(s)));

const comp = rd("components/schedule-auto-player.tsx");
const code = comp.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const fetchPart = code.slice(code.indexOf("const res = await fetch(`/api/schedules?branchId="), code.indexOf("// switched back ON"));
assert("F5 the engine asks the rule on a non-ok answer and then takes the SAME fallback as a thrown fetch (one cached-copy path, not a second one)", /if \(!res\.ok\) \{\s*if \(!cachedCopyMayDecide\(res\.status\)\) return;\s*throw new Error/.test(fetchPart) && (fetchPart.match(/readCachedSchedules\(branch\)/g) ?? []).length === 1);
assert("F6 an ok answer is untouched: it still reads the switch header, parses the schedules and refreshes the cached copy", /x-schedule-enabled/.test(fetchPart) && /await res\.json\(\)/.test(fetchPart) && /localStorage\.setItem\(`\$\{SCHEDULES_CACHE_KEY\}/.test(fetchPart));
assert("F7 a window that has NO cached copy still does nothing (the fallback returns when there is none)", /if \(!cached\) return;/.test(fetchPart));
assert("F8 the 36-hour age limit of the cached copy is unchanged", /36 \* 3600_000/.test(comp));
assert("F9 NOTHING playback-related is touched by the rule: the helper imports nothing", !/^import /m.test(rd("lib/schedule-fetch-fallback.ts")));

console.log(`\n${pass} passed, ${fail} failed`);
