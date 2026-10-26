/**
 * Management Mode (owner 2026-10-11) — static guarantees. Run: npx tsx scripts/verify-management-mode.ts
 * Runtime proof was done separately (local dev: Player → Dashboard → Control Room → Access Control → Player, AppShell
 * diag remount=false on every step, the SAME player DOM node + media elements connected throughout).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const root = path.join(__dirname, "..");
const read = (...p: string[]) => readFileSync(path.join(root, ...p), "utf8");
const shell = read("components", "app-shell.tsx");
const css = read("app", "globals.css");
const dpc = read("lib", "device-player-context.tsx");

// 2026-10-26 (owner): the Jingles tab and the Lock screen design tab also run with the player closed (UI only, same mechanism) — the original three routes are unchanged
assert("M1 management routes = Dashboard, Control Room, Access Control (existing URLs) + the player-closed pages Jingles and Lock screen design",
  shell.includes(String.raw`const isManagementRoute = /^\/(dashboard|access-control|jingles|display-design|owner\/control-room)(\/|$)/.test(pathname ?? "");`));
assert("M2 still exactly three <AudioPlayer /> mounts (streamer / mobile / main) — no new instance, no new branch",
  (shell.match(/<AudioPlayer \/>/g) ?? []).length === 3);
assert("M3 the player row is the SAME element: only class + inert + aria-hidden toggle (no conditional render)",
  shell.includes('${isManagementRoute ? " mgmt-deck-hidden" : ""}') && shell.includes("inert={isManagementRoute}") &&
  !/isManagementRoute \? null|isManagementRoute && <AudioPlayer|!isManagementRoute \? \(\s*<div\s+className=\{`\$\{isMediaThemeRoute/.test(shell));
assert("M4 management nav: Dashboard | Control Room | Access Control + Back to Player",
  // 2026-10-12: labels come from the EN / HE management dictionary (same nav, same order, same Back to Player link)
  // 2026-10-13 (owner): Back to Player → /sources (the main player screen; was /library)
  shell.includes('aria-label={mgmt(locale).t("nav.aria")}') && shell.includes('t("nav.dashboard")') && shell.includes('t("nav.controlRoom")') && shell.includes('t("nav.accessControl")') && /href="\/sources"[\s\S]{0,1200}t\("nav\.backToPlayer"\)/.test(shell));
const browserRule = css.match(/\[data-management="true"\] \.mgmt-deck-hidden \{([\s\S]*?)\}/)?.[1] ?? "";
assert("M5 CSS: browser = tiny transparent fixed box (YouTube keeps playing); desktop app = display:none (no MPV slot rect)",
  browserRule.includes("position: fixed !important;") && browserRule.includes("opacity: 0 !important;") && browserRule.includes("width: 320px !important;") && !browserRule.includes("display: none") &&
  /\[data-management="true"\]\[data-desktop-app="true"\] \.mgmt-deck-hidden \{\s*display: none !important;/.test(css));
assert("M6 Dashboard + Access Control moved out of (workspace); URLs unchanged; no copies left behind",
  existsSync(path.join(root, "app", "(app)", "dashboard", "page.tsx")) && existsSync(path.join(root, "app", "(app)", "access-control", "page.tsx")) &&
  !existsSync(path.join(root, "app", "(app)", "(workspace)", "dashboard")) && !existsSync(path.join(root, "app", "(app)", "(workspace)", "access-control")));
assert("M7 device-socket route rules still cover /dashboard and /access-control (unchanged)",
  dpc.includes('pathname === "/access-control" || pathname.startsWith("/access-control/")') && /\["\/dashboard", "\/owner", "\/logs", "\/architecture"\]/.test(dpc));
assert("M8 no player / provider / device-player-context code touched by this change (diff scope)",
  !/isManagementRoute/.test(dpc) && !/isManagementRoute/.test(read("lib", "playback-provider.tsx")) && !/isManagementRoute/.test(read("components", "audio-player.tsx")));

console.log(`\n${pass} passed, ${fail} failed`);
