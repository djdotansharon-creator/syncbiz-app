/**
 * The Player / Remote label in the top bar (owner 2026-10-27): display only, in the outer top bar, never inside the player, hidden while the screen is not on the branch.
 * Run: npx tsx scripts/verify-device-role-badge.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";

let pass = 0;
let fail = 0;
function assert(name: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (ok) pass++;
  else fail++;
}
const read = (...p: string[]) => readFileSync(path.join(__dirname, "..", ...p), "utf8");
const badge = read("components", "device-role-badge.tsx");
const shell = read("components", "app-shell.tsx");

assert("B1 it only READS the device context and the language — no playback, provider, socket or election code is imported", /from "@\/lib\/device-player-context"/.test(badge) && !/playback-provider|audio-player|use-remote-control|useRemoteControlWs|setMaster|SET_MASTER/.test(badge) && (badge.match(/^import .*$/gm) ?? []).length === 3);
assert("B2 it shows nothing while the screen is not registered on the branch or not connected (no label that could mislead)", /!ctx\.isActive \|\| !ctx\.isBranchConnected\) return null/.test(badge));
assert("B3 the Player icon when this computer plays (MASTER, or the desktop app's own station), the Remote icon otherwise — in Hebrew and English", /ctx\.deviceMode === "MASTER" \|\| ctx\.isDesignatedAudioStation/.test(badge) && /player: "נגן —/.test(badge) && /remote: "שלט רחוק —/.test(badge) && /player: "Player —/.test(badge) && /remote: "Remote —/.test(badge));
assert("B4 a remote says WHERE the music plays when the player's name is known, and that it does not play here (screen-reader name; the site has no hover tooltips)", /masterDeviceName \? t\.remoteAt\(ctx\.masterDeviceName\)/.test(badge) && /not here/.test(badge) && !/title=/.test(badge));
assert("B5 it sits in the top bar next to the fullscreen button — outside the player", /<DeviceRoleBadge \/>\s*\n\s*\{\/\* Fullscreen \/ Control Room toggle \*\/\}/.test(shell) && /import \{ DeviceRoleBadge \}/.test(shell));
assert("B6 it is a status for screen readers, not a button (nothing to press, nothing that can change playback)", /role="status"/.test(badge) && !/<button|onClick/.test(badge));
const css = read("app", "globals.css");
assert("B7 icon only — no frame, box or background; two icons (speaker with waves / remote control with signal); the waves only fade (opacity), and stop for reduced motion", !/background|boxShadow|border|rounded-/.test(badge) && /PlayerIcon/.test(badge) && /RemoteIcon/.test(badge) && /@keyframes sb-role-breathe \{[^}]*opacity[^}]*\}[^}]*\}/.test(css) && !/@keyframes sb-role-breathe[^@]*(transform|filter|blur)/.test(css) && /prefers-reduced-motion: reduce\) \{ \.sb-role-wave \{ animation: none/.test(css));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
