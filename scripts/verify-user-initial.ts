/**
 * Static checks for the signed-in disc (owner 2026-11-01): the first letter of the name on a soft white disc at the END-most corner of the top bars (right in English, left in Hebrew).
 * Run: npx tsx scripts/verify-user-initial.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { initialOf } from "../lib/initial-of";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const read = (p: string) => readFileSync(path.join(__dirname, "..", p), "utf-8");

const comp = read("components/user-initial.tsx");
const css = read("components/user-initial.css");
const shell = read("components/app-shell.tsx");
const rb = read("components/remote-bar/remote-bar.tsx");
const rbCss = read("components/remote-bar/remote-bar.css");
const ctl = read("components/control-screen/control-bar.tsx");
const ctlCss = read("components/control-screen/control-screen.css");

assert("U1 the letter: Hebrew, English (upper-cased), an e-mail, a digit — and nothing for empty / spaces / an emoji / a symbol",
  initialOf("דוד כהן") === "ד" && initialOf("dotan sharon") === "D" && initialOf("  ori@x.com") === "O" && initialOf("7up") === "7" && initialOf("") === "" && initialOf("   ") === "" && initialOf(null) === "" && initialOf(undefined) === "" && initialOf("😀 x") === "" && initialOf("-x") === "");
assert("U2 it is display only: no click handler, no tooltip, no button, no link — an image role with the name for screen readers", !/onClick|title=|<button|<Link|<a /.test(comp) && /role="img"/.test(comp) && /aria-label=/.test(comp));
assert("U3 one shared /api/auth/me request per page for every bar that shows the disc (a 60-second share), and a failed request shows nothing", /sharedName/.test(comp) && /SHARE_MS = 60_000/.test(comp) && /\.catch\(\(\) => null\)/.test(comp) && (comp.match(/fetch\(/g) ?? []).length === 1);
assert("U4 a soft white disc with a faint grey tint (white → light grey gradient), 30px, dark letter, no hover rule", /linear-gradient\(145deg, #ffffff 0%, #e4e4ea 100%\)/.test(css) && /width: 30px; height: 30px; border-radius: 50%/.test(css) && !/:hover/.test(css));
assert("U5 the player's header shows it as the LAST item of its right-hand cluster (after the way-back icon), so it is the END-most corner (right in English, left in Hebrew)", /<ControlBackIcon \/> : null\}\s*\{\/\*[^*]*\*\/\}\s*<SessionInitial className="sb-user-initial--header" \/>\s*<\/div>/.test(shell));
assert("U6 the Remote's strip and the control screen's bar each carry it at their END edge; the header's copy steps aside under the Remote's strip", /<span className="sb-rb-end">\{canManage \? <ControlBackIcon \/> : null\}<SessionInitial \/><\/span>/.test(rb) && /\.sb-rb-end \{[^}]*gap: 10px/.test(rbCss) && /<span className="sb-ctl-end">[\s\S]*<SessionInitial \/>\s*<\/span>/.test(ctl) && /\.sb-ctl-end \{ justify-self: end;/.test(ctlCss) && /html\[data-sb-remote-view\] \.sb-user-initial--header \{ display: none; \}/.test(css));
assert("U7 nothing in the playback chain is touched: the disc reads no device / playback context and opens no socket", !/useDevicePlayer|usePlayback|WebSocket|sendCommand/.test(comp));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
