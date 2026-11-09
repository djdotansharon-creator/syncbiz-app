/**
 * Owner 2026-11-08 ("it must run smooth" — the Lenovo). PROVEN BY RUNTIME (CDP on the live Dev-PC station, Library screen, 104 cards):
 * skipping off-screen cards cut the main thread from 9.6 s to 5.5 s busy per 10 s, and the worst freeze from 0.41 s to 0.12 s,
 * with identical screenshots. Rule: library cards use content-visibility:auto (with a remembered intrinsic size); they keep clipping
 * their own content (overflow-hidden), so the containment can never cut anything that showed before. Static pins.
 * Run: npx tsx scripts/verify-library-offscreen-cards.ts
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
const card = readFileSync(path.join(root, "components", "source-card-unified.tsx"), "utf-8");

assert("L1 library cards skip work while off screen", /\.library-source-card \{\n\s*content-visibility: auto;\n\s*contain-intrinsic-size: auto 240px;\n\}/.test(css));
assert("L2 the card already clips its own content (overflow-hidden), so containment adds no clipping",
  /className=\{`library-source-card group [^`]*overflow-hidden/.test(card));
assert("L3 no lite-only scoping — the saving applies in every look (screens are identical)", !/data-sb-fx="lite"\][^{]*\.library-source-card \{\s*content-visibility/.test(css));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(process.exitCode ?? 0);
