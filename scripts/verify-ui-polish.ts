/**
 * UI polish (owner 2026-10-28 / 29), source guards — no browser: album rows (the play icon sits ON the song's square, the number stays and is bold), library cards (no corner glyph square, the song count has
 * no dot and sits at the far side), the login screen's soft colourful blurred background (plain gradients, no blur filter), the Hebrew phrase for the count.
 * Run: npx tsx scripts/verify-ui-polish.ts
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
const read = (p: string) => readFileSync(path.join(__dirname, "..", p), "utf8");
const css = read("app/globals.css");
const album = read("components/album-workspace-panel.tsx");
const card = read("components/source-card-unified.tsx");
const login = read("app/login/page.tsx");
const phrases = read("lib/i18n/phrases.ts");

const rowArt = /<span className="sb-alb-art">[\s\S]*?<\/span>\s*<span className="sb-alb-info">/.exec(album)?.[0] ?? "";
const rowN = /<span className="sb-alb-n">[\s\S]*?<\/span>/.exec(album)?.[0] ?? "";
assert("P1 album row: the play icon is on the song's square (inside .sb-alb-art), not on the number", /sb-alb-art-play/.test(rowArt) && !/<svg/.test(rowN));
assert("P2 album row: the number stays on hover and is bold (no fade-out rule, weight >= 600), the square gets the veil + play", !/\.sb-alb-row:hover \.sb-alb-n b[^}]*opacity:\s*0/.test(css) && /\.sb-alb-n b \{[^}]*font-weight:\s*(6|7|8)00/.test(css) && /\.sb-alb-row:hover \.sb-alb-art-play/.test(css) && /\.sb-alb-art::after/.test(css));
assert("P3 library card: the little corner square with a playlist / album icon is gone", !/library-card-playlist-glyph/.test(card));
assert("P4 library card: the song count has no dot and no English 'item' — it is tr(\"{n} songs\") — and sits at the far side, bold", !/· \{itemCount\} item/.test(card) && /tr\("\{n\} songs", \{ n: itemCount \}\)/.test(card) && /\.library-card-platform-line-count[^{]*\{[^}]*margin-inline-start:\s*auto;[^}]*font-weight:\s*700/.test(css));
assert("P5 the Hebrew phrase for the count exists", /"\{n\} songs": "\{n\} שירים"/.test(phrases));
const ambient = /\.vono-ambient \{[^}]*\}/.exec(css)?.[0] ?? "";
assert("P6 the login screen has the soft colourful blurred background: radial gradients only (no blur filter — nothing heavy for a weak graphics card), lighter than before", /radial-gradient/.test(ambient) && !/filter:\s*blur/.test(ambient) && /className="vono-ambient /.test(login) && !/from-slate-950 via-slate-900/.test(login));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
