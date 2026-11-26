// The Jingles screen (owner 2026-11-26): with jingles saved the LIBRARY opens, with one square holding a plus that opens the creation; the creation is not a tab; with NO jingle the creation is the screen and there are no tabs.
// Also measured in a browser (no jingle: creation, no tabs; one jingle: tabs Library + Schedule, plus tile first, the plus opens the creation).
import { readFileSync } from "node:fs";
import path from "node:path";
let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = "") { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  - " + detail : ""}`); if (cond) pass++; else { fail++; process.exitCode = 1; } }
const rd = (p: string) => readFileSync(path.join(__dirname, "..", p), "utf-8").replace(/\r\n/g, "\n");
const sh = rd("components/jingles-control/JinglesShell.tsx");
const css = rd("app/globals.css");

assert("H1 the first screen is decided by what exists: jingles -> Library, none -> Create; nothing is drawn until the library's first answer (no flash); the Control Room surface is always the creation", /useState<JinglesOpenTab \| null>\(\(\) => takeJinglesOpenTab\(\) \?\? null\)/.test(sh) && /cur === null \? \(hasJingles \? "library" : "create"\)/.test(sh) && /const tab: JinglesOpenTab \| null = isCR \? "create" : activeTab;/.test(sh) && /setLibraryAnswered\(true\)/.test(sh));
assert("H2 with no jingle left the creation comes back by itself", /!hasJingles && cur !== "create" \? "create" : cur/.test(sh));
assert("H3 the tab bar has NO Create tab (Library, Schedule only) and exists only when there is at least one jingle", /\{!isCR && hasJingles \? \(\s*<nav ref=\{wsTabsRef\} className="jc-ws-tabs" role="tablist">\s*\{\(\s*\[\s*\["library", "Library"\],\s*\["schedule", "Schedule"\],\s*\] as const/.test(sh));
assert("H4 the library's first tile is a square with a plus that opens the creation, and the bar 'New jingle' under the grid is gone", /className="jcl-tile jcl-tile--new" onClick=\{\(\) => setActiveTab\("create"\)\}/.test(sh) && !/className="jcl-new"/.test(sh) && /\.jcl-tile--new \{/.test(css));
console.log(`\n${pass} passed, ${fail} failed`);
