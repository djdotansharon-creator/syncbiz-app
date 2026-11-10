/**
 * Owner 2026-11-10 — the update card: the amber "Update" ellipse opens a small rectangle (the version number, "What's new" on our site, "Update now"), with an opening effect,
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
assert("C1 the pill is a button that toggles the card (aria-haspopup=dialog / aria-expanded); the card is a portal to <body> with role=dialog", /<button[\s\S]{0,200}onClick=\{toggleCard\}[\s\S]{0,200}aria-haspopup="dialog"/.test(pill) && /aria-expanded=\{open && !closing\}/.test(pill) && /createPortal\(/.test(pill) && /role="dialog"/.test(pill));
assert("C2 the card shows the version number, 'What's new' → /whats-new (our site, a new window) and 'Update now' → the installer link", /className="sb-update-card-ver"[^>]*>\{target\.version\}/.test(pill) && /href="\/whats-new" target="_blank"/.test(pill) && /sb-update-card-btn--go" href=\{target\.href\}/.test(pill));
assert("C3 it closes by a click anywhere else (pointerdown outside the card and the pill, capture) and by Escape, through an exit effect (is-closing, 170 ms)", /addEventListener\("pointerdown", onDown, true\)/.test(pill) && /cardRef\.current\?\.contains\(n\) \|\| btnRef\.current\?\.contains\(n\)/.test(pill) && /e\.key === "Escape"/.test(pill) && /is-closing/.test(pill) && /, 170\)/.test(pill));
assert("C4 the existing pill contract is untouched: renders nothing without the desktop bridge, the short word inside span.sb-pill-t, no icon in the component", /if \(!bridge\) return;/.test(pill) && /<span className="sb-pill-t">\{text\}<\/span>/.test(pill) && !/<svg/.test(pill));
assert("C5 the CSS opens with an effect (blur + rise + scale, 260 ms) and closes with a quicker one, dark card in every look, reduced motion respected", /@keyframes sb-upd-in \{ from \{ opacity: 0; transform: translateY\(-8px\) scale\(0\.94\); filter: blur\(4px\);/.test(css) && /\.sb-update-card\.is-closing \{ animation: sb-upd-out 170ms/.test(css) && /\.sb-update-card \{[^}]*background: #1c1c1e/.test(css) && /prefers-reduced-motion: reduce\) \{ \.sb-update-card/.test(css));
assert("C6 Hebrew phrases exist for the card and the page", ["Update available", "What's new", "Update now", "What's new in VONO Player {v}", "No details were published for this version.", "All versions"].every((k) => rd("lib/i18n/phrases.ts").includes(`"${k}":`)));

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
