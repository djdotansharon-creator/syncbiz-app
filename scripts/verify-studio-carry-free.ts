// A carried block floats above the borders in BOTH directions (owner 2026-11-26). Static guard; checked in a browser (Week view: a block carried to the far left, the far right and above the first row; the week list frees itself only while at its top; everything back to clipping on release).
import { readFileSync } from "node:fs";
import path from "node:path";
let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = "") { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  - " + detail : ""}`); if (cond) pass++; else { fail++; process.exitCode = 1; } }
const rd = (p: string) => readFileSync(path.join(__dirname, "..", p), "utf-8").replace(/\r\n/g, "\n");
const tsx = rd("components/schedules-studio/schedules-studio.tsx");
const css = rd("app/schedules-studio.css");
assert("C1 while a block is carried the track stops clipping it on every side (along the row and across it)", /\.ss\[data-carry\] \.ss-htrack \{ overflow: visible; \}/.test(css));
assert("C2 the week list stops clipping only while a block is carried AND the list is at its top (a scrolled list would jump), and is back to clipping when the carry ends", /\.ss\[data-carry\] \.ss-hrows--week\[data-free="1"\] \{ overflow: visible; \}/.test(css) && /if \(drag && el\.scrollTop === 0\) el\.dataset\.free = "1";\s+else delete el\.dataset\.free;\s+return \(\) => \{\s+delete el\.dataset\.free;/.test(tsx) && /<div className="ss-hrows ss-hrows--week" ref=\{weekRowsRef\}>/.test(tsx));
assert("C3 nothing at rest changes: the clipping rules outside a carry are untouched", /\.ss-htrack \{ position: relative; border-radius: 20px; background-color: var\(--ss-surface-2\); cursor: copy; overflow: hidden; \}/.test(css) && /\.ss-hrows--week \{ overflow-y: auto;/.test(css));
console.log(`\n${pass} passed, ${fail} failed`);
