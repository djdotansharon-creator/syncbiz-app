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
assert("C8 the control bar holds Control Room, Dashboard, Permissions, Display and Settings, each an icon + a word", ["/owner/control-room", "/dashboard", "/access-control\"", "/access-control/display", "/settings"].every((h) => bar.includes(`href: "${h.replace(/"$/, "")}"`)) && /<span className="sb-ctl-ico">\{it\.icon\}\{it\.dot\}<\/span>\s*<span>\{it\.label\}<\/span>/.test(bar));
assert("C9 the pill tabs inside the pages are hidden on the control screen but the desktop Lock button beside them is not", /\.cr-tabs-row \.cr-tabs \{ display: none !important; \}/.test(css) && !/\.cr-tabs-row \{[^}]*display: none/.test(css));
assert("C10 a browser manager reaches the control screen by the icon in the player\'s corner; the Player computer (desktop app) has NO gear tab between the tabs (owner 2026-10-31) — Settings is the gear menu's \"More settings\"", /\{canManage && !isDesktopApp && !isManagementRoute \? <ControlBackIcon \/> : null\}/.test(shell) && /item\.labelKey !== "controlRoom" && pinnedSet/.test(shell) && !/isGearTab/.test(shell) && !/sb-gear-tab/.test(shell) && /href="\/settings"/.test(shell) && /More settings/.test(shell));
assert("C11 Settings is outside the player\'s rails workspace (a full plain screen)", existsSync("app/(app)/settings/page.tsx") && !existsSync("app/(app)/(workspace)/settings/page.tsx"));

const hold = read("components/enrollment-hold.tsx");
assert("C12 only an APPROVED REMOTE opens on the control screen — and only once per tab, only from the player\'s home (so the corner button and Back are never fought)", /st\.status === "approved" && st\.role === "REMOTE"/.test(hold) && /vono_remote_home/.test(hold) && /pathname === "\/" \|\| pathname === "\/sources"/.test(hold) && /router\.replace\("\/owner\/control-room"\)/.test(hold));
assert("C13 a Player (the owner\'s own computer, a station) gets no redirect: the landing component is mounted for REMOTE only", /role === "REMOTE"[\s\S]{0,200}<RemoteHome \/>/.test(hold) && (hold.match(/<RemoteHome \/>/g) ?? []).length === 1);

