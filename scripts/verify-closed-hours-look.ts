/**
 * THE CLOSED TIME IN THE STUDIO (owner 2026-11-22, Dotan approved: "do it, let's see it's good — but it must not stand out: the time the business is closed is just a background of diagonal stripes at an equal
 * distance, no frame; a thin red line where it closes, a thin green one where it opens"). Pure drawing data (lib/schedules-timeline.ts) + the wiring in the Studio. NO block is created or changed here: the
 * Business-hours tool, `closingPlan` and `saveClosing` are untouched.
 * Run: npx tsx scripts/verify-closed-hours-look.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { openSpans, closedSpans, bizEdges, closingPlan, type BizHours } from "../lib/schedules-timeline";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const rd = (p: string) => readFileSync(path.join(__dirname, "..", p), "utf-8").replace(/\r\n/g, "\n");
const J = JSON.stringify;
const same = (o: number, c: number): BizHours => ({ h24: false, same: true, all: { open: o, close: c }, days: [] });
const perDay = (days: ({ open: number; close: number } | null)[]): BizHours => ({ h24: false, same: false, all: { open: 480, close: 1380 }, days });

// ── the pure rule ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
assert("T1 08:00–23:00: open 8–23, closed 0–8 and 23–24, the red line at 23:00 and the green one at 08:00", J(openSpans(same(480, 1380), 2)) === "[[480,1380]]" && J(closedSpans(same(480, 1380), 2)) === "[[0,480],[1380,1440]]" && J(bizEdges(same(480, 1380), 2)) === '{"closes":[1380],"opens":[480]}');
assert("T2 a night past midnight (18:00 → 02:00): open 0–2 (yesterday's night) and 18–24, closed 2–18; red at 02:00, green at 18:00", J(openSpans(same(1080, 120), 3)) === "[[0,120],[1080,1440]]" && J(closedSpans(same(1080, 120), 3)) === "[[120,1080]]" && J(bizEdges(same(1080, 120), 3)) === '{"closes":[120],"opens":[1080]}');
assert("T3 closing at 00:00: open to the end of the day — no red line at the day's edge", J(closedSpans(same(480, 0), 1)) === "[[0,480]]" && J(bizEdges(same(480, 0), 1)) === '{"closes":[],"opens":[480]}');
assert("T4 round the clock: nothing closed, no lines", J(closedSpans({ h24: true, same: true, all: { open: 0, close: 1440 }, days: [] }, 5)) === "[]" && J(bizEdges({ h24: true, same: true, all: { open: 0, close: 1440 }, days: [] }, 5)) === '{"closes":[],"opens":[]}');
const days = perDay([null, { open: 600, close: 1320 }, { open: 1200, close: 180 }, null, { open: 480, close: 1380 }, { open: 480, close: 1380 }, null]);
assert("T5 a day with no hours is closed the whole day (no lines)", J(closedSpans(days, 0)) === "[[0,1440]]" && J(bizEdges(days, 0)) === '{"closes":[],"opens":[]}');
assert("T6 each day on its own hours; an overnight night spills into the next day even when THAT day is closed (Tuesday 20:00 → 03:00 opens Wednesday's early morning)", J(openSpans(days, 1)) === "[[600,1320]]" && J(openSpans(days, 2)) === "[[1200,1440]]" && J(openSpans(days, 3)) === "[[0,180]]" && J(closedSpans(days, 3)) === "[[180,1440]]");
assert("T7 an open span that touches the next one is merged (no hairline between them); the spans never overlap and always lie inside 0–1440", J(openSpans(same(480, 480), 0)) === "[[0,1440]]" && [0, 1, 2, 3, 4, 5, 6].every((d) => [same(480, 1380), same(1080, 120), same(0, 0), days].every((b) => [...openSpans(b, d), ...closedSpans(b, d)].every(([a, z]) => a >= 0 && z <= 1440 && a < z))));
assert("T8 the Business-hours tool is untouched: closingPlan still gives the same minutes (08–23 → every day 23:00; closes 00:00 → none, the known gap, unchanged)", J(closingPlan(same(480, 1380))) === J([1380, 1380, 1380, 1380, 1380, 1380, 1380]) && J(closingPlan(same(480, 0))) === J([null, null, null, null, null, null, null]));

// ── the wiring ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const tsx = rd("components/schedules-studio/schedules-studio.tsx");
const css = rd("app/schedules-studio.css");
assert("W1 the closed time is drawn FIRST in each of the three tracks (week rows, week columns, day rows) so every block sits above it", /\{bizBand\(d, "h"\)\}\s*\{\(weekScenes\[d\] \?\? \[\]\)\.map\(\(sc\) => renderBlock\(sc, "h"\)\)\}/.test(tsx) && /\{bizBand\(d, "v"\)\}\s*\{\(weekScenes\[d\] \?\? \[\]\)\.map\(\(sc\) => renderBlock\(sc, "v"\)\)\}/.test(tsx) && /\{bizBand\(focusDay, "h"\)\}\s*\{row\.scenes\.map\(\(sc\) => renderBlock\(sc, "h"\)\)\}/.test(tsx));
const fn = tsx.slice(tsx.indexOf("const bizBand = (d: number, orient: Orient)"), tsx.indexOf("const slotFor = (day: number"));
assert("W2 nothing is drawn until the hours are set, nor when open round the clock; only what lies inside the shown hours is drawn (the lines never sit on the very edge)", /if \(!biz \|\| biz\.h24\) return null;/.test(fn) && /Math\.max\(s0, lo\)/.test(fn) && /Math\.min\(t0, hi\)/.test(fn) && /m > lo && m < hi/.test(fn) && !/createFromBody|saveClosing|fetch\(/.test(fn));
assert("W3 the root carries data-bizband only while the hours are set (so the Studio looks exactly as before without them); the quiet 'Closing' block gets is-closing", /data-bizband=\{biz && !biz\.h24 \? "1" : undefined\}/.test(tsx) && /sc\.quiet && sc\.schedule\.name === CLOSING_NAME \? " is-closing" : ""/.test(tsx));
assert("W4 the Business-hours tool itself is untouched: saveClosing / BusinessHoursDialog / closingPlan call are as before", /return saveClosing\(branchId, closingPlan\(next\)\);/.test(tsx) && /const saveClosing = useCallback\(/.test(tsx));
const add = css.slice(css.indexOf("/* ── CLOSED time (owner 2026-11-22"), css.indexOf(".ss-list--quiet"));
assert("C1 quiet and flat: a diagonal hatch at equal distance (the quiet block's own), no frame / border / shadow / blur / filter, lets every click through; thin soft lines (alpha ≤ .55), a light-display variant", add.length > 200 && /\.ss-closed \{[^}]*pointer-events: none[^}]*repeating-linear-gradient\(135deg/.test(add) && !/border:|box-shadow:|backdrop-filter|filter:|blur\(/.test(add.replace(/\.ss-block\.is-quiet\.is-closing \{[^}]*\}/g, "")) && /ss-edge--close \{ background: rgba\(255, 105, 97, 0\.5\)/.test(add) && /ss-edge--open \{ background: rgba\(48, 209, 88, 0\.5\)/.test(add) && /html\[data-sb-display="white"\] \.ss-edge--close/.test(add));
assert("C2 with the hours set the quiet Closing block stops painting a second, offset hatch (transparent) but keeps its place, name and time; selected it shows", /\.ss\[data-bizband="1"\] \.ss-block\.is-quiet\.is-closing \{ background: transparent; background-image: none; box-shadow: none; \}/.test(add) && /\.is-closing\.is-selected \{ background-color: var\(--ss-surface-2\)/.test(add));

console.log(`\n${pass} passed, ${fail} failed`);
