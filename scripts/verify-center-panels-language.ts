/**
 * 2026-11-10 (owner): the Royalty-Free bank and "My Computer" panels are drawn in Ori's library language — straight on the page, no panel box,
 * no frames inside frames — and follow the screen looks (dark / transparent "song" / white) like the rest of the player.
 * Colours come only from app/center-panels.css tokens (`sb-cp`), so the white look (app/white-look.css) never has to guess.
 * Run: npx tsx scripts/verify-center-panels-language.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const root = path.join(__dirname, "..");
const read = (p: string) => readFileSync(path.join(root, p), "utf-8").replace(/\r\n/g, "\n");
const rfm = read("components/royalty-free-music-workspace-panel.tsx");
const mm = read("components/my-music-library-workspace-panel.tsx");
const css = read("app/center-panels.css");
const layout = read("app/layout.tsx");
// the My Music panel minus its two pop-up dialogs (they stay dark cards on purpose)
const mmChrome = mm.slice(0, mm.indexOf('<div className="sb-anim-rise bg-slate-950 contents">'));
const rfmRender = rfm.slice(rfm.indexOf("const totalSamples = catalog.totalTracks;"));

assert("C1 both panels draw on the page: `sb-cp` root, no panel background or border",
  /<div className="sb-cp sb-anim-rise flex max-h-\[min\(85vh,760px\)\] w-full min-h-0 flex-col gap-4 px-1 pb-1">/.test(rfm)
  && /<div className="sb-cp sb-anim-rise flex h-full min-h-0 flex-col gap-4 px-1 pb-1">/.test(mm)
  && !/bg-\[#0c0c0f\]|border border-white\/\[0\.08\] bg-/.test(rfmRender));
assert("C2 no Tailwind text colours in the panels (they would fight the white look) — tokens only",
  !/\btext-(white|slate-\d+|\[#[0-9a-fA-F]+\]|sky-\d+|cyan-\d+)/.test(rfmRender) && !/\btext-(white|slate-\d+|\[#[0-9a-fA-F]+\]|sky-\d+|cyan-\d+)/.test(mmChrome.slice(mmChrome.indexOf("return (\n    /* 2026-11-10"))));
assert("C3 no frames inside frames: no bordered cards / boxes in the bank render or the My Computer list",
  !/\bborder border-/.test(rfmRender) && !/rounded-(lg|xl) border border-slate/.test(mmChrome.slice(mmChrome.indexOf("return (\n    /* 2026-11-10"))));
assert("C4 text on a picture never uses Tailwind `truncate` (the white look inks it) — it uses sb-cp-clip",
  /sb-cp-on-art sb-cp-clip/.test(rfm) && !/sb-cp-on-art[^"]*\btruncate\b/.test(rfm));
assert("C5 the looks: dark tokens by default, `song` keeps light ink with the player's text shadow, `white` turns the ink dark",
  /html\[data-sb-display="song"\] \.sb-cp \{[^}]*text-shadow/.test(css) && /html\[data-sb-display="white"\] \.sb-cp \{\s*--cp-ink: #1c1c1e;/.test(css));
assert("C6 no backdrop blur / endless animation in the panel styles (cheap in Light graphics)",
  !/backdrop-filter|animation:|infinite/.test(css.replace(/\/\*[\s\S]*?\*\//g, "")));
assert("C7 the stylesheet loads after the white look",
  layout.indexOf('import "./center-panels.css";') > layout.indexOf('import "./white-look.css";') && layout.includes('import "./center-panels.css";'));
assert("C8 the My Music pop-ups stay dark cards in the white look (wrapped in the scope white-look.css leaves alone)",
  /<div className="sb-anim-rise bg-slate-950 contents">\s*\{addModalTarget \?/.test(mm));
assert("C9 behaviour untouched: the same play / add / open handlers are wired",
  /onClick=\{onPlaySamples\}/.test(rfm) && /onClick=\{\(\) => onPlayTrack\(track\)\}/.test(rfm)
  && /void scanAndPlayFolder\(d\.path\);/.test(mm) && /openAddModal\(\{ kind: "folder", path: d\.path, defaultName: d\.name \}\);/.test(mm)
  && /onDoubleClick=\{\(\) => onPlay\(file\.path\)\}/.test(mm) && /setMusicLibraryDragData\(e\.dataTransfer, \{ kind: "folder", path: d\.path \}\)/.test(mm));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(process.exitCode ?? 0);
