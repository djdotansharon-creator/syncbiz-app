/**
 * Owner 2026-11-08: "in my computer you don't see the video running in the player".
 * PROVEN BY RUNTIME (CDP on the live Dev-PC station renderer):
 * - The CONTROL-mirror DesktopVideoDock iframe was playing the right clip, at opacity 0.
 * - The only matching rule was globals.css `.sb-deck-video-bg iframe:not([data-sb-shown]) { opacity: 0 !important; }`.
 * - Only the browser decks' styleDeckIframe sets data-sb-shown.
 * Rule: the dock marks its own iframe as shown when it styles it (onReady). Static pins.
 * Run: npx tsx scripts/verify-station-video-visible.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const root = path.join(__dirname, "..");
const dock = readFileSync(path.join(root, "components", "player-surface", "desktop-video-dock.tsx"), "utf-8").replace(/\r\n/g, "\n");
const css = readFileSync(path.join(root, "app", "globals.css"), "utf-8");
const player = readFileSync(path.join(root, "components", "audio-player.tsx"), "utf-8").replace(/\r\n/g, "\n");
const onReady = dock.slice(dock.indexOf("onReady: (e: { target: YTPlayerLike }) => {"), dock.indexOf("onStateChange:"));

assert("V1 the dock marks its iframe as shown in onReady, where it styles it", /const f = e\.target\.getIframe\?\.\(\);\n\s*if \(f\) \{[\s\S]{0,700}f\.dataset\.sbShown = "1";/.test(onReady));
assert("V2 the hide-until-styled rule for the browser decks is unchanged", css.includes(".sb-deck-video-bg iframe:not([data-sb-shown]) { opacity: 0 !important; }"));
assert("V3 the station (CONTROL mirror) video still lives in the .sb-deck-video-bg slot via DesktopVideoDock",
  /isControlMirror && mirrorVid && \(ms\?\.status === "playing" \|\| ms\?\.status === "paused"\) \? \(\n\s*<div\n\s*className="sb-deck-video-bg[\s\S]{0,200}<DesktopVideoDock/.test(player));
assert("V4 the dock still mutes itself on ready (audio never comes from it)", /e\.target\.mute\?\.\(\);\n\s*e\.target\.setVolume\?\.\(0\);/.test(onReady));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(process.exitCode ?? 0);
