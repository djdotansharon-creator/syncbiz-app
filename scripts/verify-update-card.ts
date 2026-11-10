/**
 * Owner 2026-11-10 — the update card: the amber "Update" ellipse itself grows into an amber rectangle (the word Update, the version + release date, a small borderless "What's new" on our site, the headlines scrolling between a top/bottom blur),
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
assert("C2 the card holds: the word Update (the install link, nothing longer), the version + the release date under it, a small 'What's new' → /whats-new (our site, a new window), and the headlines", /className="sb-update-go" href=\{target\.href\}/.test(pill) && /<span className="sb-pill-t">\{text\}<\/span>\s*<\/a>/.test(pill) && /className="sb-update-ver"[^>]*>v\{target\.version\}/.test(pill) && /className="sb-update-date">· \{dateText\}/.test(pill) && /className="sb-update-new" href="\/whats-new" target="_blank"/.test(pill) && /target\.items\.map/.test(pill));
assert("C3 it closes by a click anywhere else (pointerdown outside the card and the pill, capture) and by Escape, by folding back into the pill (a timed exit)", /addEventListener\("pointerdown", onDown, true\)/.test(pill) && /cardRef\.current\?\.contains\(n\) \|\| btnRef\.current\?\.contains\(n\)/.test(pill) && /e\.key === "Escape"/.test(pill) && /setExpanded\(false\)/.test(pill) && /CLOSE_MS/.test(pill));
assert("C4 the existing pill contract is untouched: renders nothing without the desktop bridge, the short word inside span.sb-pill-t, no icon in the component", /if \(!bridge\) return;/.test(pill) && /<span className="sb-pill-t">\{text\}<\/span>/.test(pill) && !/<svg/.test(pill));
assert("C5 the CSS: the card is amber with dark text (orange with WHITE text on the white look, the pill too), grows with a width/height/radius transition, 'What's new' is small + not bold + borderless + underlined only on hover, the headlines have no frame", /\.sb-update-card\[data-sb-update="available"\][^}]*--upd-bg: #fbbf24; --upd-fg: #1c1400/.test(css) && /html\[data-sb-display="white"\] \.sb-update-pill\[data-sb-update="available"\], html\[data-sb-display="white"\] \.sb-update-card\[data-sb-update="available"\] \{ --upd-bg: #ea580c; --upd-fg: #ffffff/.test(css) && /transition: width 300ms[^;]*, height 300ms[^;]*, border-radius 300ms/.test(css) && /\.sb-update-new \{[^}]*font-size: 11px; font-weight: 400;[^}]*border: 0;[^}]*\}/.test(css) && /\.sb-update-new:hover, \.sb-update-new:focus-visible \{ text-decoration: underline/.test(css) && !/\.sb-update-notes \{[^}]*(border|box-shadow|background)/.test(css));
assert("C5b the headlines scroll between a soft blur at the top and the bottom (top only once scrolled, bottom only while more text follows; scrollbar hidden; real backdrop blur forced on for these two strips although Light mode switches it off elsewhere); reduced motion respected", /syncEdges/.test(pill) && /el\.scrollTop > 2/.test(pill) && /sb-update-fade--top\$\{edge\.top \? " is-on" : ""\}/.test(pill) && /sb-update-fade--bot\$\{edge\.bottom \? " is-on" : ""\}/.test(pill) && /scrollbar-width: none/.test(css) && /:root \.sb-update-fade \{ -webkit-backdrop-filter: blur\(3px\) !important; backdrop-filter: blur\(3px\) !important; \}/.test(css) && /prefers-reduced-motion: reduce\) \{ \.sb-update-card, \.sb-update-in, \.sb-update-ghost/.test(css));
assert("C5c the download API carries the release date (releasedAt) and the parsed headlines (notes) from the GitHub path; the pill reads them", /notes: parseReleaseNotes\(latest\.notes\)/.test(rd("app/api/desktop/download/route.ts")) && /data\.releasedAt/.test(pill) && /data\.notes\?\.items/.test(pill));
assert("C6 Hebrew phrases exist for the card and the page", ["What's new", "What's new in VONO Player {v}", "No details were published for this version.", "All versions", "Update now"].every((k) => rd("lib/i18n/phrases.ts").includes(`"${k}":`)));

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
