/**
 * Performance diagnostic (2026-11-03), source guards — no browser. lib/desktop-perf-diag.ts writes slow clicks / long frames / the hardware into the desktop's
 * main.log as warn lines so a slow pilot PC can be told apart from heavy web code. This guard proves it is READ-ONLY and cannot flood: gated, observers +
 * console.warn only (nothing stored, sent or changed), rate-limited, no page text, mounted once as a null component.
 * Run: npx tsx scripts/verify-perf-diag.ts
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
const lib = read("lib/desktop-perf-diag.ts");
const code = lib.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

assert("D1 it starts only inside the desktop shell or when the browser opted in (localStorage syncbiz-perfdiag = 1); anywhere else it returns a no-op", /if \(started \|\| typeof window === "undefined" \|\| !\(isDesktopShell\(\) \|\| optedIn\(\)\)\) return \(\) => undefined;/.test(code) && /"syncbizDesktop" in window/.test(code) && /getItem\("syncbiz-perfdiag"\) === "1"/.test(code));

assert("D2 read-only: no storage write, no network, no timers that change anything — observers and console.warn only", !/setItem|removeItem|sessionStorage|indexedDB|fetch\(|sendBeacon|XMLHttpRequest|WebSocket|postMessage|setState|dispatchEvent|syncbizDesktop\./.test(code) && /console\.warn\(TAG \+ step/.test(code) && !/console\.(log|info|error)\(/.test(code));

assert("D3 only slow things are written (clicks / key presses >= 120 ms, frames >= 200 ms), at most 12 lines a minute and 300 a session", /EVENT_MIN_MS = 120/.test(code) && /FRAME_MIN_MS = 200/.test(code) && /MAX_LINES_PER_MINUTE = 12/.test(code) && /MAX_LINES_PER_SESSION = 300/.test(code) && /durationThreshold: EVENT_MIN_MS/.test(code) && /if \(ms < FRAME_MIN_MS\) return;/.test(code));

assert("D4 it never reads page text: the button's name is its aria-label / title or its tag + class, never textContent / innerText / value", !/textContent|innerText|innerHTML|\.value\b/.test(code) && /getAttribute\("aria-label"\)/.test(code));

assert("D5 the hardware line names what the owner needs to judge a weak PC: cores, memory, screen, graphics level, look and the GPU's name", ["cores:", "memGB:", "screen:", "fx:", "display:", "gpu:"].every((k) => code.includes(k)) && /WEBGL_debug_renderer_info/.test(code));

const comp = read("components/desktop-perf-diag.tsx");
const prov = read("app/(app)/providers.tsx");
assert("D6 mounted once in the app providers as a component that renders null and only starts / stops the diagnostic", /return null;/.test(comp) && /useEffect\(\(\) => startDesktopPerfDiag\(\), \[\]\)/.test(comp) && (prov.match(/<DesktopPerfDiag \/>/g) ?? []).length === 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
