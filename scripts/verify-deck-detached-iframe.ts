/**
 * Owner 2026-11-08 ("lighten the Lenovo"), PROVEN BY RUNTIME on the Dev-PC: main.log grew to 108 MB in a day.
 * 299k of its lines were YouTube's "The YouTube player is not attached to the DOM", on an exact 100 ms cadence.
 * Source: the deck video-styling interval sent unloadModule("captions") to a deck whose iframe was no longer on the page.
 * YouTube's sendMessage warns whenever the iframe has no contentWindow.
 * Rule: the styling skips a detached iframe; a live one is styled exactly as before. Static pins on the player.
 * Run: npx tsx scripts/verify-deck-detached-iframe.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const src = readFileSync(path.join(__dirname, "..", "components", "audio-player.tsx"), "utf-8").replace(/\r\n/g, "\n");
const start = src.indexOf("const styleDeckIframe = (player: unknown, active: boolean) => {");
const body = src.slice(start, src.indexOf("const id = setInterval(() => {", start));

assert("D1 the styling helper exists", start > 0 && body.length > 0);
assert("D2 a detached iframe (not on the page / no contentWindow) is skipped BEFORE any YT command",
  /if \(!f \|\| !f\.isConnected \|\| !f\.contentWindow\) return;/.test(body) &&
  body.indexOf("!f.contentWindow) return;") < body.indexOf('unloadModule?.("captions")'));
assert("D3 the live deck is still styled: captions unloaded, opacity by active deck, video width published",
  body.includes('unloadModule?.("captions")') && /s\.opacity = active \? "1" : "0";/.test(body) && body.includes('"--sb-video-w"'));
assert("D4 the interval still styles BOTH decks every 100 ms (the picture follows within a tenth of a second)",
  /styleDeckIframe\(ytPlayerRef\.current, activeIsA\);\n\s*styleDeckIframe\(ytPlayerNextRef\.current, !activeIsA\);/.test(src) &&
  /\}, 100\); \/\* was 500ms/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(process.exitCode ?? 0);
