/**
 * UI polish (owner 2026-10-28 / 29), source guards — no browser: album rows (the play icon sits ON the song's square, the number stays and is bold), library cards (no corner glyph square, the song count has
 * no dot and sits at the far side), the login screen's soft colourful blurred background (plain gradients, no blur filter), the Hebrew phrase for the count.
 * Run: npx tsx scripts/verify-ui-polish.ts
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
const read = (p: string) => readFileSync(path.join(__dirname, "..", p), "utf8");
const css = read("app/globals.css");
const album = read("components/album-workspace-panel.tsx");
const card = read("components/source-card-unified.tsx");
const login = read("app/login/page.tsx");
const phrases = read("lib/i18n/phrases.ts");

const rowArt = /<span className="sb-alb-art">[\s\S]*?<\/span>\s*<span className="sb-alb-info">/.exec(album)?.[0] ?? "";
const rowN = /<span className="sb-alb-n">[\s\S]*?<\/span>/.exec(album)?.[0] ?? "";
assert("P1 album row: the play icon is on the song's square (inside .sb-alb-art), not on the number", /sb-alb-art-play/.test(rowArt) && !/<svg/.test(rowN));
assert("P2 album row: the number stays on hover and is bold (no fade-out rule, weight >= 600), the square gets the veil + play", !/\.sb-alb-row:hover \.sb-alb-n b[^}]*opacity:\s*0/.test(css) && /\.sb-alb-n b \{[^}]*font-weight:\s*(6|7|8)00/.test(css) && /\.sb-alb-row:hover \.sb-alb-art-play/.test(css) && /\.sb-alb-art::after/.test(css));
assert("P3 library card: the little corner square with a playlist / album icon is gone", !/library-card-playlist-glyph/.test(card));
assert("P4 library card: the song count has no dot and no English 'item' — it is tr(\"{n} songs\") — and sits at the far side, bold", !/· \{itemCount\} item/.test(card) && /tr\("\{n\} songs", \{ n: itemCount \}\)/.test(card) && /\.library-card-platform-line-count[^{]*\{[^}]*margin-inline-start:\s*auto;[^}]*font-weight:\s*700/.test(css));
assert("P5 the Hebrew phrase for the count exists", /"\{n\} songs": "\{n\} שירים"/.test(phrases));
const ambient = /\.vono-ambient \{[^}]*\}/.exec(css)?.[0] ?? "";
assert("P6 the login screen has the soft colourful blurred background: radial gradients only (no blur filter — nothing heavy for a weak graphics card), lighter than before", /radial-gradient/.test(ambient) && !/filter:\s*blur/.test(ambient) && /className="vono-ambient /.test(login) && !/from-slate-950 via-slate-900/.test(login));

// ── 2026-10-29: the sign-in pages (no blue, white pill buttons) and the clean info icon ──
const authPages = ["app/login/page.tsx", "app/signup/page.tsx", "app/reset-password/page.tsx"].map((f) => read(f));
assert("P7 the sign-in pages have no blue left (no sky / cyan classes), no navy slate surfaces and no corrupted class names", authPages.every((t) => !/sky-|cyan-|slate-9|border-slate|white0/.test(t)));
assert("P8 the primary buttons are white pills with dark text, the inputs are soft pills without a frame, and the links are calm white", authPages.every((t) => !/type="submit"|Create workspace|Send/.test(t) || /rounded-full bg-\[#f5f5f7\]/.test(t)) && /rounded-2xl border-0 bg-white\/\[0\.09\]/.test(authPages[0]!) && /text-white\/85 underline-offset-4 hover:text-white hover:underline/.test(authPages[0]!));
const infoIcon = read("components/info-icon.tsx");
assert("P9 the 'i in a circle' is a drawn icon (a ring, a stem and a dot), not a text glyph, in the gear row and on the approvals switch", /<circle cx="12" cy="12" r="9\.2"/.test(infoIcon) && /<InfoIcon size=\{20\} \/>/.test(read("components/device-details.tsx")) && /<InfoIcon size=\{22\} \/>/.test(read("components/control-room/device-enrollment-panel.tsx")) && !/font: italic/.test(css.slice(css.indexOf(".sb-devdet-i {"), css.indexOf(".sb-devdet-i {") + 200)));

// ── 2026-11-04: the branch picker's row under the pointer is a soft shadow around it — no filled square, nothing bigger ──
const bpCss = read("components/remote-bar/branch-picker.css");
const liteCss = read("app/lite-fx.css");
const ctlWhite = read("app/control-white.css");
const bpHover = /\.sb-bp-row:hover \{[^}]*\}/.exec(bpCss)?.[0] ?? "";
assert("P9b branch picker: the hovered row has a shadow and no fill in the dark looks, the white look and the white control look; nothing scales and the list has room for the shadow", /background:\s*transparent;[^}]*box-shadow:/.test(bpHover) && !/transform|scale|font-size/.test(bpHover) && !/\.sb-bp-row:hover, \.sb-pg-btn:hover/.test(liteCss) && /\.sb-bp-row:hover \{ background: transparent !important; box-shadow:/.test(liteCss) && /\.sb-bp-row:hover \{ background: transparent; box-shadow:/.test(ctlWhite) && /\.sb-bp-list \{ margin: -2px -16px -14px;/.test(bpCss));

// ── 2026-11-05: scrolling the queue list is not movement — the FLIP pass measures boxes relative to the panel with the list's scroll added back ──
const lq = read("components/live-queue-panel.tsx");
const flipPass = lq.slice(lq.indexOf("const flipRectsRef"), lq.indexOf("flipRectsRef.current = next;"));
assert("P12 live queue FLIP: boxes are normalised against the panel and the list's scrollTop (a wheel step / state tick no longer glides every row), both the in-flight and the resting box", /const scroller = root\.querySelector<HTMLElement>\("\.sb-queue-body"\);/.test(flipPass) && /scroller\.contains\(el\) \? scrollTop : 0/.test(flipPass) && /const visual = running\.length \? norm\(el, el\.getBoundingClientRect\(\)\) : null;/.test(flipPass) && /const r = norm\(el, el\.getBoundingClientRect\(\)\);/.test(flipPass) && !/next\.set\(key, el\.getBoundingClientRect/.test(flipPass));

// ── 2026-11-03: the "New branch" tile's plus stands alone (no ring), in every look ──
const enrCss = read("components/control-room/device-enrollment.css");
const whiteCss = read("app/control-white.css");
assert("P10 the 'New branch' tile's plus has no ring in any look (resting and hovered) — only that tile, the shared tile-logo ring is untouched", /\[data-new-branch-tile\] \.cr-enr-tile-logo, \[data-new-branch-tile\]:hover \.cr-enr-tile-logo \{ box-shadow: none; \}/.test(enrCss) && /\[data-new-branch-tile\] \.cr-enr-tile-logo, html\[data-sb-display="white"\]\[data-sb-control\] \[data-new-branch-tile\]:hover \.cr-enr-tile-logo \{ box-shadow: none; \}/.test(whiteCss) && /\.cr-enr-tile-logo \{[^}]*box-shadow: inset 0 0 0 1\.6px/.test(enrCss));

// ── 2026-11-04: pulling the page down at the top does nothing (no rubber band, no pull-to-refresh) ──
assert("P11 the page does not overscroll at the top: html and body carry overscroll-behavior-y: none (no pull-to-refresh, no bounce)", /(^|\n)html,\s*\nbody \{\s*overscroll-behavior-y:\s*none;\s*\}/.test(css));

// ── 2026-11-05: a STATE_UPDATE identical to the last applied one apart from `positionAt` is not applied (MAIN publishes 4+/s with whole-second positions; each one re-rendered 36 consumers) ──
const dpc = read("lib/device-player-context.tsx");
assert("P15 mirror state: onStateUpdate drops a message identical to the last applied one except positionAt (a stalled position is still re-applied every 1.5 s), and everything else is applied at once", /const \{ positionAt, \.\.\.rest \} = state;/.test(dpc) && /if \(key !== "" && key === last\.key && at - last\.at < 1500\) return;/.test(dpc) && /lastAppliedStateRef\.current = \{ key, at \};\s*setMasterState\(state\);/.test(dpc) && (dpc.match(/setMasterState\(/g) ?? []).length === 1);

// ── 2026-11-05: AppShell's own state (the gear menu opening, a nav hover …) no longer re-renders the three heavy prop-less children it renders directly ──
const shellSrc = read("components/app-shell.tsx");
assert("P16 app shell: the player, the queue and the display screen are rendered through prop-less React.memo wrappers (the gear menu opening no longer re-renders them), and no bare <AudioPlayer />, <LiveQueuePanel /> or <KioskDisplay /> is left in the shell's JSX", /const MemoAudioPlayer = React\.memo\(function MemoAudioPlayer\(\) \{\s*return <AudioPlayer \/>;/.test(shellSrc) && /const MemoLiveQueuePanel = React\.memo\(function MemoLiveQueuePanel\(\) \{\s*return <LiveQueuePanel \/>;/.test(shellSrc) && /const MemoKioskDisplay = React\.memo\(function MemoKioskDisplay\(\) \{\s*return <KioskDisplay \/>;/.test(shellSrc) && (shellSrc.match(/<AudioPlayer \/>/g) ?? []).length === 1 && (shellSrc.match(/<LiveQueuePanel \/>/g) ?? []).length === 1 && (shellSrc.match(/<KioskDisplay \/>/g) ?? []).length === 1 && (shellSrc.match(/<MemoAudioPlayer \/>/g) ?? []).length === 3);

// ── 2026-11-06: the collapsed queue strip fits its squares: strip 51px = 3px + 45px square + 3px (it was 7px, which clipped every row and left the playing square sticking out) ──
const stripCss = read("app/globals.css");
assert("P18 collapsed queue strip: the side padding is (51 - 45) / 2 = 3px — the later rule no longer sets 7px — the squares stay 45px in a 51px column, and the aside's scroll boxes lose BOTH the logical and the physical end padding (Hebrew mirrors the page; `pr-0.5` is the right side)", /\.library-deck-slot-aside \.overflow-y-auto \{ padding-inline-end: 0 !important; padding-right: 0 !important; \}/.test(stripCss) && /\.library-deck-slot-aside:has\(\.sb-queue-collapsed\) > div \{ padding: 3px !important; \}\s*\n\/\* 4\) Play Next/.test(stripCss) && !/\.sb-queue-collapsed\) > div \{ padding: 7px/.test(stripCss) && /grid-template-columns: 51px minmax\(0, 1fr\) 210px !important/.test(stripCss) && /\.sb-queue-collapsed \.sb-queue-tile \{ width: 45px !important; height: 45px !important; \}/.test(stripCss));

// ── 2026-11-06: ONE loading state — the playing square blurred with a ring (no 'Loading…' text, no strip); the next song's cover comes in from a blur and its text fades in ──
const lq2 = read("components/live-queue-panel.tsx");
assert("P19 queue loading: no literal English 'Loading…' text and no pending strip left in the queue panel; the playing row's tile is marked data-loading with a spinner while anything is pending; the CSS blurs the loading cover, spins the ring, and brings the next song's cover in from a blur with its text fading in (reduced motion: none)", !/>\s*Loading…\s*</.test(lq2) && !/pendingStrip|sb-queue-pending/.test(lq2) && !/sb-queue-pending/.test(stripCss) && /const nowLoading = qPending !== null;/.test(lq2) && /const isPendingRow = nowLoading;/.test(lq2) && /data-loading=\{isPendingRow \? "true" : undefined\}/.test(lq2) && /\{isPendingRow \? <span className="sb-queue-spinner" aria-hidden \/> : null\}/.test(lq2) && /\.queue-row \.h-12\.w-12\[data-loading="true"\] img \{ filter: blur\(5px\)/.test(stripCss) && /@keyframes sb-queue-spin/.test(stripCss) && /@keyframes sb-now-cover-in/.test(stripCss) && /@keyframes sb-now-text-in/.test(stripCss) && /\.queue-row-current \.h-12\.w-12:not\(\[data-loading="true"\]\) img \{ animation: sb-now-cover-in/.test(stripCss) && /prefers-reduced-motion: reduce\) \{\s*\.queue-row-current/.test(stripCss));
// ── 2026-11-05: the Live Queue diagnostic is read-only: it only listens, writes warn lines (never the address of a cover) and hooks the panel's FLIP pass with one no-op call ──
const qd = read("lib/queue-diag.ts");
const lqSrc = read("components/live-queue-panel.tsx");
const prov = read("app/(app)/providers.tsx");
assert("P17 queue-diag: read-only (observers + console.warn only, rate-limited, active only in the desktop shell or with the localStorage flag), logs the KIND of a cover source never its address, one hook in the panel's FLIP pass and the mount next to the perf diag", /MAX_LINES_PER_MINUTE = 12/.test(qd) && /syncbizDesktop/.test(qd) && /syncbiz-queuediag/.test(qd) && /function srcKind/.test(qd) && !/localStorage\.setItem|fetch\(|sendBeacon|XMLHttpRequest|\.src\s*=/.test(qd) && (lqSrc.match(/queueDiagFlip\(/g) ?? []).length === 1 && /<QueueDiag \/>/.test(prov));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
