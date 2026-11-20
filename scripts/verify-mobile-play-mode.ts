/**
 * THE PHONE'S PLAY MODE (owner 2026-11-20): "why can't I choose between List, Auto mix and Shuffle? make it ONE button that opens the three options, in the volume bar's place".
 * The three separate switches (shuffle · auto mix · loop) become one choice of three; the volume and the modes share the fold under the buttons.
 * Behavioural tests of the pure rules + static guards of the wiring. Run: npx tsx scripts/verify-mobile-play-mode.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { PLAY_MODES, modeCommands, playModeOf } from "../lib/mobile-play-mode";

const root = path.join(__dirname, "..");
const rd = (p: string) => readFileSync(path.join(root, p), "utf-8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
function assert(name: string, cond: boolean): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}

assert("M1 there are exactly three modes, in the order List · Auto mix · Shuffle", PLAY_MODES.join() === "list,mix,shuffle");
assert("M2 what the station reports → the mode shown: nothing on = List, auto mix on = Auto mix, shuffle on = Shuffle", playModeOf({}) === "list" && playModeOf(null) === "list" && playModeOf({ autoMix: true }) === "mix" && playModeOf({ shuffle: true }) === "shuffle");
assert("M3 shuffle AND auto mix both on (set on the computer): Shuffle is shown", playModeOf({ shuffle: true, autoMix: true }) === "shuffle");
const cmds = (m: Parameters<typeof modeCommands>[0], r?: Parameters<typeof modeCommands>[1]) => modeCommands(m, r).map((c) => `${c.cmd}=${c.value}`).join();
assert("M4 Auto mix: auto mix ON first, then shuffle OFF (never a moment with no mode)", cmds("mix") === "autoMix=true,shuffle=false");
assert("M5 Shuffle: shuffle ON first, then auto mix OFF", cmds("shuffle") === "shuffle=true,autoMix=false");
assert("M6 List: both OFF; the loop goes back to 'the list' only when it was 'one song' / 'off' (a store plays on)", cmds("list", "playlist") === "shuffle=false,autoMix=false" && cmds("list", undefined) === "shuffle=false,autoMix=false" && cmds("list", "track") === "shuffle=false,autoMix=false,repeat=playlist" && cmds("list", "off") === "shuffle=false,autoMix=false,repeat=playlist");
assert("M7 every command carries an absolute value (the same one twice does no harm) and Auto mix / Shuffle never touch the loop", PLAY_MODES.every((m) => modeCommands(m, "off").every((c) => (c.cmd === "repeat" ? c.value === "playlist" : typeof c.value === "boolean"))) && !/repeat/.test(cmds("mix", "off")) && !/repeat/.test(cmds("shuffle", "track")));

const np = rd("components/vm/vm-now-playing.tsx");
const css = rd("app/mobile-app.css");
const phrases = rd("lib/i18n/phrases.ts");
assert("M8 the row has TWO buttons — Volume and Play mode — instead of four (no separate Shuffle / Auto mix / Loop buttons any more)", (np.match(/<button type="button" className="vm-mode"/g) ?? []).length === 2 && !/f\.setShuffle\(!shown/.test(np) && !/f\.setAutoMix\(!shown/.test(np) && !/IconRepeatOne/.test(np));
assert("M9 one fold at a time: the volume bar OR the three modes (the same fold mechanism as the volume had), a press on the open one closes it", /useState<"vol" \| "mode" \| null>\(null\)/.test(np) && /const open = fold !== which;\s*setFold\(open \? which : null\)/.test(np) && /data-open=\{fold === "vol" \? "" : undefined\}/.test(np) && /data-open=\{fold === "mode" \? "" : undefined\}/.test(np) && /inert=\{fold !== "mode"\}/.test(np) && /inert=\{fold !== "vol"\}/.test(np));
assert("M10 the three choices are a radio group, the current one is checked, a choice sends its commands through the fleet's own setters", /role="radiogroup"/.test(np) && /role="radio" aria-checked=\{mode === m\}/.test(np) && /modeCommands\(m, shown\?\.repeatMode\)/.test(np) && /f\.setShuffle\(c\.value\)/.test(np) && /f\.setAutoMix\(c\.value\)/.test(np) && /f\.setRepeat\(c\.value\)/.test(np));
assert("M11 a chosen mode stays on screen until the station says it back (held; lets go after 4 s) — it never snaps to the old one and forward again", /const mode = held \?\? playModeOf\(shown\)/.test(np) && /setTimeout\(\(\) => setHeld\(null\), 4000\)/.test(np));
assert("M12 the icons stand on top of each other and cross-fade (no remount): one .vm-mi with three svgs, the current one seen", /<span className="vm-mi" data-m=\{mode\} aria-hidden>\s*<IconRepeat \/>\s*<IconMix \/>\s*<IconShuffle \/>/.test(np) && /\.vm-mi svg \{[^}]*transition: opacity/.test(css) && /\.vm-mi\[data-m="list"\] svg:nth-child\(1\), \.vm-mi\[data-m="mix"\] svg:nth-child\(2\), \.vm-mi\[data-m="shuffle"\] svg:nth-child\(3\)/.test(css));
assert("M13 an opened fold is scrolled fully into view once it has unfolded (the choices are never half off the screen)", /scrollIntoView\(\{ block: "nearest", behavior: "smooth" \}\)/.test(np) && /\.vm-volfold \{ scroll-margin-bottom: \d+px; \}/.test(css));
assert("M14 the three choices are equally wide (the lit one does not change the row's shape)", /\.vm-pick-opt \{ flex: 0 0 104px; width: 104px;/.test(css) && !/\.vm-pick-opt\[data-on\][^}]*(width|padding)/.test(css));
assert("M15 the new lines are translated", ["Play mode", "In order, and again from the start", "In order, the songs blend into each other", "Random order"].every((k) => new RegExp(`"${k}": "`).test(phrases)));
assert("M16 the volume bar itself is unchanged (same slider, same commands)", /<VmSlider value=\{vol\} max=\{100\} onLive=\{\(v\) => f\.setVolume\(v\)\} onCommit=\{\(v\) => f\.setVolume\(v\)\}/.test(np));

console.log(`\n${pass} passed, ${fail} failed`);
