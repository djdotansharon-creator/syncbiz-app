/**
 * Owner 2026-11-10 — the update card: the amber "Update" ellipse itself grows into an amber rectangle (the version number, a small borderless "What's new" on our site, the one-word Update button at the bottom — no date),
 * closed by a click anywhere else (or Escape). Plus the public /whats-new page that shows the latest release's short headlines. Static + pure checks.
 * Run: npx tsx scripts/verify-update-card.ts
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { parseReleaseNotes } from "../lib/release-notes";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const rd = (p: string) => readFileSync(path.join(__dirname, "..", p), "utf-8").replace(/\r\n/g, "\n");

const pill = rd("components/desktop-update-pill.tsx");
const css = rd("app/globals.css");
assert("C1 the pill is a button that toggles the card (aria-haspopup=dialog / aria-expanded); the card is a portal to <body> with role=dialog and it GROWS out of the pill (starts at the pill's own size, same colour)", /<button[\s\S]{0,200}onClick=\{toggleCard\}[\s\S]{0,200}aria-haspopup="dialog"/.test(pill) && /aria-expanded=\{open && !closing\}/.test(pill) && /createPortal\(/.test(pill) && /role="dialog"/.test(pill) && /width: expanded \? CARD_W : geo\.pw/.test(pill) && /height: expanded \? fullH : geo\.ph/.test(pill) && /style=\{open \? \{ visibility: "hidden" \} : undefined\}/.test(pill));
assert("C2 the card holds: the version number (centred, NO date), the one-word Update button under it (the install link, nothing longer), and a small 'What's new' UNDER the button → /whats-new (our site, a new window)", /className="sb-update-ver" dir="ltr">\{target\.version\}<\/span>/.test(pill) && !/dateText|sb-update-date|releasedAt/.test(pill) && /className="sb-update-new" href="\/whats-new" target="_blank"/.test(pill) && /className="sb-update-go" href=\{target\.href\}/.test(pill) && /<span className="sb-pill-t">\{text\}<\/span>\s*<\/a>/.test(pill) && pill.indexOf('className="sb-update-ver"') < pill.indexOf('className="sb-update-new"') && pill.indexOf('className="sb-update-go"') < pill.indexOf('className="sb-update-new"') && /\.sb-update-ver \{ text-align: center;/.test(css) && /\.sb-update-new \{ align-self: center;/.test(css) && !/target\.items|syncEdges/.test(pill));
assert("C3 it closes by a click anywhere else (pointerdown outside the card and the pill, capture) and by Escape, by folding back into the pill (a timed exit)", /addEventListener\("pointerdown", onDown, true\)/.test(pill) && /cardRef\.current\?\.contains\(n\) \|\| btnRef\.current\?\.contains\(n\)/.test(pill) && /e\.key === "Escape"/.test(pill) && /setExpanded\(false\)/.test(pill) && /CLOSE_MS/.test(pill));
assert("C4 the existing pill contract is untouched: renders nothing without the desktop bridge, the short word inside span.sb-pill-t, no icon in the component", /if \(!bridge\) return;/.test(pill) && /<span className="sb-pill-t">\{text\}<\/span>/.test(pill) && !/<svg/.test(pill));
assert("C5 the card CSS: amber with dark text (orange with WHITE text on the white look, the pill too), grows with a width/height/radius transition, 'What's new' is small + not bold + borderless + ALWAYS underlined, under the Update button", /\.sb-update-card\[data-sb-update="available"\][^}]*--upd-bg: #fbbf24; --upd-fg: #1c1400/.test(css) && /html\[data-sb-display="white"\] \.sb-update-pill\[data-sb-update="available"\], html\[data-sb-display="white"\] \.sb-update-card\[data-sb-update="available"\] \{ --upd-bg: #ea580c; --upd-fg: #ffffff/.test(css) && /transition: width 300ms[^;]*, height 300ms[^;]*, border-radius 300ms/.test(css) && /\.sb-update-new \{[^}]*font-size: 10px; font-weight: 400; color: var\(--upd-fg\); text-decoration: underline;[^}]*border: 0;[^}]*\}/.test(css) && /\.sb-update-go \{ margin-top: 13px; \}/.test(css) && /prefers-reduced-motion: reduce\) \{ \.sb-update-card, \.sb-update-in, \.sb-update-ghost/.test(css));
const wn = rd("components/whats-new-notes.tsx");
assert("C5b the headlines on the /whats-new page have NO frame (no box around them) and scroll between a soft blur at the top (only once scrolled) and the bottom (only while more follows); scrollbar hidden; plain text only", !/rounded-2xl|bg-white\/\[0\.06\]|inset_0_0_0_1px/.test(rd("app/whats-new/page.tsx")) && /<WhatsNewNotes paragraphs=\{notes\.paragraphs\} items=\{notes\.items\}/.test(rd("app/whats-new/page.tsx")) && /el\.scrollTop > 2/.test(wn) && /sb-wn-fade--top\$\{edge\.top \? " is-on" : ""\}/.test(wn) && /sb-wn-fade--bot\$\{edge\.bottom \? " is-on" : ""\}/.test(wn) && !/dangerouslySetInnerHTML/.test(wn) && /\.sb-wn-scroll \{[^}]*overflow-y: auto;[^}]*scrollbar-width: none/.test(css) && !/\.sb-wn-scroll \{[^}]*(border|box-shadow|background)/.test(css) && /\.sb-wn-fade \{[^}]*backdrop-filter: blur\(4px\)/.test(css));
assert("C5c the page's button says just 'Update' (no 'now', no size inside it); the size sits next to the release date under the title", /\{tr\("Update"\)\}/.test(rd("app/whats-new/page.tsx")) && !/Update now/.test(rd("app/whats-new/page.tsx")) && /\{mb \? <span dir="ltr">\{mb\} MB<\/span> : null\}/.test(rd("app/whats-new/page.tsx")));
assert("C6 Hebrew phrases exist for the card and the page", ["What's new", "What's new in VONO Player {v}", "No details were published for this version.", "All versions", "Update"].every((k) => rd("lib/i18n/phrases.ts").includes(`"${k}":`)));

const page = rd("app/whats-new/page.tsx");
const mw = rd("middleware.ts");
assert("C7 /whats-new is a public server page (not in the middleware's protected prefixes) that reads the latest published release, shows its headlines as TEXT and offers the installer", existsSync(path.join(__dirname, "..", "app/whats-new/page.tsx")) && !/"\/whats-new"/.test(mw) && /resolveLatestWindowsInstaller\(\)/.test(page) && /parseReleaseNotes\(latest\?\.notes\)/.test(page) && !/dangerouslySetInnerHTML/.test(page) && /href="\/api\/desktop\/installer"/.test(page) && /min-h-screen w-full bg-\[#0b0f16\]/.test(page));
assert("C8 the resolver carries the release title + notes", /notes: typeof r\.body === "string"/.test(rd("lib/desktop-installer-resolve.ts")));

// ── the notes parser ──
const body = "VONO Player for Windows, 2.3.2.\r\n\r\n- Dragging the time bar from a phone or browser now makes the station jump, and it stays.\r\n- **Hebrew** and `code` and [a link](https://x.y) are plain text.\r\n\r\nInstaller facts: VONO-Player-Setup-2.3.2-x64.exe · 143,349,153 bytes · SHA-256 abc";
const n = parseReleaseNotes(body);
assert("C9 notes: bullets become the list, other lines paragraphs, markdown marks are stripped, the 'Installer facts' block is cut", n.items.length === 2 && n.items[1] === "Hebrew and code and a link are plain text." && n.paragraphs.length === 1 && !JSON.stringify(n).includes("SHA-256"));
assert("C10 notes: empty / missing → nothing", parseReleaseNotes(null).items.length === 0 && parseReleaseNotes("").paragraphs.length === 0 && parseReleaseNotes("   \n\n").items.length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
