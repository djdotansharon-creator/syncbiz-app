/**
 * Owner 2026-11-02 — branch letter squares: WHITE on a dark surface (black look, transparent look, the control room), BLACK on a light
 * surface (white look); no frame; the letter keeps its brand colour (only nudged when it would not read). The "Update" ellipses have their
 * word centred. Run: npx tsx scripts/verify-branch-tiles.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { contrastRatio, readableOn } from "../lib/readable-color";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const rd = (p: string) => readFileSync(path.join(__dirname, "..", p), "utf-8").replace(/\r\n/g, "\n");

// ── the colour helper ──
assert("T1 a colour that already reads is returned UNCHANGED (blue / purple / red on white, yellow on black)", ["#1d4ed8", "#6d4aff", "#f43f5e", "#ef4444"].every((c) => readableOn(c, "#ffffff") === c) && readableOn("#eab308", "#111111") === "#eab308");
const y = readableOn("#eab308", "#ffffff"), g = readableOn("#22c55e", "#ffffff"), p = readableOn("#a78bfa", "#ffffff"), b = readableOn("#1d4ed8", "#111111");
assert("T2 the ones that do not read are nudged until they do (>= 3:1): yellow / green / light purple on white, dark blue on black", [y, g, p].every((c) => contrastRatio(c, "#ffffff") >= 3) && contrastRatio(b, "#111111") >= 3, `${y} ${g} ${p} ${b}`);
assert("T3 …and stay the same hue family (yellow stays yellow: red and green channels dominate blue)", /^#/.test(y) && parseInt(y.slice(1, 3), 16) > parseInt(y.slice(5, 7), 16) && parseInt(y.slice(3, 5), 16) > parseInt(y.slice(5, 7), 16));
assert("T4 not a hex colour → returned as is (never breaks a brand colour in another notation)", readableOn("rgb(1,2,3)", "#fff") === "rgb(1,2,3)" && readableOn("var(--x)", "#fff") === "var(--x)");

// ── the squares ──
const css = rd("app/globals.css");
const view = rd("components/control-room/all-branches-view.tsx");
const tile = rd("components/control-room/logo-tile.tsx");
assert("T5 only tiles WITHOUT a logo carry `is-letter` (list row + the shared LogoTile) and both pass the two readable letter colours",
  /cr-row-logo \$\{logoSrc \? "has-logo" : "is-letter"\}/.test(view) && /cr-row-logo \$\{logoSrc \? "has-logo" : "is-letter"\}/.test(tile) && /--cr-letter-on-white" as string\]: readableOn\(color, "#ffffff"\)/.test(view) && /--cr-letter-on-black" as string\]: readableOn\(color, "#111111"\)/.test(tile));
assert("T6 white square by default (dark surfaces), no border", /\.cr-row-logo\.is-letter \{ background: #ffffff !important; box-shadow: none; border: 0; \}/.test(css));
assert("T7 black square only on a LIGHT surface: the white look outside the control room (which stays dark)", /html\[data-sb-display="white"\]:not\(\[data-sb-control\]\) \.cr-row-logo\.is-letter \{ background: #111111 !important; \}/.test(css));
assert("T8 the letter keeps its brand colour (readable variant for the square it sits on); calm colours → a neutral letter",
  /\.cr-row-logo\.is-letter \.cr-row-initial \{ color: var\(--cr-letter-on-white, var\(--cr-brand/.test(css) && /\[data-sb-control\]\) \.cr-row-logo\.is-letter \.cr-row-initial \{ color: var\(--cr-letter-on-black/.test(css) && /data-cr-colors="calm"\] \.cr-row-logo\.is-letter \.cr-row-initial \{ color: rgba\(0, 0, 0, 0\.72\)/.test(css));
assert("T9 logos are untouched: no rule recolours `.has-logo` / `.is-asis` / `.has-fit` tiles", !/\.cr-row-logo\.(has-logo|is-asis|has-fit)[^{]*\{[^}]*#111111/.test(css));

// ── the "Update" ellipses ──
assert("T10 the control-room pill is 19 px tall (odd → the word lands on whole pixels) with the measured lift in both languages; the header pill likewise",
  /\.cr-row-update \{ display: inline-flex; align-items: center; height: 19px;/.test(css) && /\.cr-row-update \{ padding-bottom: 2px; \}/.test(css) && /\[dir="rtl"\] \.cr-row-update \{ padding-bottom: 4px; \}/.test(css) && /\.sb-update-pill \{ padding-bottom: 2px; \}/.test(css) && /html\[dir="rtl"\] \.sb-update-pill \{ padding-bottom: 4px; \}/.test(css));

console.log(`\n${pass} passed, ${fail} failed`);
