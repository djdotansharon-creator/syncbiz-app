/**
 * THE PLAYLIST SCREEN SITS ON THE PAGE'S OWN SURFACE (owner 2026-11-25: "it is still inside a whiter square"; "wider, higher, bigger"; "no black gap at the top of the cover"). Static CSS guard; the runtime proof is the
 * browser check (canvas has no fill/border/shadow in black + white, the cover and the song pictures are 16:9). Run: npx tsx scripts/verify-playlist-screen-surface.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const css = readFileSync(path.join(__dirname, "..", "app/globals.css"), "utf-8");
assert("P1 in the black and white looks the library canvas (the panel behind the playlist screen and the cards) has no fill, border, shadow or corners — one background; the transparent look keeps its glass tint", /html\[data-sb-display="white"\] \.library-sections-canvas, html\[data-sb-display="black"\] \.library-sections-canvas \{ background: none !important; box-shadow: none !important; border: 0 !important; border-radius: 0; padding-inline: 4px; padding-top: 0; \}/.test(css) && !/html\[data-sb-display="song"\] \.library-sections-canvas \{ background: none/.test(css));
assert("P2 the cover is a 16:9 rectangle (272 × 153) — a YouTube still's black bars are cropped by `cover` — and the song pictures are 112 × 63 (16:9), not squares", /\.library-sections-canvas \.sb-alb-pl \.sb-alb-cover \{ width: 272px; height: 153px;/.test(css) && /\.library-sections-canvas \.sb-alb-pl \.sb-alb-art \{ width: 112px; height: 63px;/.test(css) && /grid-template-columns: 68px 112px minmax\(0, 1fr\)/.test(css));
assert("P3 higher and bigger: no top padding on the canvas or the head, title 36px, song names 17px", /padding-top: 0; \}/.test(css) && /\.sb-alb-head \{ padding-top: 0; gap: 26px; \}/.test(css) && /\.sb-alb-titles h2 \{ font-size: 36px; \}/.test(css) && /\.sb-alb-name \{ font-size: 17px; \}/.test(css));
assert("P4 the white look's close (×) is dark ink", /html\[data-sb-display="white"\] \.library-sections-canvas \.sb-alb-head \.sb-wz-x \{ color: rgba\(28, 28, 30, 0\.55\); \}/.test(css));
console.log(`\n${pass} passed, ${fail} failed`);
