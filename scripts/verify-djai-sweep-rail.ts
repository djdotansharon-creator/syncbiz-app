// The DJ AI button's light sweep runs only while the right rail is open (owner 2026-11-26). Static guard; measured in a browser: open -> 1 running sweep, closed -> 0.
import { readFileSync } from "node:fs";
import path from "node:path";
let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = "") { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  - " + detail : ""}`); if (cond) pass++; else { fail++; process.exitCode = 1; } }
const css = readFileSync(path.join(__dirname, "..", "app/globals.css"), "utf-8");
const sm = readFileSync(path.join(__dirname, "..", "components/sources-manager.tsx"), "utf-8");
assert("D1 the sweep still exists while the rail is open", /\.sb-djl-title \{[^}]*animation: sb-djl-sweep 6\.5s ease-in-out infinite;/.test(css));
assert("D2 a collapsed right rail stops the sweep (an animation out of sight redrew the whole screen every frame)", /\.sb-rail-content\[data-open="false"\] \.sb-djl-title \{ animation: none; \}/.test(css));
assert("D3 the rail content carries data-open (the open state the rule reads)", /className="sb-rail-content sb-rail-content--right[^"]*" data-open=\{rightRailOpen\}/.test(sm));
console.log(`\n${pass} passed, ${fail} failed`);
