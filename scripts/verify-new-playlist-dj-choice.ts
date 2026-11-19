/**
 * NEW PLAYLIST: "DJ AI" OR "CREATE IT YOURSELF" (owner 2026-11-19: "when you create a new playlist there should be a choice — DJ AI, or create it yourself").
 * Static guards of the wiring (the window itself was run in a browser: choose → name → back → DJ AI opens the assistant, English and Hebrew).
 * Run: npx tsx scripts/verify-new-playlist-dj-choice.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { HE_PHRASES } from "../lib/i18n/phrases";

const root = path.join(__dirname, "..");
const rd = (p: string) => readFileSync(path.join(root, p), "utf-8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
function assert(name: string, cond: boolean): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}

const pop = rd("components/new-playlist-pop.tsx");
const lib = rd("components/sources-manager.tsx");
const leaf = rd("components/add-leaf-to-playlist-modal.tsx");
const css = rd("app/globals.css");

assert("D1 the new-playlist window starts on the two ways when DJ AI is offered, and on the name field when it is not", /onDjAi\?: \(\) => void;/.test(pop) && /useState<"choose" \| "name">\(onDjAi \? "choose" : "name"\)/.test(pop));
assert("D2 'DJ AI' hands over to the assistant and the window glides away; 'Create it yourself' is the existing name field (nothing about creating changed)", /onClick=\{\(\) => \{\s*onDjAi\(\);\s*close\(\);\s*\}\}/.test(pop) && /onClick=\{\(\) => setStep\("name"\)\}/.test(pop) && /onCreate\(clean\)/.test(pop));
assert("D3 from the name step there is a way back to the choice (only when DJ AI is offered)", /onDjAi && step === "name" \?/.test(pop) && /setStep\("choose"\)/.test(pop));
assert("D4 the library opens the DJ Creator assistant in the centre when DJ AI is chosen", /onDjAi=\{\(\) => setActiveCenterModule\("dj-creator-assistant"\)\}/.test(lib));
assert("D5 'add this song to a NEW playlist' (the other opener) is unchanged: no DJ AI there", /<NewPlaylistPop/.test(leaf) && !/onDjAi/.test(leaf));
assert("D6 the choice has its styles, mirrored for right-to-left, and adds no blur / filter", /\.sb-npl-choice \{/.test(css) && /\[dir="rtl"\] \.sb-npl-back svg \{ transform: scaleX\(-1\); \}/.test(css) && !/\.sb-npl-(choice|back)[^{]*\{[^}]*(blur|backdrop-filter|filter:)/.test(css));
for (const k of ["Create it yourself", "Tell it the vibe — it builds the playlist for you", "Name it, then add the songs you want"]) assert(`D7 Hebrew for "${k}"`, typeof HE_PHRASES[k] === "string" && HE_PHRASES[k]!.length > 0);

console.log(`\n${pass} passed, ${fail} failed`);
