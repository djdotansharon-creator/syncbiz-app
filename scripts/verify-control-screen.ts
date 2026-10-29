/**
 * The CONTROL SCREEN (owner 2026-10-29) — static checks, no browser: which routes belong to it, that the player is never unmounted or hidden wholesale, that the way between the control screen and the
 * live player needs no code, and that a Remote's landing is once-per-tab and only for an approved Remote. Run: npx tsx scripts/verify-control-screen.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { isControlScreenPath } from "../lib/control-screen";

let pass = 0;
let fail = 0;
function assert(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === undefined ? "" : `   -> ${JSON.stringify(detail)}`}`);
  if (ok) pass++;
  else fail++;
}
const read = (p: string) => readFileSync(p, "utf8");

const yes = ["/dashboard", "/owner/control-room", "/access-control", "/access-control/display", "/settings", "/owner/control-room/x"];
const no = ["/", "/sources", "/library", "/radio", "/schedules", "/jingles", "/display-design", "/owner", "/owner/other", "/dashboards", "/settingsx", "/playlists/1/edit", "/mobile/home"];
assert("C1 the control screen is exactly: Control Room, Dashboard, Permissions (+ Display), Settings", yes.every((p) => isControlScreenPath(p)) && no.every((p) => !isControlScreenPath(p)), { wrong: [...yes.filter((p) => !isControlScreenPath(p)), ...no.filter((p) => isControlScreenPath(p))] });
assert("C2 no path (null / undefined) is a control path", !isControlScreenPath(null) && !isControlScreenPath(undefined) && !isControlScreenPath(""));

const shell = read("components/app-shell.tsx");
const css = read("components/control-screen/control-screen.css");
const bar = read("components/control-screen/control-bar.tsx");

assert("C3 the shell draws the control bar only on control paths, ABOVE the (kept) header, and marks the root data-control-screen", /isControlScreen \? <ControlBar[^>]*\/> : null\}\s*<header/.test(shell) && /data-control-screen=\{isControlScreen \? "true" : undefined\}/.test(shell));
assert("C4 PLAYBACK SAFETY: the player\'s top-bar row is hidden by CSS only (display:none on .sources-app-header-row1) — never the whole header, which holds the player deck, and never unmounted", /header \.sources-app-header-row1 \{ display: none !important; \}/.test(css) && !/header\.sticky \{[^}]*display: none/.test(css) && !/isControlScreen \? null/.test(shell));
assert("C5 the deck stays hidden exactly as in management mode (control routes are management routes)", /const isManagementRoute = isControlScreen \|\|/.test(shell));
assert("C6 plain black: the control root and its theme scope are #000", /\[data-control-screen="true"\][^{]*\{ background: #000 !important; \}/.test(css.replace(/\n/g, " ")));
assert("C7 the corner button goes to the live player with a plain link — no code, no lock call", /href="\/sources"/.test(bar) && !/management-unlock|verify-password/.test(bar));
assert("C8 the control bar holds Control Room, Dashboard, Permissions, Display and Settings, each an icon + a word", ["/owner/control-room", "/dashboard", "/access-control\"", "/access-control/display", "/settings"].every((h) => bar.includes(`href: "${h.replace(/"$/, "")}"`)) && /\{it\.icon\}\s*<span>\{it\.label\}<\/span>/.test(bar));
assert("C9 the pill tabs inside the pages are hidden on the control screen but the desktop Lock button beside them is not", /\.cr-tabs-row \.cr-tabs \{ display: none !important; \}/.test(css) && !/\.cr-tabs-row \{[^}]*display: none/.test(css));
assert("C10 a browser manager reaches the control screen by the icon in the player\'s corner; the Control Room TAB stays only in the desktop app", /className="sb-ctl-back"/.test(shell) && /item\.labelKey === "controlRoom" \? canManage && isDesktopApp/.test(shell));
assert("C11 Settings is outside the player\'s rails workspace (a full plain screen)", existsSync("app/(app)/settings/page.tsx") && !existsSync("app/(app)/(workspace)/settings/page.tsx"));

const hold = read("components/enrollment-hold.tsx");
assert("C12 only an APPROVED REMOTE opens on the control screen — and only once per tab, only from the player\'s home (so the corner button and Back are never fought)", /st\.status === "approved" && st\.role === "REMOTE"/.test(hold) && /vono_remote_home/.test(hold) && /pathname === "\/" \|\| pathname === "\/sources"/.test(hold) && /router\.replace\("\/owner\/control-room"\)/.test(hold));
assert("C13 a Player (the owner\'s own computer, a station) gets no redirect: the landing component is mounted for REMOTE only", /role === "REMOTE"[\s\S]{0,200}<RemoteHome \/>/.test(hold) && (hold.match(/<RemoteHome \/>/g) ?? []).length === 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
