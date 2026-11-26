// The Schedules page's add-music list and day list (owner 2026-11-26). Static guard; the look was also checked in a browser (black / white look, English / Hebrew, full / light graphics).
import { readFileSync } from "node:fs";
import path from "node:path";
let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = "") { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  - " + detail : ""}`); if (cond) pass++; else { fail++; process.exitCode = 1; } }
const rd = (p: string) => readFileSync(path.join(__dirname, "..", p), "utf-8").replace(/\r\n/g, "\n");
const tsx = rd("components/schedules-studio/schedules-studio.tsx");
const css = rd("app/schedules-studio.css");

assert("K1 the add-music popup has NO title: only the search row on top (a 'Back' button, when choosing a replacement, sits inside that row)", !/<div className="ss-pop-head">/.test(tsx) && /<FilterBar f=\{f\} tr=\{tr\} lead=\{schedule \? <button type="button" className="ss-linkbtn" onClick=\{\(\) => setChoosing\(false\)\}>/.test(tsx));
assert("K2 the kinds are ONE line that scrolls sideways (no wrapping, no scrollbar, it never shrinks in the side panel)", /\.ss-chips \{[^}]*flex: none;[^}]*flex-wrap: nowrap;[^}]*overflow-x: auto;[^}]*scrollbar-width: none;/.test(css) && !/\.ss-chips \{[^}]*flex-wrap: wrap/.test(css));
assert("K3 the chosen kind rides in ONE sliding pill that moves like the display switch's bubble (same curve and squash); the chosen kind scrolls into view inside the row only", /\.ss-chip-slot \{[^}]*transform: translateX\(var\(--px/.test(css) && /transition: transform 900ms cubic-bezier\(0\.16, 0\.9, 0\.18, 1\)/.test(css) && /@keyframes ss-chip-bubble/.test(css) && /row\.scrollTo\(\{ left:/.test(tsx) && /<span className="ss-chip-pill" key=\{f\.kind\} \/>/.test(tsx));
assert("K4 the pill is GLASS only in the full graphics outside the white look, made of gradients and inner light (NO live blur, so it costs nothing); in the light graphics and the white look it is a plain ellipse", /html:not\(\[data-sb-fx="lite"\]\):not\(\[data-sb-display="white"\]\) \.ss-chip-pill \{ background: linear-gradient\(/.test(css) && !/\.ss-chip-pill[^{]*\{[^}]*backdrop-filter/.test(css) && /html\[data-sb-display="white"\] \.ss-chip-pill \{ background: #1c1c1e; \}/.test(css) && /\.ss-chip-pill \{[^}]*border-radius: 999px; background: var\(--ss-fg\)/.test(css));
assert("K5 the day list: the picture and the name at the start edge, the Now / Paused tag next, the hours at the other end (logical columns: right to left too)", /\.ss-ag \{ display: grid; grid-template-columns: 42px minmax\(0, 1fr\) auto 118px;[^}]*padding-inline: 4px 14px;/.test(css) && /\.ss-ag > \.ss-cover \{ grid-column: 1;/.test(css) && /\.ss-ag > \.ss-ag-name \{ grid-column: 2;/.test(css) && /\.ss-ag > \.ss-ag-live \{ grid-column: 3;/.test(css) && /\.ss-ag > \.ss-ag-time \{ grid-column: 4;/.test(css));
assert("K6 the 'schedule is active' question: the blue button does not glow", /\.vono-lp-yes \{ background: #2f7bff; color: #fff; box-shadow: none; \}/.test(rd("components/schedule-live-play-guard.css")));
console.log(`\n${pass} passed, ${fail} failed`);
