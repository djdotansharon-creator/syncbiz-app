/**
 * Control Room map size / zoom + Management readability (owner 2026-10-12). Static source checks (the UI itself is
 * verified at runtime on TEST). Run: npx tsx scripts/verify-control-room-map-ux.ts
 */
import { readFileSync } from "fs";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const view = readFileSync("components/control-room/all-branches-view.tsx", "utf8");
const map = readFileSync("components/control-room/branch-map.tsx", "utf8");
const css = readFileSync("app/globals.css", "utf8");
const page = (p: string) => readFileSync(p, "utf8");

assert("M1 three map sizes: Compact 35% / Balanced 50% / Map focus 68%",
  /id: "compact"[^}]*width: "35%"/.test(view) && /id: "balanced"[^}]*width: "50%"/.test(view) && /id: "focus"[^}]*width: "68%"/.test(view));
assert("M2 Balanced is the default; the choice is remembered per viewer (storage errors never break the view)",
  /useState<MapSize>\("balanced"\)/.test(view) && /try \{\s*const v = window\.localStorage\.getItem\(MAP_SIZE_KEY\)/.test(view) && /try \{ window\.localStorage\.setItem/.test(view));
assert("M3 entering a region from Compact opens at least Balanced",
  /const focusRegion = \(id: RegionId\) => \{ setRegionFocus\(id\); if \(mapSize === "compact"\) setMapSize\("balanced"\); \}/.test(view) && /onFocus: focusRegion/.test(view));
assert("M4 zoom controls: + / − / Fit with accessible names, 44 px",
  /aria-label="Zoom in"/.test(map) && /aria-label="Zoom out"/.test(map) && /"Fit the region" : "Fit all Israel"/.test(map) && /h-11 w-11/.test(map));
assert("M5 Ctrl / Cmd + scroll zooms (non-passive listener); a plain scroll still scrolls the page",
  /if \(!e\.ctrlKey && !e\.metaKey\) return;\s*e\.preventDefault\(\);/.test(map) && /addEventListener\("wheel", onWheel, \{ passive: false \}\)/.test(map));
assert("M6 drag pans only while zoomed; a drag never becomes a click; pointer capture can never throw",
  /e\.button === 0 && zoomedIn/.test(map) && /onClickCapture=\{zoomable \?/.test(map) && /try \{ \(e\.currentTarget as SVGSVGElement\)\.setPointerCapture/.test(map));
assert("M7 zoom / pan only on the Control Room map (the Add / Edit preview stays a plain map)", /if \(!zoomable\) return svg;/.test(map) && /const zoomable = !!regions;/.test(map));
assert("A1 readability layer is scoped to the 3 Management pages only",
  page("app/(app)/owner/control-room/page.tsx").includes(`className="mgmt-type `) && page("app/(app)/dashboard/page.tsx").includes(`className="mgmt-type `) &&
  page("app/(app)/access-control/page.tsx").includes(`className="mgmt-type `) && (css.match(/^\.mgmt-type/gm) ?? []).length >= 6 && !/^\s*\.text-xs\s*\{/m.test(css));
assert("A2 secondary text ≥ 14 px; hit areas ≥ 44 px without layout change",
  /\.mgmt-type \.text-xs \{ font-size: 14px;/.test(css) && /top: min\(0px, calc\(50% - 22px\)\)/.test(css) && /min-height: 44px/.test(css));
assert("A3 branch name 16 px; section titles 18–22 px",
  /truncate text-base font-semibold text-\[var\(--sb-text\)\]">\{row\.name\}/.test(view) && /text-xl font-semibold tracking-tight text-\[var\(--sb-text\)\]">Control Room/.test(view) && /text-lg font-semibold text-\[var\(--sb-text\)\]">All Israel/.test(view));
assert("A4 status is never color only: shape glyph in the list + legend, dashed / dotted rings on the map",
  /<StatusGlyph status=\{status\} \/>/.test(view) && /aria-label="Map legend"/.test(view) && /offline: "3 2\.2", install: "1\.2 1\.8"/.test(map) && /strokeDasharray=\{STATUS_DASH\[d\.status\]/.test(map));
console.log(`\n${pass} passed, ${fail} failed`);
