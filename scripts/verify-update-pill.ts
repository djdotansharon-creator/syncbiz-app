/**
 * Owner 2026-11-02 — the player's "Update" / "עדכון" pill: a flat ellipse, no frame, right next to the logo, desktop app only;
 * amber = an update is available, red = this engine is older than MIN_ENGINE_VERSION. The "Player details" window shows the
 * engine version. Run: npx tsx scripts/verify-update-pill.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { isNewer, isBelowMinEngine, MIN_ENGINE_VERSION, LAST_LEGACY_VERSION } from "../lib/desktop-version";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const rd = (p: string) => readFileSync(path.join(__dirname, "..", p), "utf-8").replace(/\r\n/g, "\n");

// ── version rules ──
assert("U1 2.3.0 is newer than every October beta (2.2.8-beta.21) and than 2.2.7", isNewer("2.3.0", "2.2.8-beta.21") && isNewer("2.3.0", "2.2.7"));
assert("U2 same / older / not-a-version → never 'newer'", !isNewer("2.3.0", "2.3.0") && !isNewer("2.2.8", "2.3.0") && !isNewer("latest", "2.3.0") && !isNewer("2.3.0", ""));
assert("U3 the minimum engine is OFF by default (nobody sees 'Update required' by accident)", MIN_ENGINE_VERSION === "0.0.0" && !isBelowMinEngine("2.2.7") && !isBelowMinEngine(null));
assert("U4 with a minimum set: older → required, equal / newer → fine, a bridge-less legacy client → required", isBelowMinEngine("2.2.8", "2.3.0") && !isBelowMinEngine("2.3.0", "2.3.0") && !isBelowMinEngine("2.3.1", "2.3.0") && isBelowMinEngine(null, "2.3.0") && LAST_LEGACY_VERSION === "0.1.2");

// ── the pill ──
const pill = rd("components/desktop-update-pill.tsx");
const shell = rd("components/app-shell.tsx");
const cls = (pill.match(/const PILL_BASE =([\s\S]*?);\nconst PILL_AMBER = "([^"]*)";\nconst PILL_RED = "([^"]*)";/) ?? []);
const all = (cls[1] ?? "") + (cls[2] ?? "") + (cls[3] ?? "");
assert("U5 a flat ellipse: rounded-full, NO border / ring / shadow / gradient / blur", /rounded-full/.test(all) && !/\bborder|ring-1|shadow|gradient|blur/.test(all));
assert("U6 amber (#fbbf24, dark text) for 'available', red (#dc2626, white text) for 'required'", /bg-\[#fbbf24\] text-\[#1c1400\]/.test(all) && /bg-\[#dc2626\] text-white/.test(all));
assert("U7 text only (no icon / long label): the pill renders the short word", /\{text\}/.test(pill) && !/<svg/.test(pill) && /desktopUpdatePill/.test(pill) && /desktopUpdateRequiredPill/.test(pill));
assert("U8 renders nothing in a browser (needs the desktop bridge) and keeps the legacy-client rule", /if \(!bridge\) return;/.test(pill) && /LAST_LEGACY_VERSION/.test(pill));
const leftBlock = shell.slice(shell.indexOf('className="sb-brand flex shrink-0 items-center"'), shell.indexOf("<HeaderDeviceIndicators />"));
assert("U9 mounted ONCE, in the logo's block right after the logo — not in the right-hand block any more", (shell.match(/<DesktopUpdatePill \/>/g) ?? []).length === 1 && /<DesktopUpdatePill \/>/.test(leftBlock));
const tr = rd("lib/translations.ts");
assert("U10 Hebrew 'עדכון' / 'עדכון נדרש' and English 'Update' / 'Update required'",
  /desktopUpdatePill: "Update",/.test(tr) && /desktopUpdateRequiredPill: "Update required",/.test(tr) && /desktopUpdatePill: "עדכון",/.test(tr) && /desktopUpdateRequiredPill: "עדכון נדרש",/.test(tr));

// ── the details window ──
const dd = rd("components/device-details.tsx");
assert("U11 'Player details' shows the engine version only in the desktop app, with a link when a newer one is published",
  /\{isDesktop \? \(\s*<div>\s*<dt>\{t\.version\}/.test(dd) && /isNewer\(engine\.latest, engine\.current\)/.test(dd) && /updateTo/.test(dd));

console.log(`\n${pass} passed, ${fail} failed`);
