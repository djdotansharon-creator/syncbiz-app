/**
 * 2026-11-09 (CDP React recorder on the live Dev-PC station): the display screen (KioskDisplay) is mounted all the time but
 * shown only when locked; it subscribed to the player's position anyway and redrew ~22× a second while hidden.
 * Rule: it subscribes only while it is up; hidden, a publish costs nothing; it reads the latest value when it opens.
 * Browser harness (real lib/now-position.ts): hidden → 0 redraws for 20 publishes; opening shows the current position; shown →
 * follows every publish. Run: npx tsx scripts/verify-kiosk-position-when-shown.ts
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
const np = read("lib", "now-position.ts");
const kd = read("components", "kiosk-display.tsx");

assert("K1 useNowPosition subscribes only when active (default: active, so other callers are unchanged)",
  /export function useNowPosition\(active = true\): NowPosition \{\n\s*return useSyncExternalStore\(active \? subscribe : subscribeNothing, \(\) => current, \(\) => current\);/.test(np));
assert("K2 the display screen follows the position only while it is shown", /const \[shown, setShown\] = useState\(false\);[\s\S]{0,200}const pos = useNowPosition\(shown\);/.test(kd)
  && (kd.match(/useNowPosition\(/g) ?? []).length === 1);
assert("K3 publishing is unchanged (no listeners → no work)", /if \(current\.position === p && current\.duration === d && current\.status === status\) return;\n\s*current = \{ position: p, duration: d, status \};\n\s*listeners\.forEach\(\(l\) => l\(\)\);/.test(np));

console.log(`\n${pass} passed, ${fail} failed`);
