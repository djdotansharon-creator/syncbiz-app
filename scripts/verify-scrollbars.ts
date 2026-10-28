/**
 * Scroll bars (owner 2026-10-27): on Windows Chrome they showed as always-visible slate-blue bars (one looked like a blue stripe in the right rail). Chrome ignores every ::-webkit-scrollbar
 * rule while scrollbar-width / scrollbar-color are set, so the colours on `*` are the ones that count: a faint neutral thumb on a transparent track.
 * Run: npx tsx scripts/verify-scrollbars.ts
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
const css = readFileSync(path.join(__dirname, "..", "app", "globals.css"), "utf8");
const root = /:root\s*\{[^}]*--sb-scrollbar-thumb:[^}]*\}/.exec(css)?.[0] ?? "";
const star = /\*\s*\{\s*scrollbar-width:\s*thin;\s*scrollbar-color:\s*var\(--sb-scrollbar-thumb\)\s+var\(--sb-scrollbar-track\);\s*\}/.test(css);

assert("S1 the track is transparent (no dark-blue stripe on Windows)", /--sb-scrollbar-track:\s*transparent;/.test(root));
assert("S2 the thumb is a faint neutral grey (equal-ish red / green / blue, translucent) — readable on the black and on the white display", (() => { const m = /--sb-scrollbar-thumb:\s*rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(root); if (!m) return false; const [r, g, b, a] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])]; return Math.max(r, g, b) - Math.min(r, g, b) <= 30 && a >= 0.3 && a <= 0.6; })());
assert("S3 no slate-blue scroll bar colour is left in the variables (the old 100,116,139 thumb / 2,6,23 track)", !/100,\s*116,\s*139|2,\s*6,\s*23/.test(root));
assert("S4 the page-wide rule still hands the colours to every scroller (thin, thumb + track from the variables)", star);

// ── 2026-10-28: the library workspace shows NO scroll bar at all (owner's Windows screenshots: a stripe through the DJ AI card = the centre grid's bar seen through the glass right rail, plus grey bars on the rail lists) ──
const src = readFileSync(path.join(__dirname, "..", "components", "sources-manager.tsx"), "utf8");
assert("S5 the library workspace grid (rails + centre) hides every scroll bar inside it — both the standard property and the WebKit pseudo-element", /\.workspace-rail-grid,\s*\.workspace-rail-grid \*\s*\{\s*scrollbar-width:\s*none;/.test(css) && /\.workspace-rail-grid \*::-webkit-scrollbar\s*\{\s*display:\s*none;/.test(css));
assert("S6 the grid that carries that rule is the one the rails, the centre grid, the playlist list and the DJ AI launcher live in", /className="workspace-rail-grid /.test(src) && /className="sb-glow-scroll /.test(src) && src.indexOf('className="workspace-rail-grid ') < src.indexOf('className="sb-glow-scroll ') && src.indexOf('className="workspace-rail-grid ') < src.indexOf("<DjCreatorAiShell") && src.indexOf('className="sb-glow-scroll ') < src.lastIndexOf("<DjCreatorAiShell"));
assert("S7 the page, the Control Room and the admin screens are NOT silenced (the hiding rule is scoped to the workspace grid only)", !/(^|\n)\s*(html|body|\*)\s*\{[^}]*scrollbar-width:\s*none/.test(css));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
