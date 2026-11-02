/**
 * Static checks for the deck fixes of 2026-11-02 (owner: "make it so the part of the song list under the player is not seen" + "when I scroll down and the player collapses it is jerky").
 * Run: npx tsx scripts/verify-deck-glide.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const read = (p: string) => readFileSync(path.join(__dirname, "..", p), "utf-8");
const css = read("app/globals.css");
const comp = read("components/player-auto-compact.tsx");

assert("G1 in the transparent (song) look the queue card sits BESIDE the player: no negative margin, no extra padding, no clip, a rounded card of its own (both directions — the rule outranks the RTL one), and the player's shadow carrier is a plain rounded rectangle",
  /html\[data-sb-display="song"\] \.library-deck-unified \.library-deck-slot-aside \{ margin-inline-end: 0 !important; padding-inline-end: 0 !important; clip-path: none !important; border-radius: 16px !important; \}/.test(css)
  && /html\[data-sb-display="song"\] \.library-deck-unified \.library-deck-player-cell::before \{ border-radius: 16px !important; clip-path: inset\(-48px -48px -48px -48px\) !important; \}/.test(css));
assert("G2 the tuck stays in the black and white looks (the rule is scoped to song only; the original tuck rules are still there)", !/html\[data-sb-display="(black|white)"\] \.library-deck-unified \.library-deck-slot-aside \{ margin-inline-end: 0/.test(css) && /margin-inline-end: -40px;\s*padding-inline-end: 32px;/.test(css));
assert("G3 the glide switches the live glass off for its duration only: the component sets data-sb-pc-moving when it flips (shrinking AND opening — one function) and removes it after LOCK_MS, and clears it with the other attributes on cleanup",
  /"data-sb-pc-moving"\]/.test(comp) && /root\.setAttribute\("data-sb-pc-moving", "1"\)/.test(comp) && /later\(\(\) => root\.removeAttribute\("data-sb-pc-moving"\), LOCK_MS\)/.test(comp) && /const ATTRS = \["data-sb-player", "data-sb-pc-swap", "data-sb-pc-row", "data-sb-pc-moving"\];/.test(comp));
assert("G4 the CSS for it: wide screens only (the slim bar exists only there), every element and its pseudo-elements lose backdrop-filter while the flag is up — a visual switch only, nothing else changes",
  /@media \(min-width: 1024px\) \{\s*html\[data-sb-pc-moving\] \*, html\[data-sb-pc-moving\] \*::before, html\[data-sb-pc-moving\] \*::after \{ -webkit-backdrop-filter: none !important; backdrop-filter: none !important; \}\s*\}/.test(css));
assert("G5 nothing in playback: the component still only sets attributes on <html> (no playback, device or socket import was added)", !/usePlayback|useDevicePlayer|WebSocket|sendCommand/.test(comp));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
