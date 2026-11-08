/**
 * Owner 2026-11-08: "the code that measures the player buttons every second — do we need it?" No.
 * PROVEN BY RUNTIME (CDP invalidation trace on the live Dev-PC station):
 * - The transport row's 1 s safety-net timer read the layout.
 * - Each read forced a whole-page style recalculation (~300 ms over ~6,500 elements).
 * Rule: no timer; the position follows ResizeObservers (row, its parent, the cluster, the deck grid), window resize, and fonts ready.
 * Run: npx tsx scripts/verify-transport-no-timer.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const src = readFileSync(path.join(__dirname, "..", "components", "player-surface", "player-deck-transport-surface.tsx"), "utf-8").replace(/\r\n/g, "\n");
const eff = src.slice(src.indexOf("const rowRef = useRef<HTMLDivElement | null>(null);"), src.indexOf("return (\n    <div className=\"player-transport-dock"));

assert("T1 no repeating timer measures the layout any more", !/setInterval\(/.test(eff));
assert("T2 still re-measured when the row, its parent, the button cluster or the deck grid change size",
  /ro\?\.observe\(row\);/.test(eff) && /ro\.observe\(row\.parentElement\)/.test(eff) && /if \(ro && cluster\) ro\.observe\(cluster\);/.test(eff) && /if \(ro && grid\) ro\.observe\(grid\);/.test(eff));
assert("T3 still re-measured on window resize and once the fonts are ready", /window\.addEventListener\("resize", apply\);/.test(eff) && /document\.fonts\.ready\.then\(\(\) => apply\(\)\)/.test(eff));
assert("T4 the centring math itself is unchanged (PLAY on 50vw, clamped wing)", /const vwCenter = window\.innerWidth \/ 2;/.test(eff) && /const MIN_WING_PX = 64;/.test(eff) && /row\.style\.setProperty\("--sb-tr-col1", next\)/.test(eff));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(process.exitCode ?? 0);
