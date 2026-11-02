/**
 * Owner 2026-11-02 — the Player screen has NO resting frames; only what the pointer is on gets a tiny 1px line (white on the dark looks, ink on the white look).
 * Run: npx tsx scripts/verify-no-frames.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const css = readFileSync(path.join(__dirname, "..", "app/globals.css"), "utf-8").replace(/\r\n/g, "\n");
const block = css.slice(css.indexOf("/* ── The Player screen has NO resting frames"));

assert("N1 the block exists and is the LAST thing in globals.css (it wins by order)", block.length > 200 && block.length < css.length / 4);
const rules = block.split("\n").filter((l) => /^html/.test(l));
assert("N2 every rule is scoped to the Player screen: html:not([data-sb-control]) — the control area is untouched", rules.length >= 8 && rules.every((l) => /^html(\[data-sb-display="white"\])?:not\(\[data-sb-control\]\)/.test(l)));
assert("N3 resting: only colours become transparent (never width / display / margin — nothing can move): search box rings, nav links, cards, section canvas, the deck's border in the white look",
  /\.library-sources-input-shell \{ outline-color: transparent !important; \}/.test(block) && /\.library-sources-input-shell::before \{ border-color: transparent !important; \}/.test(block) && /\.sb-library-ingest-shell \{ border-color: transparent !important; \}/.test(block)
  && /:is\(\.library-nav-link, \.library-source-card, \.library-sections-canvas\) \{ border-color: transparent !important; \}/.test(block) && /\.library-deck-unified, \.library-nav-link, \.library-source-card, \.library-sections-canvas\) \{ border-color: transparent !important; \}/.test(block)
  && !/(width|height|margin|padding|display|position)\s*:/.test(block.replace(/outline-offset: -1px;/g, "")) );
assert("N4 hover / keyboard focus: ONE 1px line as an outline (keeps shadows and glass, moves nothing) — white .62 on the dark looks, ink .42 on the white look",
  /:is\(:hover, :focus-visible\) \{ outline: 1px solid rgba\(255, 255, 255, 0\.62\) !important; outline-offset: -1px; \}/.test(block) && /outline-color: rgba\(28, 28, 30, 0\.42\) !important/.test(block));
assert("N5 the line goes on what can be pressed: nav links, cards, playlist tiles, Add tile, DJ AI, the command-rail buttons — and the search box gets it on its inner ring (hover / focus)",
  ["library-nav-link", "library-source-card", "sb-pl-row", "sb-pl-add", "sb-djl", "library-command-rail-guest-my button", "library-command-rail-browse button"].every((c) => block.includes(c)) && /library-sources-input-shell:is\(:hover, :focus-within\) \.sb-library-ingest-shell \{ border-color: rgba\(255, 255, 255, 0\.62\)/.test(block));
console.log(`\n${pass} passed, ${fail} failed`);
