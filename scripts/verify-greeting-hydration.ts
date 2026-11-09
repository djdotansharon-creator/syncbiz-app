/**
 * 2026-11-09 (CDP on the live Dev-PC station, owner-approved): at local 05–07, 12–14, 17–19 and 20–22 every load threw React error #418.
 * The deck greeting was drawn from the clock on the server (UTC) and again in the branch (local time), and the two words differed.
 * React then redrew the whole page from scratch, which wiped the attributes the boot scripts put on <html> — among them the Light graphics
 * (`data-sb-fx`), so the station ran in the full look (~3× busier).
 * Rule: the greeting is drawn only after hydration (server and first client frame draw nothing). Proven in real Chromium with the real React:
 * old markup at 15 h UTC / 17 h local → 1 recoverable hydration error; new → 0, and the local greeting shows.
 * Run: npx tsx scripts/verify-greeting-hydration.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const src = readFileSync(path.join(__dirname, "..", "components", "app-shell.tsx"), "utf-8").replace(/\r\n/g, "\n");

assert("G1 the greeting flag is false on the server and during hydration, true right after (no effect, no extra state)",
  /const greetingReady = useSyncExternalStore\(\(\) => \(\) => \{\}, \(\) => true, \(\) => false\);/.test(src));
assert("G2 the deck greeting is drawn only when ready",
  /<span className="sb-deck-clock-greeting">\{greetingReady \? greeting : ""\}<\/span>/.test(src)
  && !/<span className="sb-deck-clock-greeting">\{greeting\}<\/span>/.test(src));
assert("G3 the deck time keeps its hydration guard",
  /<span className="sb-deck-clock-time" suppressHydrationWarning>\{timeStr\}<\/span>/.test(src));
assert("G4 the only other greeting (header) is drawn only after the user's name has loaded, which starts empty on both sides",
  /const \[sessionName, setSessionName\] = useState<string \| null>\(null\);/.test(src)
  && /\{sessionName \? \(\s*<>[\s\S]{0,300}\{greeting\}/.test(src)
  && (src.match(/\{greeting\}/g) ?? []).length === 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(process.exitCode ?? 0);
