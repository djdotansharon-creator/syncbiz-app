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
assert("M4 zoom controls: + / − / Fit with accessible names (EN / HE), 44 px",
  map.includes('aria-label={L.t("map.zoomIn")}') && map.includes('aria-label={L.t("map.zoomOut")}') && map.includes('"map.fitRegion" : "map.fitAll"') && /h-11 w-11/.test(map));
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
  view.includes('truncate text-base font-semibold text-[var(--sb-text)]" dir="auto">{row.name}') && view.includes('text-xl font-semibold tracking-tight text-[var(--sb-text)]">{L.t("cr.title")}') &&
  view.includes('text-lg font-semibold text-[var(--sb-text)]">{L.t("map.allIsrael")}'));
// 2026-10-12 owner decision (final): ONE circle per branch — no rings, no badges (300+ branches); status = brand color
// clear (Online) / + slow breathing (Playing) / muted (Offline) / amber (Needs installation), always with a text label
const legendAt = view.indexOf('aria-label={L.t("map.legendAria")}'), mapAt = view.indexOf("<NetworkMap");
assert("A4 single-circle marker (no rings / badges); Playing breathes (off for reduced motion); legend at the TOP of the map",
  /if \(status === "install"\) return \{ fill: INSTALL_COLOR, opacity: 1, breathing: false \}/.test(map) && /if \(status === "offline"\) return \{ fill, opacity: 0\.3/.test(map) &&
  /breathing: status === "playing"/.test(map) && !/strokeDasharray/.test(map) && !/<animate /.test(map) &&
  /@media \(prefers-reduced-motion: reduce\) \{\s*\.vono-breathe \{ animation: none; \}/.test(css) && legendAt > 0 && mapAt > legendAt);
// 2026-10-12 EN / HE + RTL (management only): one dictionary, Hebrew complete, the map never flips
const dict = readFileSync("lib/i18n/management.ts", "utf8");
assert("L1 EN / HE management dictionary: Hebrew typed against English (Record<MgmtKey, string>); owner terms",
  /export const MGMT_HE: Record<MgmtKey, string>/.test(dict) && dict.includes('"nav.accessControl": "הרשאות"') && dict.includes('"map.focus": "מיקוד מפה"') &&
  dict.includes('"region.sharon-shomron": "השרון והשומרון"') && dict.includes('"status.offline": "לא מחובר"') && dict.includes('"cr.clearFilters": "נקה סינונים"'));
assert("L2 RTL only in management (Control Room root dir), the map box stays LTR, back arrows flip",
  view.includes('<div dir={L.dir} className="overflow-hidden rounded-2xl') && map.includes('items-center justify-center" dir="ltr">') && /rtl:rotate-180/.test(view) &&
  readFileSync("lib/locale-context.tsx", "utf8").includes('document.documentElement.dir = "ltr"'));
console.log(`\n${pass} passed, ${fail} failed`);
// Stage 2 (2026-10-12): Access Control + Dashboard — same dictionary, RTL in Hebrew, owner naming
const ac = readFileSync("components/access-control-console.tsx", "utf8"), dash = page("app/(app)/dashboard/page.tsx");
assert("L3 Access Control: every screen state has dir={L.dir}; Hebrew heading \"ניהול הרשאות\"; never \"בקרת גישה\" / \"הרשאות גישה\"; Dashboard RTL",
  (ac.match(/dir=\{L\.dir\}/g) ?? []).length >= 4 && dict.includes('"ac.title": "ניהול הרשאות"') && !/בקרת גישה|הרשאות גישה/.test(dict + ac) &&
  dash.includes("dir={L.dir}") && dash.includes("const L = mgmt(locale)"));
console.log(`(+L3) ${pass} passed, ${fail} failed`);