// ── 2026-10-29 (owner): Settings beside the Control Room; the Player button at the END edge (left in Hebrew, right in English), the VONO mark at the START edge; the way back lands in the very same spot ──
const order = [...bar.matchAll(/\{ href: "([^"]+)", label: [^}]+icon:/g)].map((m) => m[1]);
assert("C14 the buttons are Settings (FIRST, the outermost), Control Room, Dashboard, Permissions, Display — in that order", order.join(",") === "/settings,/owner/control-room,/dashboard,/access-control,/access-control/display", order);
assert("C15 the VONO mark is the first thing (the START edge) and the Player button the last (the END edge), inside the bar's grid", bar.indexOf('className="sb-ctl-brand') < bar.indexOf('className="sb-ctl-nav"') && bar.indexOf('className="sb-ctl-nav"') < bar.indexOf('className="sb-ctl-corner"') && /grid-template-columns: 1fr auto 1fr/.test(css) && /\.sb-ctl-brand \{ justify-self: start; \}/.test(css) && /\.sb-ctl-corner \{ justify-self: end;/.test(css));
assert("C16 the Player button's ICON is its end-most part (word first, icon last) — so it is the same spot as the player's back icon", /<span>\{tr\("Player"\)\}<\/span>\s*<i className="sb-ctl-corner-ico"><PlayerIcon \/><\/i>/.test(bar));
const shellSrc = shell;
const backIcon = read("components/control-screen/control-back-icon.tsx");
assert("C17 in the player the way back is the LAST item of the bar\'s right block (end-most corner), not in the left block", shellSrc.indexOf('<DesktopUpdatePill />') < shellSrc.indexOf("<ControlBackIcon />") && shellSrc.indexOf("<ControlBackIcon />") < shellSrc.indexOf("Row 3: Player") && /className="sb-ctl-back"/.test(backIcon) && /\.sb-ctl-back \{ order: 100;/.test(css));
assert("C18 both bars are 56px tall with the same 16px side padding and 34px icon boxes (measured to land the two icons at the same x / y)", /\.sb-ctl-bar \{[^}]*height: 56px; padding-inline: 16px;/.test(css) && /\.sb-ctl-corner-ico \{[^}]*width: 34px; height: 34px;/.test(css) && /\.sb-ctl-back \{[^}]*width: 34px; height: 34px;/.test(css));

// ── 2026-10-30 (owner): no such button in the PLAYER; a gear for the Player computer; the red circles; automatic entry by role ──
assert("C19 the way back to the control screen is NOT shown on a screen that is the PLAYER (MASTER / designated audio station) — only on a Remote", /const isPlayer = !!ctx && \(ctx\.deviceMode === "MASTER" \|\| ctx\.isDesignatedAudioStation\)/.test(backIcon) && /if \(isPlayer\) return null;/.test(backIcon));
const dots = read("components/control-screen/pending-dots.tsx");
assert("C20 red circles: people waiting to join AND devices waiting for approval are both counted on Permissions (owner 2026-10-31: the requests moved there), and on the way back to the control screen", /dot: <AnyPendingDot \/>/.test(bar) && !/dot: <EnrollmentPendingDot \/>/.test(bar) && /<AnyPendingDot \/>/.test(backIcon) && /join \+ devices/.test(dots));
const layoutSrc = read("app/(app)/layout.tsx");
const landing = read("components/control-screen/role-landing.tsx");
assert("C21 automatic entry by role: only a person WITH a role that opens the Control Room, only in a browser (never a phone / the desktop app), once per tab, only from the player\'s home", /landOnControl = !computerBlocked && role\?\.openControlRoom === true/.test(layoutSrc) && /\{landOnControl \? <RoleLanding \/> : null\}/.test(layoutSrc) && /!isPhoneUa\(ua\) && !isDesktopShellUserAgent\(ua\)/.test(layoutSrc) && /vono_remote_home/.test(landing) && /pathname === "\/" \|\| pathname === "\/sources"/.test(landing));
const pendingApi = read("app/api/join/pending-count/route.ts");
assert("C22 the join count answers {enabled:false,count:0} before any database or session call when the feature is off, and only a workspace admin gets a real number", pendingApi.indexOf("isJoinEnvEnabled()") < pendingApi.indexOf("requireWorkspaceAdmin()") && /enabled: false, count: 0/.test(pendingApi));

// ── 2026-10-30 (owner): "organize the design of the whole control area in OUR design line" — the control skin ──
const skin = read("components/control-screen/control-skin.css");
const selectors = [...skin.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(^|\})\s*([^{}]+)\{/g)].map((m) => m[2].trim()).filter(Boolean);
const scoped = (sel: string) => sel.split(/,(?![^(]*\))/).every((part) => /^(\[data-control-screen="true"\] \.mgmt-type|html\[data-sb-control\])/.test(part.trim()));
assert("C23 the skin touches ONLY the control screen: every selector starts under [data-control-screen] .mgmt-type or html[data-sb-control] (the player and every other screen are untouched)", selectors.length > 10 && selectors.every(scoped), selectors.filter((x) => !scoped(x)));
assert("C24 the line: cards lose their border (soft glass), buttons are soft pills, the main action is a solid WHITE pill (never blue), a destructive one the danger red, fields are filled and borderless, windows that open on a click are glass", /border-color: transparent !important;\s*background: linear-gradient/.test(skin) && /border-radius: 999px !important/.test(skin) && /background: rgba\(255, 255, 255, 0\.94\) !important;\s*color: #0a0a0a/.test(skin) && /background: #ff453a !important/.test(skin) && /border: 0 !important;\s*background: rgba\(255, 255, 255, 0\.07\)/.test(skin) && /backdrop-filter: blur\(48px\)/.test(skin) && !/#0a84ff;/.test(skin.replace(/\[class\*="bg-\[#0a84ff\]"\]/g, "")));
assert("C25 the windows that open on a click (portals) are reached through a mark on the document, set when the control bar mounts and removed when it goes", /setAttribute\("data-sb-control", "1"\)/.test(bar) && /removeAttribute\("data-sb-control"\)/.test(bar) && /import "\.\/control-skin\.css"/.test(bar));
const dash = read("app/(app)/dashboard/page.tsx");
assert("C26 the Dashboard has no blue links and its page has side padding like the other screens", !/text-sky-/.test(dash) && /px-4 pb-8 pt-2 sm:px-6/.test(dash));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
