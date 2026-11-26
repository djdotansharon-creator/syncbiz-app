// "A schedule is playing - play this anyway?" (owner 2026-11-25). Pure behaviour of lib/schedule-live-play.ts + wiring of the places a person starts music by hand.
// The behaviour was also measured in a Player + Remote browser test (dialog on a card double-click and on a drop; No changes nothing and sends nothing; Yes plays and sends PLAY_SOURCE; a second push in the same block is not asked).
import { readFileSync } from "node:fs";
import path from "node:path";
import { __resetLivePlayForTests, answerLivePlayQuestion, guardLivePlay, livePlayWouldAsk, needsLivePlayConfirm, setLiveBlock } from "../lib/schedule-live-play";
let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = "") { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  - " + detail : ""}`); if (cond) pass++; else { fail++; process.exitCode = 1; } }
const rd = (p: string) => readFileSync(path.join(__dirname, "..", p), "utf-8").replace(/\r\n/g, "\n");

const b1 = { blockId: "b1", name: "Lunch", endTime: "15:00" }, b2 = { blockId: "b2", name: "Evening", endTime: null };
__resetLivePlayForTests();
let ran = 0;
assert("L1 no block in force: a manual play runs at once and nothing is asked", guardLivePlay(() => { ran++; }) === true && ran === 1 && !livePlayWouldAsk());
setLiveBlock(b1);
assert("L2 a block is playing: the play is NOT run, the person is asked", guardLivePlay(() => { ran++; }) === false && ran === 1 && livePlayWouldAsk());
answerLivePlayQuestion(false);
assert("L3 'No' changes nothing: the play never runs (and the queue change inside it never runs)", ran === 1);
guardLivePlay(() => { ran++; }); answerLivePlayQuestion(true);
assert("L4 'Yes' runs the whole action once", ran === 2);
assert("L5 after 'Yes' the same block does not ask again", guardLivePlay(() => { ran++; }) === true && ran === 3 && !livePlayWouldAsk());
setLiveBlock(b2);
assert("L6 the NEXT block asks again", livePlayWouldAsk());
guardLivePlay(() => { ran++; }); setLiveBlock(null);
answerLivePlayQuestion(true);
assert("L7 a question about a block that ended is void (the play does not run later)", ran === 3);
assert("L8 the schedule switched off / a quiet block (null) never asks", guardLivePlay(() => { ran++; }) === true && ran === 4);
assert("L9 the pure rule: asks only with a block in force that has not been overridden", needsLivePlayConfirm(b1, null) && !needsLivePlayConfirm(b1, "b1") && !needsLivePlayConfirm(null, null));

const eng = rd("components/schedule-auto-player.tsx");
assert("W1 the engine publishes the block that plays music (and null when the schedule is off / empty / quiet) - display only", (eng.match(/setLiveBlock\(/g) ?? []).length === 3 && /setLiveBlock\(inForce \? \{ blockId: inForce\.id/.test(eng));
const sm = rd("components/sources-manager.tsx");
assert("W2 the library's play handlers ask first, and the WHOLE action (queue change + play) is inside the guard", (sm.match(/guardLivePlay\(/g) ?? []).length >= 7 && /guardLivePlay\(\(\) => \{\n\s+setQueue\(queue, \{ force: true \}\);/.test(sm));
assert("W3 a library card, a search result and a drop on the player ask first", /guardLivePlay\(\(\) => playSourceFn\(playTarget\)\)/.test(rd("components/source-card-unified.tsx")) && /guardLivePlay\(\(\) => basePlaySource\(source\)\)/.test(rd("components/library-input-area.tsx")) && /guardLivePlay\(\(\) => void runPlayerDrop\(snap\)\)/.test(rd("components/app-shell.tsx")));
const shell = rd("components/app-shell.tsx");
assert("W4 with no block in force a drop runs untouched (the original event, no copy); only when it must ask is the drop copied while the browser still lets it be read", /if \(!livePlayWouldAsk\(\)\) \{\n\s+await runPlayerDrop\(e\);\n\s+return;\n\s+\}\n\s+const snap = snapshotDrop\(e\);/.test(shell));
assert("W5 the dialog is mounted once, next to the volume question", /<ScheduleLivePlayGuard \/>/.test(rd("app/(app)/providers.tsx")));
const ph = rd("lib/i18n/phrases.ts");
assert("W6 every text of the dialog has a Hebrew phrase", ["A schedule is active", "“{name}” is playing now, until {t}. Play this anyway?", "“{name}” is playing now. Play this anyway?", "The schedule is playing now, until {t}. Play this anyway?", "The schedule is playing now. Play this anyway?", "No", "Yes, play it"].every((k) => ph.includes(`"${k}":`)));
const lib = rd("lib/schedule-live-play.ts");
assert("W7 DISPLAY / QUESTION ONLY: the store imports nothing from the player, the playback state, the device or the WebSocket code", !/from "@\/(lib|components)\/(playback|audio-player|device|remote|ws)/.test(lib));
const lpCss = rd("components/schedule-live-play-guard.css");
assert("W8 the dialog has no card: a blurred full-screen veil, centred text, two buttons side by side (blue 'yes', white 'no'); the blur selector is heavier than app/lite-fx.css rule 1 so the white look blurs too; the light graphics get a plain tint", /\.vono-lp-actions \{ display: flex;[^}]*justify-content: center/.test(lpCss) && /\.vono-lp-yes \{ background: #2f7bff/.test(lpCss) && /\.vono-lp-no \{ background: #fff/.test(lpCss) && /html:not\(\[data-sb-fx="lite"\]\) \.vono-lp\.vono-lp \{[^}]*backdrop-filter: blur\(26px\)[^}]*!important/.test(lpCss) && /html\[data-sb-fx="lite"\] \.vono-lp \{[^}]*backdrop-filter: none !important/.test(lpCss) && /className="vono-lp-btn vono-lp-no"/.test(rd("components/schedule-live-play-guard.tsx")));
console.log(`\n${pass} passed, ${fail} failed`);
