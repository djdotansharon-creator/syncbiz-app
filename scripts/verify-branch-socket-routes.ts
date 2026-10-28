/**
 * Every top-nav route keeps the branch device socket (the IRON RULE in lib/device-player-context.tsx: navigating between top-bar tabs never drops the lease, never loses the mirrored song).
 * Jingles and the lock-screen design were missing from the list (owner 2026-10-29: on those pages a Remote lost the song's blurred background). Source-text guard, no browser.
 * Run: npx tsx scripts/verify-branch-socket-routes.ts
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
const ctx = readFileSync(path.join(__dirname, "..", "lib", "device-player-context.tsx"), "utf8");
const shell = readFileSync(path.join(__dirname, "..", "components", "app-shell.tsx"), "utf8");
const list = /for \(const r of \[([^\]]*)\]\) \{\s*if \(pathname === r/.exec(ctx)?.[1] ?? "";
const covered = (r: string) => new RegExp(`"${r}"`).test(list) || new RegExp(`pathname === "${r}"`).test(ctx) || new RegExp(`"${r}"`).test(ctx.slice(ctx.indexOf("ELIGIBLE_BROWSER_PLAYER_ROUTES"), ctx.indexOf("ELIGIBLE_BROWSER_PLAYER_ROUTES") + 200));

assert("R1 Jingles and the lock-screen design keep the branch device socket like every other top-nav page", /"\/jingles"/.test(list) && /"\/display-design"/.test(list));
assert("R2 every management route the shell knows about (isManagementRoute) is covered by the rule", ["dashboard", "access-control", "jingles", "display-design", "owner"].every((r) => covered(`/${r}`)) && /isManagementRoute = \/\^\\\/\(dashboard\|access-control\|jingles\|display-design\|owner\\\/control-room\)/.test(shell));
assert("R3 the rule is only widened: the local-playback gate (isEligibleBrowserPlayerRoute / isBrowserNonExecutingRoute) is untouched, so the new pages behave exactly like /schedules and /radio", /const ELIGIBLE_BROWSER_PLAYER_ROUTES = \["\/player", "\/remote-player", "\/streamer", "\/sources", "\/mobile"\] as const;/.test(ctx) && /if \(pathname === "\/library" \|\| pathname\.startsWith\("\/library\/"\)\) return true;/.test(ctx));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
