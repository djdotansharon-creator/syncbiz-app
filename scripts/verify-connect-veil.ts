/**
 * Static checks for the connect veil (owner 2026-11-01): an unconnected browser opens blurred and never turns itself into a player.
 * Run: npx tsx scripts/verify-connect-veil.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const read = (p: string) => readFileSync(path.join(__dirname, "..", p), "utf-8");

const veil = read("components/connect-veil.tsx");
const css = read("components/connect-veil.css");
const shell = read("components/app-shell.tsx");
const phrases = read("lib/i18n/phrases.ts");
const picker = read("components/remote-bar/branch-picker.tsx");

assert("V1 the veil is up only for a browser screen that is active, not connected, never connected in this page and not in the emergency choice — never in the desktop app, never on a control screen",
  /const active = !!ctx && ctx\.isActive && !isDesktopApp && !isControlScreenPath\(pathname\) && !connected && !everConnected && !emergency;/.test(veil)
  && /"syncbizDesktop" in window, \(\) => true\)/.test(veil));
assert("V2 the first connection ends the veil for good in this page (a later network blip never veils a screen that is playing or controlling)", /if \(connected && !everConnected\) setEverConnected\(true\);/.test(veil));
assert("V3 the way past it is one deliberate, quiet link: 'Use this browser as the Player (emergency)' — stored in localStorage, forgotten once the browser really connects, shown only after the window has opened",
  /EMERGENCY_PLAYER_KEY = "vono_emergency_player"/.test(veil) && /setItem\(EMERGENCY_PLAYER_KEY, "1"\)/.test(veil) && /removeItem\(EMERGENCY_PLAYER_KEY\)/.test(veil) && /active && slow \? <button type="button" className="vono-veil-emergency"/.test(veil));
assert("V4 a manager who has not chosen a branch gets the existing branch picker (forced, no close button) after 5 s; and its 'Not now' link hands over to the plain window; anyone else gets a 'can't reach the branch' window with Try again",
  /VEIL_WINDOW_AFTER_MS = 5000/.test(veil) && /needPicker = active && slow && canManage && !branch && !pickerOff/.test(veil) && /<BranchPicker current=\{null\} forced onClose=\{\(\) => setPickerOff\(true\)\} \/>/.test(veil) && /window\.location\.reload\(\)/.test(veil) && /\{forced \? null : <button type="button" className="sb-bp-x"/.test(picker));
assert("V5 nothing underneath can be pressed from the keyboard while it is up: every key outside the veil / picker / emergency link is stopped in the capture phase — except Tab and Escape, and the listener goes when the veil goes",
  /e\.key === "Tab" \|\| e\.key === "Escape"/.test(veil) && /closest\("\.vono-veil, \.sb-bp-back, \.vono-veil-emergency"\)/.test(veil) && /addEventListener\("keydown", hold, true\)/.test(veil) && /removeEventListener\("keydown", hold, true\)/.test(veil));
assert("V6 it touches nothing in playback: it only reads isActive / isBranchConnected, sends no command, owns no socket and imports no playback module",
  !/usePlayback|playback-provider|sendCommand|new WebSocket|useRemoteOwner|useRemoteControlWs|stopForControlHandoff|sendSetMaster/.test(veil) && (veil.match(/useDevicePlayer\(\)/g) ?? []).length === 1);
assert("V7 it is a full blur (22px) with a small pill; weak computers (Light graphics) get a plain dark cover with no blur at all; it sits under the branch picker's window and the emergency link sits above both",
  /blur\(22px\)/.test(css) && /html\[data-sb-fx="lite"\] \.vono-veil \{[^}]*backdrop-filter: none/.test(css) && /z-index: 2147482300/.test(css) && /z-index: 2147482500/.test(css) && /\.sb-bp-back \{ position: fixed; inset: 0; z-index: 2147482400/.test(read("components/remote-bar/branch-picker.css")));
assert("V8 the app shell mounts it beside the Remote's strip, only for a browser (not the desktop app) and not on a control screen", /\{!isControlScreen && !isDesktopApp \? <ConnectVeil canManage=\{canManage\} \/> : null\}/.test(shell));
assert("V9 every word it shows has its Hebrew", ["Connecting…", "Can't reach the branch", "Nothing plays on this computer until it is connected.", "Try again", "Use this browser as the Player (emergency)"].every((k) => phrases.includes(`"${k}": "`)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
