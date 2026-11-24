/**
 * THE LIBRARY'S FIRST LOAD, ITS EMPTY MESSAGE, AND ONE SURFACE (owner 2026-11-24). Static wiring + CSS rules; the runtime proof is the browser check (loader → message, frameless in all three looks, ONE surface). Run: npx tsx scripts/verify-one-surface.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const rd = (p: string) => readFileSync(path.join(__dirname, "..", p), "utf-8").replace(/\r\n/g, "\n");

const sm = rd("components/sources-manager.tsx");
assert("L1 the 'no sources yet' message is shown only after the FIRST list has arrived (or failed): the flag starts true only when the page came with sources, and every fetch ends by setting it", /const \[sourcesFirstLoadDone, setSourcesFirstLoadDone\] = useState\(initialSources\.length > 0\);/.test(sm) && /\.finally\(\(\) => setSourcesFirstLoadDone\(true\)\)/.test(sm) && /sourcesLoading=\{!sourcesFirstLoadDone\}/.test(sm));
assert("L2 while it is on its way the library shows the loader (glow + ring, a status for screen readers) and NOT the message", /sourcesLoading \? \(\s*<div className="library-loading" role="status" aria-live="polite" aria-label=\{t\.loadingLibrary\}>\s*<span className="library-loading-glow" aria-hidden \/>\s*<span className="library-loading-ring" aria-hidden \/>/.test(sm));
const tr = rd("lib/translations.ts");
assert("L3 the loader's label exists in both languages", /loadingLibrary: "Loading…"/.test(tr) && /loadingLibrary: "טוען…"/.test(tr));
const css = rd("app/globals.css");
assert("C1 the loader spins and breathes (and slows down for people who asked for less motion)", /\.library-loading-ring \{[^}]*animation: sb-lib-spin 0\.85s linear infinite/.test(css) && /@keyframes sb-lib-spin/.test(css) && /prefers-reduced-motion: reduce\) \{ \.library-loading-ring/.test(css));
assert("C2 the empty message is text on the background in every look: no border, no fill, no shadow, no plate", /html \.library-empty-state \{ border: 0; background: none; box-shadow: none; \}/.test(css) && /html \.library-empty-icon-plate \{ border: 0; background: none; box-shadow: none; \}/.test(css));
assert("C3 the search results never let the library's message (or loader) show through", /body:has\(\.sb-search-panel\) :is\(\.library-empty-state, \.library-loading\) \{ visibility: hidden; \}/.test(css));
assert("C4 ONE surface: no gradient panel under the library in any look; the top zone casts no shadow or border line (it must beat white-look's !important rule, hence :root)", /html\[data-sb-display\] \.library-theme\.library-page-shell \{ background: none; \}/.test(css) && /html\[data-sb-display\]:root header\.sticky \{ box-shadow: none !important; border-bottom-color: transparent !important; \}/.test(css) && /html\[data-sb-display="white"\]:root header\.sticky \{ background-color: #eceef1 !important; \}/.test(css));
assert("C5 the two zones meet in ONE soft hairline that does not reach the edges and fades out at both ends (dark line in the white look, light line otherwise)", /header\.sticky::after \{ content: ""; position: absolute; inset-inline: 7%; bottom: 0; height: 1px;[^}]*linear-gradient\(90deg, transparent 0%/.test(css) && /html\[data-sb-display="white"\] header\.sticky::after \{ --sb-seam: rgba\(0, 0, 0, 0\.13\); \}/.test(css));
const rb = rd("components/remote-bar/remote-bar.css");
assert("R1 the Remote strip no longer stays a black band in the white look: the page's colour, dark ink, a dark logo, readable state lines — and it carries the same fading hairline in every look", /html\[data-sb-display="white"\] \.sb-rb \{ background: #eceef1; color: #1c1c1e;/.test(rb) && /html\[data-sb-display="white"\] \.sb-rb \.sb-brand-mark \{ background-color: #0b0b0c; \}/.test(rb) && /\.sb-rb::after \{ content: ""; position: absolute; inset-inline: 7%; bottom: 0; height: 1px;/.test(rb));
console.log(`\n${pass} passed, ${fail} failed`);
