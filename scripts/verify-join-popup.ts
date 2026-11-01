/**
 * The live join card, the renewing code, the Remote-only owner computer and the computer switch default (owner 2026-10-31) — static checks, no browser.
 * Run: npx tsx scripts/verify-join-popup.ts
 */
import { readFileSync } from "node:fs";
import * as join from "../lib/join-by-code";
import { DEFAULT_ROLES } from "../lib/roles";

let pass = 0;
let fail = 0;
function assert(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === undefined ? "" : `   -> ${JSON.stringify(detail)}`}`);
  if (ok) pass++;
  else fail++;
}
const read = (p: string) => readFileSync(p, "utf8");

const shell = read("components/app-shell.tsx");
const popup = read("components/roles/join-popup.tsx");
const poller = read("lib/use-join-pending.ts");
const count = read("app/api/join/pending-count/route.ts");
const claim = read("app/api/join/claim/route.ts");
const grid = read("components/roles/people-grid.tsx");
const flow = read("components/join/signup-flow.tsx");
const store = read("lib/device-enrollment-store.ts");
const panel = read("components/roles/roles-panel.tsx");

assert("P1 the card is mounted on the control screens only — never over the music player", /\{isControlScreen \? <JoinPopup \/> : null\}/.test(shell) && (shell.match(/<JoinPopup/g) ?? []).length === 1);
assert("P2 only a request from the last few minutes pops up; 'Later' is remembered for the session; older ones wait behind the red circle", /FRESH_MS = 5 \* 60_000/.test(popup) && /Date\.now\(\) - Date\.parse\(x\.requestedAt\) < FRESH_MS/.test(popup) && /sessionStorage/.test(popup) && /tr\("Later"\)/.test(popup));
assert("P3 the card renders nothing unless the join feature is on and this person decides requests (it rides on the shared pending-count poll)", /useJoinPending\(\)/.test(popup) && /!enabled \|\| count <= 0/.test(popup) && !/setInterval/.test(popup));
assert("P4 approve / reject use the same call and the same role list as the Permissions screen, and tell the red circle to re-count", /\/api\/join\/requests\/\$\{req\.id\}/.test(popup) && /\/api\/roles/.test(popup) && /JOIN_CHANGED_EVENT/.test(popup));
assert("P5 the shared poll speeds up: 4 s while a code is on show (+20 s after), 15 s for a person who decides, and it is told `live` only if he decides", /LIVE_MS = 4_000/.test(poller) && /LIVE_TAIL_MS = 20_000/.test(poller) && /APPROVER_MS = 15_000/.test(poller) && /live: codes > 0/.test(count) && /\{ enabled: true, count: 0 \}/.test(count));
assert("P6 a code lives 90 s and is renewed every 60 s while the 'add a person' window is open; the window makes its first code by itself", join.JOIN_CODE_TTL_MS === 90_000 && join.JOIN_CODE_RENEW_MS === 60_000 && /JOIN_CODE_RENEW_MS/.test(grid) && /makeCodeRef\.current\(true\)/.test(grid));
assert("P7 opening the link keeps THAT code alive for 10 minutes — a public, flag-first call that tells nothing about why a code is bad", join.JOIN_CLAIM_TTL_MS === 10 * 60_000 && /isJoinEnvEnabled\(\)/.test(claim) && !/requireWorkspaceAdmin/.test(claim) && /\/api\/join\/claim/.test(flow));
const ownerFn = store.slice(store.indexOf("function ownerDeviceData"), store.indexOf("\n}\n", store.indexOf("function ownerDeviceData")));
assert("P8 the owner's computer is a REMOTE (it controls, never plays, takes no seat); a computer that plays asks for Player and takes a numbered seat", /requestedRole: "REMOTE"/.test(ownerFn) && /approvedRole: "REMOTE"/.test(ownerFn) && !/"PLAYER"/.test(ownerFn) && /playerClass: "owner"/.test(ownerFn));
assert("P9 'may sign in from a computer' is OFF by default: in every ready-made role and in a role the owner adds", DEFAULT_ROLES.every((r) => r.allowComputer === false) && /name: newName, openControlRoom: false, allowComputer: false/.test(panel));
assert("P10 no gear tab between the Player's tabs", !/sb-gear-tab/.test(shell) && !/isGearTab/.test(shell) && /item\.labelKey !== "controlRoom"/.test(shell));

const rb = read("components/remote-bar/remote-bar.tsx");
const rbCss = read("components/remote-bar/remote-bar.css");
const settings = read("app/(app)/settings/page.tsx");
const gate = read("components/enrollment-gate.tsx");
assert("P11 the Remote strip (owner 2026-10-31): only on a screen that is NOT the player and not in the desktop app, mounted outside the control screens; it names the controlled branch + whether its player is online, says so plainly when none is, and the branch is chosen in the picker window", /!isControlScreen && !isDesktopApp \? <RemoteBar/.test(shell) && /!isPlayer && !isDesktopApp/.test(rb) && /ctx\.masterDeviceName/.test(rb) && /No player is connected/.test(rb) && /<BranchPicker/.test(rb) && !/WebSocket|sendCommand|setMaster|\.play\(/.test(rb));
assert("P12 while the strip shows, the header's own logo and way-back icon give way to the strip's, and the header slides under it", /html\[data-sb-remote-view\] header\[role="banner"\] \.sb-brand/.test(rbCss) && /\.sb-ctl-back/.test(rbCss) && /top: 56px/.test(rbCss) && /data-sb-remote-view/.test(rb));
assert("P13 the Owner tab is gone from the bar and its two pages live in Settings as tabs (Business, Remote control) for people who manage; /owner sends people to the Business tab; only the open tab is mounted", /HIDDEN_NAV_KEYS = new Set<string>\(\["remote", "settings", "owner"\]\)/.test(shell) && /<SettingsTabs/.test(settings) && /<OwnerControlPanel \/>/.test(settings) && /WorkspaceBusinessProfileForm/.test(settings) && /redirect\("\/settings\?tab=business"\)/.test(read("app/(app)/(workspace)/owner/page.tsx")) && /tab === "general" \? general : tab === "business" \? business : remote/.test(read("components/settings/settings-tabs.tsx")));
assert("P14 on an approved REMOTE the player-only settings (MASTER/CONTROL switch + mix, VONO Protection + local library) are hidden; a business without device approval sees them as before", (settings.match(/<PlayerDeviceOnly>/g) ?? []).length === 2 && /=== "REMOTE" \? null/.test(read("components/remote-bar/player-device-only.tsx")) && /vono_enr_ok/.test(read("lib/use-enrollment-gate.ts")));
assert("P15 the waiting screen has the 'cannot play yet' X mark and says what to do (wait for approval, or ask for more players)", /vono-enr-x/.test(gate) && /increase the number of players/.test(gate));
assert("P16 the Player / Remote icon in the top bar opens the details window and the gear-menu row is gone", /<DeviceRoleBadge onOpen=\{\(\) => setDeviceDetailsOpen\(true\)\} \/>/.test(shell) && !/<DeviceDetailsMenuRow/.test(shell));

const bp = read("components/remote-bar/branch-picker.tsx");
assert("P17 no branch chosen yet: the picker window opens BEFORE the remote is used (a manager only), with a search bar above a scrolling list of the branches that are playing live (offline ones only when none is live or when searching), the choice is the Control Room's own (stored target + a full load), and it can be left for the default branch", /const forced = canManage && !branch && !skipped/.test(rb) && /useRemoteOwner\(\)/.test(bp) && /placeholder=\{tr\("Search branches"\)\}/.test(bp) && /overflow-y: auto/.test(read("components/remote-bar/branch-picker.css")) && /liveRows\.length === 0 \|\| needle/.test(bp) && /setControlBranch\(/.test(bp) && /window\.location\.assign\("\/sources"\)/.test(bp) && /Not now — use the default branch/.test(bp) && !/WebSocket|sendCommand\(|setMaster|\.play\(/.test(bp));

const lite = read("app/lite-fx.css");
assert("P18 Lite graphics: the glass windows (details, People, join card, branch picker) are PLAIN — solid dark, or white with dark text in the white look (not on the always-black control screens) — and Full keeps the glass", /html\[data-sb-fx="lite"\] :is\(\.sb-devdet-panel, \.sb-pg-win, \.sb-jp, \.sb-bp-win\)/.test(lite) && /\[data-sb-display="white"\]:not\(\[data-sb-control\]\) :is\(\.sb-devdet-panel, \.sb-pg-win, \.sb-jp, \.sb-bp-win\) \* \{ color: #111111/.test(lite) && /backdrop-filter: blur\(72px\)/.test(read("components/roles/people-grid.css")));

const globalsCss = read("app/globals.css");
const statusRoute = read("app/api/devices/enrollment/status/route.ts");
assert("P19 a REMOTE only scrolls the song list: a click / double-click / Enter / drag on its rows or the Play Next pad is stopped before any handler runs, the pointer there is a red X, and the guard lives only while this screen is a Remote; the playback code is untouched", /LIST_AREA = "\.queue-row, \.play-next-pad, \.sb-queue-rowline"/.test(rb) && /const kinds = \["click", "dblclick", "keydown", "dragstart", "drop"\]/.test(rb) && /addEventListener\(k, shut, true\)/.test(rb) && /removeEventListener\(k, shut, true\)/.test(rb) && /data-sb-listlocked/.test(rb) && /html\[data-sb-listlocked\] :is\(\.queue-row, \.play-next-pad, \.sb-queue-rowline\)/.test(rbCss) && /ff3b30/.test(rbCss) && !/masterDeviceName\)\s*\{[^}]*shut/.test(rb));
assert("P20 the windows share the gear menu's glass: solid dark in the black / white look, frosted (white .19, blur 48px, saturate 1.2) in the transparent look — the same numbers as .main-menu-popover", /html :is\(\.sb-devdet-panel, \.sb-pg-win, \.sb-jp, \.sb-bp-win\) \{\s*background: rgba\(28, 28, 30, 0\.96\)/.test(globalsCss) && /html\[data-sb-display="song"\] :is\(\.sb-devdet-panel, \.sb-pg-win, \.sb-jp, \.sb-bp-win\) \{\s*background: rgba\(255, 255, 255, 0\.19\);\s*-webkit-backdrop-filter: blur\(48px\) saturate\(1\.2\)/.test(globalsCss));

assert("P21 a signed-in member's new browser / phone is a Remote at once (no request screen, no form, no 'I'm the owner' button): the status call settles it, a device a manager REVOKED stays revoked, and the request screen offers Remote only", /autoApproveRemote\(/.test(statusRoute) && !/ownerAllowed: true/.test(statusRoute) && /const phone = true;/.test(gate) && /existing\.status === "revoked"\) return null/.test(read("lib/device-enrollment-store.ts")));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
