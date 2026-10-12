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
assert("M3 entering a region keeps the chosen map size (owner 2026-10-12: Compact stays Compact)",
  view.includes("const focusRegion = (id: RegionId) => setRegionFocus(id);") && !view.includes('setMapSize("balanced")') && /onFocus: focusRegion/.test(view));
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
assert("A3 branch name 18 px (UX round 2026-10-12, was 16); section titles 18–22 px",
  view.includes('truncate text-lg font-semibold text-[var(--sb-text)]" dir="auto">{row.name}') && view.includes('text-xl font-semibold tracking-tight text-[var(--sb-text)]">{L.t("cr.title")}') &&
  view.includes('text-xl font-semibold text-[var(--sb-text)]">{L.t("map.allIsrael")}'));
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
  view.includes('<div dir={L.dir} className="flex h-full min-h-[680px] flex-col overflow-hidden rounded-2xl') && map.includes('items-center justify-center" dir="ltr">') && /rtl:rotate-180/.test(view) &&
  readFileSync("lib/locale-context.tsx", "utf8").includes('document.documentElement.dir = "ltr"'));
console.log(`\n${pass} passed, ${fail} failed`);
// Stage 2 (2026-10-12): Access Control + Dashboard — same dictionary, RTL in Hebrew, owner naming
const ac = readFileSync("components/access-control-console.tsx", "utf8"), dash = page("app/(app)/dashboard/page.tsx");
assert("L3 Access Control: every screen state has dir={L.dir}; Hebrew heading \"ניהול הרשאות\"; never \"בקרת גישה\" / \"הרשאות גישה\"; Dashboard RTL",
  (ac.match(/dir=\{L\.dir\}/g) ?? []).length >= 4 && dict.includes('"ac.title": "ניהול הרשאות"') && !/בקרת גישה|הרשאות גישה/.test(dict + ac) &&
  dash.includes("dir={L.dir}") && dash.includes("const L = mgmt(locale)"));
// UX round 2026-10-12: ONE scroll (the page) — no inner scroll windows in the Control Room; the map column is sticky;
// a region bar in the KPI language; the brand row cannot grow a vertical scrollbar
const bc = readFileSync("components/control-room/broadcast-panel.tsx", "utf8");
// owner 2026-10-12 (round 2): the screen fills the page; ONLY the right-hand table / panel scrolls; map column fixed
const order = ['aria-label={L.t("cr.brandsAria")}', 'aria-label={L.t("cr.kpiAria")}', 'aria-label={L.t("map.regionsAria")}', 'aria-label={L.t("cr.searchAria")}'].map((k) => view.indexOf(k));
assert("U1 one scroll, on the right-hand table only: screen fills the page; list / panels scroll; map column not scrolling; no nested lists in Broadcast",
  view.includes('className="flex h-full min-h-[680px] flex-col overflow-hidden rounded-2xl') && view.includes("grid min-h-0 flex-1") &&
  (view.match(/min-h-0 min-w-0 overflow-y-auto/g) ?? []).length === 4 && view.includes("min-h-0 min-w-0 divide-y divide-[color:var(--sb-border)] overflow-y-auto") &&
  !view.includes("lg:sticky") && !view.includes("max-h-[640px]") && !bc.includes("overflow-y-auto"));
assert("U2 order brands → statuses → regions → search; brands + regions are big tabs with a bar under the chosen one; region clicked again → All Israel",
  order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1])) && view.includes('<FilterTab label={L.t("map.allIsrael")}') &&
  view.includes("regionFocus === r.id ? setRegionFocus(null) : focusRegion(r.id)") && /bar=\{b\.color \?\? "#f5f5f7"\}/.test(view));
console.log(`(+L3) ${pass} passed, ${fail} failed`);
