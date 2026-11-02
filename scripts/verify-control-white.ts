/**
 * Static checks for the control area's LIGHT look (owner 2026-11-02: "the control area should follow the white look too").
 * The look lives in ONE file, app/control-white.css, and must touch nothing but the control screens in the white display mode.
 * Run: npx tsx scripts/verify-control-white.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail?: unknown): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || detail === undefined ? "" : `   -> ${JSON.stringify(detail)}`}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const read = (p: string) => readFileSync(path.join(__dirname, "..", p), "utf-8");

const css = read("app/control-white.css");
const layout = read("app/layout.tsx");
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
const rules = [...stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2].trim() }));
/** split a selector list on its TOP-LEVEL commas only (not those inside :is(...) or [...]) */
function splitTop(sel: string): string[] {
  const out: string[] = []; let depth = 0, br = 0, cur = "";
  for (const ch of sel) {
    if (ch === "(") depth++; else if (ch === ")") depth--; else if (ch === "[") br++; else if (ch === "]") br--;
    if (ch === "," && depth === 0 && br === 0) { out.push(cur.trim()); cur = ""; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const SCOPE = 'html[data-sb-display="white"][data-sb-control]';
const selectors = rules.flatMap((r) => splitTop(r.sel));
const has = (re: RegExp) => re.test(css);

// ── 1 · the file, its import and its scope ───────────────────────────────────────────────────────────────────────────
assert("K1 the file exists, has rules, and is imported by the root layout AFTER globals.css, lite-fx.css and white-look.css (same weight → the later file wins)",
  rules.length > 150 && /import "\.\/control-white\.css";/.test(layout)
  && layout.indexOf('import "./globals.css"') < layout.indexOf('import "./lite-fx.css"')
  && layout.indexOf('import "./lite-fx.css"') < layout.indexOf('import "./white-look.css"')
  && layout.indexOf('import "./white-look.css"') < layout.indexOf('import "./control-white.css"'));
assert("K2 it touches ONLY the control screens in the white look: EVERY selector starts with html[data-sb-display=\"white\"][data-sb-control] — the Player, the black look, the 'song' look and every other page cannot change",
  selectors.length > 150 && selectors.every((s) => s.startsWith(SCOPE)), selectors.filter((s) => !s.startsWith(SCOPE)).slice(0, 5));
assert("K3 no rule is written inside an @media / @supports / @container block (a rule there would escape the line-by-line scope check above) and nothing is nested", !/@media|@supports|@container|@layer|@import|@font-face/.test(stripped) && !/&\s*[.:\[]/.test(stripped));
assert("K4 the scope marker is the one the control bar sets while a control screen is open (components/control-screen/control-bar.tsx)",
  /document\.documentElement\.setAttribute\("data-sb-control", "1"\)/.test(read("components/control-screen/control-bar.tsx")) && /removeAttribute\("data-sb-control"\)/.test(read("components/control-screen/control-bar.tsx")));

// ── 2 · Lite graphics: the white look carries no glass and nothing that moves ───────────────────────────────────────────
assert("K5 no glass, no filter, no animation: no backdrop-filter / blur(), no filter other than none, no animation / transition / keyframes / will-change", !/backdrop-filter|blur\(|animation|transition|@keyframes|will-change/i.test(stripped) && !/(^|[^-])filter\s*:\s*(?!\s*none\b)/i.test(stripped), stripped.match(/backdrop-filter|blur\(|animation|transition|will-change|(^|[^-])filter\s*:\s*(?!\s*none\b)[^;]*/i)?.[0]);
assert("K6 plain CSS: no JavaScript hooks, no remote files (the only url() is the inline select-arrow SVG as a data: URI)", !/expression\(|javascript:/i.test(css) && (css.match(/url\(/g) ?? []).every(() => true) && [...css.matchAll(/url\(([^)]*)\)/g)].every((m) => /^["']?data:image\/svg\+xml/.test(m[1])));
assert("K7 every !important lives on a scoped selector (it only beats the dark !important rules of control-skin.css / control-screen.css / lite-fx.css / white-look.css) — none is unscoped", rules.filter((r) => /!important/.test(r.body)).every((r) => splitTop(r.sel).every((s) => s.startsWith(SCOPE))));

// ── 3 · the palette: ink on pearl reads (≥ 4.5:1 for the small-text tones) ────────────────────────────────────────────────
function lum(hex: string): number { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const PAGE = "#eceef1";
assert("K8 the palette is declared once (ink #1c1c1e · second #48484a · quiet #636366 on the pearl #eceef1) and every text tone reads on the page AND on a white card at ≥ 4.5:1",
  has(/--cw-page: #eceef1/) && has(/--sb-text: #1c1c1e/) && has(/--sb-text-secondary: #48484a/) && has(/--sb-text-tertiary: #636366/) && ["#1c1c1e", "#48484a", "#636366"].every((c) => ratio(c, PAGE) >= 4.5 && ratio(c, "#ffffff") >= 4.5),
  ["#1c1c1e", "#48484a", "#636366"].map((c) => [c, +ratio(c, PAGE).toFixed(2)]));
assert("K9 the status colours darkened for light text read on the page and on white at ≥ 4.5:1 (green #0e7434 · amber #8a5a00 · red #b4232f); the primary pill (white on ink / on red) reads too",
  ["#0e7434", "#8a5a00", "#b4232f"].every((c) => ratio(c, PAGE) >= 4.5 && ratio(c, "#ffffff") >= 4.5) && ratio("#ffffff", "#1c1c1e") >= 12 && ratio("#ffffff", "#c4222e") >= 4.5,
  ["#0e7434", "#8a5a00", "#b4232f", "#c4222e"].map((c) => [c, +ratio(c, PAGE).toFixed(2)]));

// ── 4 · the page, the bar, the surfaces ─────────────────────────────────────────────────────────────────────────────────
assert("K10 the control page and the bar are the pearl page (control-screen.css paints them plain black with !important, and the player's header / app column too): the page, the app column and the sticky header are re-painted",
  has(/\[data-control-screen="true"\],\s*html\[data-sb-display="white"\]\[data-sb-control\] \[data-control-screen="true"\] \.app-sources-theme-scope \{ background: #eceef1 !important; background-image: none !important; \}/)
  && has(/\.sb-ctl-bar \{ background: #eceef1; color: #1c1c1e; \}/) && has(/header\.sticky \{ background: transparent !important/));
assert("K11 the dark panels that lite-fx.css (and white-look.css for the jingles console) paint near-black with !important — the map panel, the region / colours / list-size / branch menus, the dialog panel and its dim, the people windows and the join card — are white / pearl here, with their own !important",
  has(/\.cr-map-panel \{ background: linear-gradient\(180deg, #fafafb 0%, #f1f2f5 100%\) !important/)
  && has(/:is\(\.cr-region-menu, \.cr-colors, \.cr-density-menu, \.cr-pop-menu\) \{ background: #ffffff !important/)
  && has(/\.sb-wz-backdrop \{ background: rgba\(236, 238, 241, 0\.82\) !important/) && has(/\.sb-wz-panel \{ background: #ffffff !important/)
  && has(/:is\(\.sb-pg-win, \.sb-jp, \.sb-devdet-panel, \.sb-bp-win\) \{ background: #ffffff !important/)
  && has(/\.jc-workspace-panel \{ background: rgba\(255, 255, 255, 0\.78\)/));
assert("K12 primary buttons are ink pills with white text (the white Broadcast pill, the open tab, 'Save', 'Approve', the main action of every window) and every one of them has a hover (a darker ink)",
  has(/:is\(button, a\)\[class~="bg-white"\] \{ background: #1c1c1e !important; color: #ffffff !important; \}/) && has(/:is\(button, a\)\[class~="bg-white"\]:hover:not\(:disabled\) \{ background: #000000 !important; \}/)
  && has(/\.sb-ph-tab\[aria-selected="true"\] \{ background: #1c1c1e; color: #ffffff; \}/) && has(/\.sb-set-tab\[aria-selected="true"\] \{ background: #1c1c1e; color: #ffffff; \}/)
  && has(/\.sb-pg-btn--main, \.sb-jp-btn--main\) \{ background: #1c1c1e; color: #ffffff; \}/) && has(/\.cr-enr-btn\.is-main \{ background: #1c1c1e; color: #ffffff; \}/));

// ── 5 · branch letter squares ───────────────────────────────────────────────────────────────────────────────────────────
assert("K13 the branch letter squares are BLACK in the light control area (the dark one had white) — no frame; the letter keeps var(--cr-letter-on-black, var(--cr-brand)); calm colours get a neutral light letter; .is-letter only (logos untouched)",
  has(/\.cr-row-logo\.is-letter \{ background: #111111 !important; box-shadow: none; border: 0; \}/)
  && has(/\.cr-row-logo\.is-letter \.cr-row-initial \{ color: var\(--cr-letter-on-black, var\(--cr-brand, #f2f2f7\)\) !important; \}/)
  && has(/\.cr-stage\[data-cr-colors="calm"\] \.cr-row-logo\.is-letter \.cr-row-initial \{ color: rgba\(255, 255, 255, 0\.78\) !important; \}/)
  && !/\.cr-row-logo\.has-logo[^{]*\{[^}]*#111/.test(css));
assert("K14 the amber 'Update' ellipse is not touched (flat, #fbbf24 / #1c1400) — neither .cr-row-update nor the player's .sb-update-pill appear in the file", !/cr-row-update|sb-update-pill/.test(stripped));

// ── 6 · the map ───────────────────────────────────────────────────────────────────────────────────────────────────────────
assert("K15 the Control Room map is light: pale land (the land gradient stops are re-painted), the neutral dot gradient + glow are a visible grey, region labels are ink with a white halo — CSS only (the component is unchanged)",
  has(/#vono-land-fill stop:first-child \{ stop-color: #d9dce3; \}/) && has(/#vono-land-fill stop:last-child \{ stop-color: #c4c8d1; \}/) && has(/#vono-dot-229-229-234 stop:nth-child\(2\) \{ stop-color: #8e8e93; \}/)
  && has(/\.cr-map-panel text \{ fill: #1c1c1e; stroke: rgba\(255, 255, 255, 0\.92\); \}/) && /fill="#2e2e34"|stopColor="#2e2e34"/.test(read("components/control-room/branch-map-v2.tsx")));

// ── 7 · hover (owner's standing rule): the controls that only had white-tint hovers answer on light ─────────────────────────
assert("K16 hover is visible: rows, chips, counters, tabs, menu options, density / region options, tiles and Tailwind hover:bg-white/* all get a grey wash (white tints are invisible on the light page)",
  has(/\.cr-row:hover \{ background: rgba\(0, 0, 0, 0\.055\)/) && has(/\.cr-chip:hover \{ background: rgba\(0, 0, 0, 0\.09\)/) && has(/\.cr-stat:hover:not\(:disabled\) \{ background: rgba\(0, 0, 0, 0\.05\)/)
  && has(/\.sb-ph-tab:hover \{ background: rgba\(0, 0, 0, 0\.11\)/) && has(/\.sb-set-tab:hover \{ background: rgba\(0, 0, 0, 0\.12\)/) && has(/\.sb-pg-tile:hover \{ background: #ffffff/)
  && has(/\[class\*="hover:bg-white\/"\][^{]*:hover:not\(:disabled\) \{ background-color: rgba\(0, 0, 0, 0\.1\)/) && has(/\.sb-ctl-btn:hover \{ color: #1c1c1e; background: rgba\(0, 0, 0, 0\.07\)/));

// ── 8 · nothing else is changed: the other looks keep their own files untouched ───────────────────────────────────────────
const globals = read("app/globals.css");
assert("K17 the existing 'light surface' letter-square rule (white look, NOT the control area) is still there and still excludes the control area — this file only adds the control-area twin", /html\[data-sb-display="white"\]:not\(\[data-sb-control\]\) \.cr-row-logo\.is-letter \{ background: #111111 !important; \}/.test(globals));
assert("K18 the layout imports exactly one new stylesheet and keeps every other import (globals, lite-fx, white-look, kiosk-display, flag-icons)", ["./globals.css", "./lite-fx.css", "./white-look.css", "./control-white.css", "./kiosk-display.css"].every((f) => layout.includes(`import "${f}";`)) && /import "flag-icons\/css\/flag-icons\.min\.css";/.test(layout));

assert("B1 the red count badge on the control bar's tabs: its ring is the colour of the bar (owner 2026-11-02, 'the 2 has a black frame') — pearl on the light control area, pure black on the dark looks",
  /html\[data-sb-display="white"\]\[data-sb-control\] \.sb-ctl-bar \.sb-enr-dot \{ box-shadow: 0 0 0 2px #eceef1; \}/.test(readFileSync(path.join(__dirname, "..", "app/control-white.css"), "utf-8"))
  && /html\[data-sb-control\] \.sb-ctl-bar \.sb-enr-dot \{ box-shadow: 0 0 0 2px #000000; \}/.test(readFileSync(path.join(__dirname, "..", "app/globals.css"), "utf-8")));
assert("B2 a control-room row has no 1px frame on hover / selected in any look — the fill alone says where you are",
  /\.cr-row:hover \{ background: rgba\(255, 255, 255, 0\.065\); \}/.test(readFileSync(path.join(__dirname, "..", "app/globals.css"), "utf-8")) && !/\.cr-row(\.is-selected)?(, \.cr-row\.is-selected:hover)?(:hover)? \{[^}]*inset 0 0 0 1px/.test(readFileSync(path.join(__dirname, "..", "app/globals.css"), "utf-8")));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
