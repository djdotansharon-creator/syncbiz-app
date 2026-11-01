/**
 * Static checks for the white look (owner 2026-11-01: "fix the white completely; there are areas that are not good").
 * The look is finished in ONE file, app/white-look.css, and must touch nothing but the white display mode.
 * Run: npx tsx scripts/verify-white-look.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const read = (p: string) => readFileSync(path.join(__dirname, "..", p), "utf-8");

const css = read("app/white-look.css");
const layout = read("app/layout.tsx");
// every rule: strip comments, split into "selector { body }" blocks (no nesting in this file)
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
const selectors = rules.flatMap((r) => splitTop(r.sel));

assert("W1 the file exists, has rules, and is imported by the root layout right after the other global stylesheets (so at equal weight it wins)", rules.length > 40 && /import "\.\/white-look\.css";/.test(layout) && layout.indexOf('import "./globals.css"') < layout.indexOf('import "./white-look.css"'));
assert("W2 it touches ONLY the white display mode: every selector in the file starts with html[data-sb-display=\"white\"] — the black look, the 'song' look, the control screens and every other page cannot be affected",
  selectors.length > 40 && selectors.every((s) => s.startsWith('html[data-sb-display="white"]')));
assert("W3 the top block is light: header + deck + logo + nav + icons are redrawn (the navy of the dark looks no longer shows through in the light page)",
  /html\[data-sb-display="white"\] header\.sticky \{ background-color: rgba\(247, 248, 251, 0\.94\) !important/.test(css) && /\.library-deck-unified \{ background-color: rgba\(255, 255, 255, 0\.5\) !important/.test(css) && /\.sb-brand-mark \{ background-color: #0b0b0c; \}/.test(css) && /header\.sticky nav a \{ color: rgba\(28, 28, 30, 0\.58\)/.test(css));
assert("W4 the library's near-white texts and icons become ink (#1c1c1e, the ink the existing white rules already use), the quiet tones keep their alpha, and the section titles' !important white is beaten", /\{ color: #1c1c1e; \}/.test(css) && /rgba\(28, 28, 30, 0\.62\)/.test(css) && /library-section-title[^{]*\{ color: #1c1c1e !important; \}/.test(css));
assert("W5 surfaces that are dark in every look are named by their own classes and keep their light text (the search panel, a card with its cover, the dark centre panels), never guessed from an ancestor; coloured buttons keep theirs",
  /:not\(:is\(\.jc-workspace-panel, \.sb-search-panel, \.library-source-card, \.sb-lbc/.test(css) && /\.sb-anim-rise\[class\*="bg-\[#0c0c"\]/.test(css) && /\[class~="bg-white"\]/.test(css));
assert("W6 the jingles console, the one centre panel with no background of its own, becomes a dark glass card (the others already are), and the DJ AI tile a dark feature tile — both keep their light text", /\.jc-workspace-panel \{ background: rgba\(22, 22, 26, 0\.94\)/.test(css) && /\.sb-djl \{ background: linear-gradient\(135deg, #2c2c31, #1c1c1e\)/.test(css));
assert("W7 workspace pages' slate-900 / 800 glass cards become light glass with a hairline, and the accent tints (emerald / sky / amber / rose / violet -200..-400) are darkened to the same hue", /bg-slate-900[^{]*\{ background-color: rgba\(255, 255, 255, 0\.62\) !important; \}/.test(css) && /#0a7d4f/.test(css) && /#0a63b5/.test(css) && /#8a5a00/.test(css) && /#b4232f/.test(css) && /#5b3cc4/.test(css));
assert("W8 nothing in playback, sockets or scripts: the file is plain CSS — no @import, no url(), no JavaScript hooks", !/@import|url\(|expression\(|javascript:/i.test(css));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
