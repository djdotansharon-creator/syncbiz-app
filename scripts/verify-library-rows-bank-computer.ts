/**
 * 2026-11-09 (owner): the Royalty-Free bank and "My Computer" (play music files from this PC) were pads next to the player before the redesign
 * hid them (`.library-deck-unified .library-deck-pads-aside { display:none }`). They are now rows in the LIBRARY list, under DJ AI.
 * Same panels, same flags; a row opens its panel, a second click closes it, a library destination (All Library / Scheduled / DJ AI) closes it,
 * and while it is open only its own row is lit. "My Computer" works only in the desktop app (the browser shows it dimmed, "Desktop app only").
 * Run: npx tsx scripts/verify-library-rows-bank-computer.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const root = path.join(__dirname, "..");
const src = readFileSync(path.join(root, "components", "sources-manager.tsx"), "utf-8").replace(/\r\n/g, "\n");
const phrases = readFileSync(path.join(root, "lib", "i18n", "phrases.ts"), "utf-8");

const djAi = src.indexOf('<span className="truncate">DJ AI</span>');
const rfm = src.indexOf('<span className="truncate">{tr("Royalty-Free Music")}</span>');
const pc = src.indexOf('<span className="truncate">{tr("My Computer")}</span>');
assert("L1 both rows sit in the LIBRARY list right after DJ AI, bank first", djAi > 0 && rfm > djAi && pc > rfm && pc - djAi < 4000);
assert("L2 the bank row is gated by the same flag as its panel",
  /\{RFM_CATALOG_ENABLED \? \(\s*<button[\s\S]{0,200}setActiveCenterModule\(isRoyaltyFreeMusicModule\(activeCenterModule\) \? null : "royalty-free-music"\)/.test(src));
assert("L3 the computer row toggles the My Music panel and is disabled outside the desktop app",
  /disabled=\{!inDesktopApp\}[\s\S]{0,200}setActiveCenterModule\(isMyMusicLibraryModule\(activeCenterModule\) \? null : "my-music-library"\)/.test(src));
assert("L4 the desktop check has no effect and no hydration mismatch (false on server and while hydrating)",
  /const inDesktopApp = useSyncExternalStore\(noopSubscribe, \(\) => Boolean\(window\.syncbizDesktop\), \(\) => false\);/.test(src));
assert("L5 while the bank / computer panel is open only its row is lit, and a library row closes it",
  /const navViewActive = \(id: LibraryViewId\) =>\s*!djHubRailActive && !bankOrComputerOpen &&/.test(src)
  && /if \(bankOrComputerOpen\) setActiveCenterModule\(null\);\s*setSelection\(\{ type: "library_view", id: r\.id \}\);/.test(src));
assert("L6 Hebrew labels exist", /"Royalty-Free Music": "מוזיקה ללא זכויות"/.test(phrases) && /"My Computer": "המחשב שלי"/.test(phrases) && /"Desktop app only":/.test(phrases));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(process.exitCode ?? 0);
