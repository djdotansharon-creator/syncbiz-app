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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
