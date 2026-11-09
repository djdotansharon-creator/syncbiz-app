/**
 * Owner 2026-11-09 ("the rising letters — fix it"). PROVEN BY RUNTIME (CDP on the live Dev-PC station, 2026-11-08): the player's
 * title / artist / playlist / "next" lines (RiseText) kept 84 composited layers alive after their rise had ended, because the
 * finished animation stays attached (fill-mode `both`). Rule: when a letter's `sb-rise-up` ends it is marked `data-done` and the
 * CSS removes its animation at the SAME resting place (transform: none) — no visual change, the layer is released.
 * The search hint's fall-away animation must keep winning over that rule. Static pins.
 * Run: npx tsx scripts/verify-rise-text-settle.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const root = path.join(__dirname, "..");
const css = readFileSync(path.join(root, "app", "globals.css"), "utf-8").replace(/\r\n/g, "\n");
const rise = readFileSync(path.join(root, "components", "rise-text.tsx"), "utf-8").replace(/\r\n/g, "\n");

assert("R1 a finished letter rests without an animation, at the animation's own end state (transform: none)",
  /\.sb-rise-l\[data-done\] \{ animation: none; transform: none; \}/.test(css) && /@keyframes sb-rise-up \{ from \{ transform: translateY\(118%\); \} to \{ transform: none; \} \}/.test(css));
assert("R2 only the end of the RISE marks a letter done (not the search hint's fall), and only on a letter element",
  /if \(e\.animationName !== "sb-rise-up"\) return;/.test(rise) && /el\.classList\?\.contains\("sb-rise-l"\)\) el\.dataset\.done = "1"/.test(rise));
assert("R3 one listener on the line itself (animationend bubbles), not one per letter",
  /<span className="sb-rise" [^>]*onAnimationEnd=\{settleLetter\}>/.test(rise) && (rise.match(/onAnimationEnd/g) ?? []).length === 1);
assert("R4 the search hint's fall-away rule is more specific than the done rule, so a word can still fall after it rose",
  /\.sb-sh-word\.is-out \.sb-rise-l \{ transform: none; animation: sb-sh-fall/.test(css));
assert("R5 the rise itself is unchanged (same duration, easing and stagger)",
  /\.sb-rise-l \{ display: inline-block; transform: translateY\(118%\); animation: sb-rise-up 760ms cubic-bezier\(0\.22, 1, 0\.36, 1\) calc\(var\(--rd, 140ms\) \+ var\(--i, 0\) \* 1ms\) both; \}/.test(css));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(process.exitCode ?? 0);
