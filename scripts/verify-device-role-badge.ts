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
assert("B2 it shows nothing on a screen that is not registered (a control screen); a screen that cannot reach its branch shows it only after a few seconds — as 'not connected' (owner 2026-10-31: a screen that plays on its own must never be unlabelled), and a connected screen shows at once", /if \(!ctx \|\| !ctx\.isActive\) return null/.test(badge) && /if \(!ctx\.isBranchConnected && !offlineLong\) return null/.test(badge) && /OFFLINE_SHOW_MS = 6000/.test(badge) && /offline: "לא מחובר"/.test(badge) && /offline: "not connected"/.test(badge));
assert("B3 the Player icon when this computer plays (MASTER, or the desktop app's own station), the Remote icon otherwise — in Hebrew and English", /ctx\.deviceMode === "MASTER" \|\| ctx\.isDesignatedAudioStation/.test(badge) && /player: "נגן —/.test(badge) && /remote: "שלט רחוק —/.test(badge) && /player: "Player —/.test(badge) && /remote: "Remote —/.test(badge));
assert("B4 a remote says WHERE the music plays when the player's name is known, and that it does not play here (screen-reader name; the site has no hover tooltips)", /masterDeviceName \? t\.remoteAt\(ctx\.masterDeviceName\)/.test(badge) && /not here/.test(badge) && !/title=/.test(badge));
assert("B5 it sits in the top bar next to the fullscreen button — outside the player", /<DeviceRoleBadge onOpen=\{\(\) => setDeviceDetailsOpen\(true\)\} \/>\s*\n\s*\{\/\* Fullscreen \/ Control Room toggle \*\/\}/.test(shell) && /import \{ DeviceRoleBadge \}/.test(shell));
assert("B6 without a handler it is a status for screen readers; with the app shell's handler (owner 2026-10-31) it is ONE button that only opens the read-only details window — nothing that can change playback", /role="status"/.test(badge) && (badge.match(/<button/g) ?? []).length === 1 && (badge.match(/onClick/g) ?? []).length === 1 && /onClick=\{onOpen\}/.test(badge));
const css = read("app", "globals.css");
assert("B7 the name sits beside the icon (נגן / שלט רחוק, Player / Remote); no frame, box or background; two icons (speaker with waves / remote control with signal); the waves only fade (opacity), and stop for reduced motion", !/background|boxShadow|border|rounded-/.test(badge) && /PlayerIcon/.test(badge) && /RemoteIcon/.test(badge) && /word: \{ player: "נגן", remote: "שלט רחוק" \}/.test(badge) && /word: \{ player: "Player", remote: "Remote" \}/.test(badge) && /sb-role-text/.test(badge) && /@keyframes sb-role-breathe \{[^}]*opacity[^}]*\}[^}]*\}/.test(css) && !/@keyframes sb-role-breathe[^@]*(transform|filter|blur)/.test(css) && /prefers-reduced-motion: reduce\) \{ \.sb-role-wave \{ animation: none/.test(css));
const details = read("components", "device-details.tsx");
assert("B8 the details window of a Remote (the owner's computer included) shows the REMOTE icon, 'Remote' and who it controls — the Player card only for a screen that plays (owner 2026-10-31)", /data-role=\{isPlayer \? "player" : "remote"\}/.test(details) && /\{isPlayer \? <PlayerIcon \/> : <RemoteIcon \/>\}/.test(details) && !/isPlayer \|\| isOwnerComputer/.test(details) && /const roleName = isPlayer \? t\.player : t\.remote/.test(details) && /\{isPlayer \? t\.plays : t\.controls\}/.test(details));
assert("B9 the circle with the user's initials is gone from the top bar; the workspace switch it held moved into the gear menu (only for people with more than one workspace)", !/HeaderProfileButton/.test(shell) && /<span className="sb-fx-title">\{tr\("Business"\)\}<\/span>\s*<WorkspaceSwitcher workspaces=\{workspaceList\} activeId=\{activeWorkspaceId\} \/>/.test(shell));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
