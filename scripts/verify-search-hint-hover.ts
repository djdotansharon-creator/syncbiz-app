/**
 * 2026-11-09 (owner, after a CDP profile of the live station: the search hint's word cycle cost ~0.84 s of every 10 s — each new
 * word read the computed style + width, which recalculated the whole page). Rule: the words cycle ONLY while the pointer is over
 * the search field; otherwise the field shows one still line ("Search or drop URLs") and runs no timers. The direction comes
 * from the <html dir> attribute (what the RTL rules key on), not a style lookup. Browser proof: scratchpad harness (idle: 0
 * timers in 4 s; hover: Music → Artists → Albums; leave: the still line, no more timers).
 * Run: npx tsx scripts/verify-search-hint-hover.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const root = path.join(__dirname, "..");
const read = (...p: string[]) => readFileSync(path.join(root, ...p), "utf-8").replace(/\r\n/g, "\n");
const sh = read("components", "search-hint.tsx");
const code = sh.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
const lia = read("components", "library-input-area.tsx");

assert("H1 the word cycle runs only while animating (pointer over the field)", /if \(rest \|\| !animate \|\| words\.length === 0\) return;/.test(code));
assert("H2 not animating → the still line is what is shown", /const word = animate \? \(words\[i % Math\.max\(1, words\.length\)\] \?\? ""\) : idleText;/.test(code));
assert("H3 no computed-style lookup any more (it recalculated the whole page each word)", !/getComputedStyle/.test(code) && /document\.documentElement\.dir === "rtl"/.test(code));
assert("H4 the library field drives it by pointer hover and shows \"Search or drop URLs\" at rest",
  /onPointerEnter=\{\(\) => setHintHover\(true\)\} onPointerLeave=\{\(\) => setHintHover\(false\)\}/.test(lia)
  && /animate=\{hintHover\}\n\s*idleText="Search or drop URLs"/.test(lia));
assert("H5 focus behaviour unchanged: open field → the hint folds away (rest), and comes back after", /rest=\{showTools\}/.test(lia) && /if \(!rest\) return;\n\s*emptyWait\.current = 820;/.test(code)
  && /if \(rest \|\| animate \|\| phase !== "empty"\) return;/.test(code));

console.log(`\n${pass} passed, ${fail} failed`);
