/**
 * THE FLOW (owner 2026-11-18, an experiment): the phone's branch screen and a person's page as parts that scroll over a FIXED background, elements that rise into place with a small
 * overshoot (scrubbed by the scroll, so scrolling back plays it backwards), frameless rows, and details behind a closed arrow. Behavioural tests of the pure parts + static guards of the wiring.
 * Run: npx tsx scripts/verify-mobile-flow.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { easeOutBack, riseState } from "../components/vm/vm-flow";
import { branchFacts, canRenameBranch } from "../lib/use-branch-details";
import { PX_PER_MIN, boardLayout, dateKey, parseDateKey, shiftDay } from "../lib/day-board";
import type { Scene } from "../lib/schedules-timeline";

const root = path.join(__dirname, "..");
const rd = (p: string) => readFileSync(path.join(root, p), "utf-8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
function assert(name: string, cond: boolean): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (cond) pass++; else fail++;
}

const view = { top: 56, bottom: 700 };
const slotAt = (top: number, h = 60) => ({ top, bottom: top + h });

// ── the effect itself
const rest = riseState(slotAt(300), view);
assert("F1 an element fully inside the visible area is exactly at rest (no offset, full size, fully visible)", rest.y === 0 && rest.s === 1 && rest.o === 1);
const born = riseState(slotAt(view.bottom), view);
assert("F2 an element whose top is at the bottom edge has not appeared yet: 64 px low, 93 % size, invisible", Math.abs(born.y - 64) < 1e-9 && Math.abs(born.s - 0.93) < 1e-9 && born.o === 0);
const gone = riseState({ top: -80, bottom: view.top }, view);
assert("F3 an element whose bottom has reached the top edge has left: 34 px up, 6 % smaller, almost invisible", Math.abs(gone.y + 34) < 1e-9 && Math.abs(gone.s - 0.94) < 1e-9 && gone.o < 0.1);

// the entrance is monotonic in opacity and rises (offset shrinks) as the element comes up; the overshoot is small
let lastO = -1, monoO = true, minY = 1e9, lastY = 1e9, risesTo0 = true;
for (let top = view.bottom; top >= view.bottom - 200; top -= 5) {
  const st = riseState(slotAt(top), view);
  if (st.o < lastO - 1e-9) monoO = false;
  lastO = st.o;
  minY = Math.min(minY, st.y);
  if (st.y > lastY + 1e-9 && st.y > 0) risesTo0 = false; // while it is still low it only goes up
  lastY = st.y;
}
assert("F4 coming in: opacity only grows and the element only rises", monoO && risesTo0);
assert("F5 it is not a plain slide: it passes its resting place a little and settles (overshoot between 1 and 8 px), never a bounce", minY < -0.5 && minY > -8);
assert("F6 easeOutBack: 0 → 0, 1 → 1, never above 1.06 (a hint of spring)", easeOutBack(0) === 0 && Math.abs(easeOutBack(1) - 1) < 1e-12 && Array.from({ length: 101 }, (_, i) => easeOutBack(i / 100)).every((v) => v <= 1.06));
// scrolling back plays it backwards: the state is a pure function of the position (the same place → the same drawing, in both directions)
assert("F7 scrolling back plays it backwards: the drawing depends only on where the element is", JSON.stringify(riseState(slotAt(640), view)) === JSON.stringify(riseState(slotAt(640), view)) && riseState(slotAt(640), view).o < riseState(slotAt(560), view).o);

// ── branch details
assert("F8 the address is the Google one when there is one, otherwise street + number, city, country (what is filled in)", branchFacts({ id: "b", formattedAddress: "Allenby 1, Tel Aviv" }).address === "Allenby 1, Tel Aviv" && branchFacts({ id: "b", street: "Allenby", houseNumber: "1", city: "Tel Aviv", country: "IL" }).address === "Allenby 1, Tel Aviv, IL" && branchFacts({ id: "b" }).address === "");
assert("F9 the branch number is null when empty; the name is trimmed", branchFacts({ id: "b", locationCode: "  " }).number === null && branchFacts({ id: "b", locationCode: "T001", name: " Haifa " }).number === "T001" && branchFacts({ id: "b", name: " Haifa " }).name === "Haifa");
assert("F10 only the owner may rename, and only a branch that has its number (the route needs it back unchanged)", canRenameBranch(true, { number: "T001" }) && !canRenameBranch(false, { number: "T001" }) && !canRenameBranch(true, { number: null }) && !canRenameBranch(true, null));

// ── wiring
const flow = rd("components/vm/vm-flow.tsx");
const css = rd("app/mobile-app.css");
assert("F11 only transform and opacity are written while scrolling (no layout property, no filter), one layout read per frame, nothing kept at rest", /inner\.style\.transform = rest \? ""/.test(flow) && /inner\.style\.opacity = /.test(flow) && !/style\.(top|left|right|bottom|height|width|margin|filter)\b/.test(flow) && /requestAnimationFrame/.test(flow) && /addEventListener\("scroll", schedule, \{ passive: true \}\)/.test(flow));
assert("F12 the background is fixed (it does not move), the parts snap screen by screen (mandatory), and the whole effect is switched off for people who asked for reduced motion", /\.vm-flow-bg \{ position: fixed;[^}]*z-index: -1/.test(css) && /scroll-snap-type: y mandatory/.test(css) && /@media \(prefers-reduced-motion: reduce\)[\s\S]*scroll-snap-type: none/.test(css) && /prefers-reduced-motion: reduce/.test(flow));
assert("F13 the effect never blurs: no filter / backdrop-filter in the flow's CSS (the top bar of a flow page is a plain gradient)", !/\.vm-flow[^{]*\{[^}]*(filter|backdrop-filter):\s*blur/.test(css) && /\.vm-page\[data-flow\] \.vm-bar\[data-on\] \{[^}]*backdrop-filter: none/.test(css));
const branch = rd("app/(app)/mobile/branch/[id]/page.tsx"), person = rd("app/(app)/mobile/people/[userId]/page.tsx");
assert("F14 the branch screen is a flow of whole screens (now playing · up next when something is queued · what plays + schedule · people + the branch), every element is a Rise, and it draws no framed group", /<VmFlow tone=\{tone\}( snap)?>/.test(branch) && (branch.match(/<VmFlowSection/g) ?? []).length >= 3 && (branch.match(/<Rise/g) ?? []).length >= 10 && !/vm-group/.test(branch));
assert("F15 what is not needed every time sits behind an arrow that is CLOSED until pressed: the branch's details, and a person's e-mail / level / sign-in / joined", /useState\(false\)/.test(flow) && /<VmFold label=\{tr\("Details"\)/.test(branch) && /<VmFold label=\{tr\("Details"\)\}>/.test(person) && /<VmKv label=\{tr\("E-mail"\)/.test(person) && !/person\.email\}<\/(div|span)>/.test(person.split("<VmFold")[0]!));
assert("F16 the branch can be renamed only by the owner, through the Control Room's own route, with the branch number sent back unchanged", /canRenameBranch\(isOwner, facts\)/.test(branch) && /\/api\/control-room\/branches\/\$\{encodeURIComponent\(id\)\}/.test(rd("lib/use-branch-details.ts")) && /branchNumber: number/.test(rd("lib/use-branch-details.ts")) && /method: "PATCH"/.test(rd("lib/use-branch-details.ts")));
assert("F17 the faces: the phone's system face (SF / Roboto), and in Hebrew Heebo first (the even Hebrew face the player already uses)", /\.vm \{ font-family: -apple-system[^}]*system-ui/.test(css) && /\[dir="rtl"\] \.vm \{ font-family: var\(--font-heebo\)/.test(css));
assert("F18 the person's page is a flow too, in a darker shade of the person's own colour, and keeps every rule of the people screens (account actions only as the server allows)", /toneVars\(\{ h: nameHue\(name\), s: 0\.5 \}, true\)/.test(person) && /accountActionsFor\(person, account\)/.test(person) && /canGiveRole = ready\.rolesOn/.test(person));
assert("F19 nothing of playback, the network layer or the desktop is touched: the flow files import no player, no socket and no desktop code", !/usePlayback|device-player|useRemote|sendCommand|desktop\//.test(flow + rd("lib/use-branch-details.ts")));

// screen by screen (owner 2026-11-18: "I cannot control where to stop — it moves screens with a scroll effect")
assert("F20 the scroll moves one whole screen at a time: mandatory snapping on the branch flow only (a person's page scrolls freely), every part starts a snap and stops there even on a hard flick, every part is one screen high", /\.vm-scroll:has\(\.vm-flow\[data-snap\]\) \{ scroll-snap-type: y mandatory; \}/.test(css) && /\.vm-flow-sec \{ scroll-snap-align: start; scroll-snap-stop: always;/.test(css) && /\.vm-flow-sec\[data-tall\] \{ min-height: var\(--vm-snap-h/.test(css) && /<VmFlow tone=\{tone\} snap>/.test(branch) && !/<VmFlow tone=\{[^}]*\} snap/.test(person) && (branch.match(/<VmFlowSection tall/g) ?? []).length === (branch.match(/<VmFlowSection/g) ?? []).length && /--vm-snap-h/.test(flow));
assert("F21 the player is one whole page by itself and shows ONLY the next song (owner 2026-11-19: not a list — a row on the song screen; the 'Up next' page is gone), with the volume folded behind a press", /<VmNowPlaying \/>/.test(branch) && !/<h1 className="vm-title/.test(branch) && /export function useUpNext\(\)/.test(rd("components/vm/vm-now-playing.tsx")) && /const nextSong = upNext\[0\] \?\? null;/.test(rd("components/vm/vm-now-playing.tsx")) && /className="vm-np-next"/.test(rd("components/vm/vm-now-playing.tsx")) && /className="vm-volfold"/.test(rd("components/vm/vm-now-playing.tsx")) && !/upNext\.length > 0/.test(branch) && /\.vm-flow \.vm-np-art \{ width: min\(100%, 320px, max\(140px, calc\(var\(--vm-snap-h\) - 560px\)\)\)/.test(css));
assert("F22 a person's disc has no colour of its own on a coloured page (a soft light disc with the initials)", /const tileBg = neutral \? "rgba\(255, 255, 255, 0\.14\)" : /.test(rd("components/vm/vm-parts.tsx")) && /<VmCover name=\{name\} size=\{96\} radius=\{999\} neutral \/>/.test(person) && /size=\{40\} radius=\{999\} neutral \/>/.test(branch));

// ── the pages: nothing of a neighbouring page shows, the dots, the day board
assert("F23 a page owns the whole height: the mini-player is hidden on a screen-by-screen page (the tab bar alone is below) so nothing of the next page shows through, and the top bar is drawn from the page's own colours", /\.vm:has\(\.vm-flow\[data-snap\]\) \{ --vm-dock-h: calc\(var\(--vm-tab-h\) \+ var\(--vm-safe-b\)\); \}/.test(css) && /\.vm:has\(\.vm-flow\[data-snap\]\) \.vm-mini \{ display: none; \}/.test(css) && /style=\{tone\}/.test(rd("components/vm/vm-ui.tsx")) && /tone=\{tone\}/.test(branch) && /tone=\{personTone\}/.test(person));
const atRest = (top: number, bottom: number) => riseState({ top, bottom }, { top: 40, bottom: 844 });
assert("F24 an element where its page puts it is fully drawn — a heading at the top of a page, a row at the bottom — and only one really on its way in or out is not", JSON.stringify(atRest(103, 148)) === JSON.stringify({ y: 0, s: 1, o: 1 }) && JSON.stringify(atRest(690, 750)) === JSON.stringify({ y: 0, s: 1, o: 1 }) && atRest(859, 900).o === 0 && atRest(-60, 30).o < 0.1);
assert("F25 the page dots: one per page at the edge, the current one long and white, a press on one scrolls to that page", /className="vm-pgdots"/.test(flow) && /data-on=\{i === pages\.active/.test(flow) && /scrollTo\(\{ top: sc\.scrollTop \+ sec\.getBoundingClientRect\(\)\.top/.test(flow) && /\.vm-pgdot\[data-on\] \{ height: 20px/.test(css));
// the day board
const sc = (start: number, end: number): Scene => ({ schedule: { id: "s" } as Scene["schedule"], day: 1, start, end, endSet: true, quiet: false, paused: false, shadowed: false });
assert("F26 the day board: a block is drawn where it starts and as long as it lasts (0.9 px a minute, so an hour is 54 px); a very short block keeps a height it can be read and pressed in", PX_PER_MIN === 0.9 && boardLayout([sc(540, 600)])[0]!.top === 540 * 0.9 && Math.round(boardLayout([sc(540, 600)])[0]!.height) === 50 && boardLayout([sc(540, 545)])[0]!.height === 26);
const nov18 = parseDateKey("2026-11-18")!;
assert("F27 the date: a key is the local day (2026-11-18); a bad one is refused; the day after / before crosses the month and the year; a press on the date opens the phone's own date picker over it", dateKey(nov18) === "2026-11-18" && parseDateKey("2026-02-30") === null && parseDateKey("nope") === null && dateKey(shiftDay(nov18, 13)) === "2026-12-01" && dateKey(shiftDay(parseDateKey("2026-01-01")!, -1)) === "2025-12-31" && /<input\s+type="date"/.test(rd("components/vm/vm-day-board.tsx")) && /\.vm-day-date input \{ position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0;/.test(css));
assert("F28 the schedule page has the branch's own switch ('Play by schedule') and the board of the OPEN branch; the board is the Schedules Studio's own scenes and its ONLY write is one block's 'plays on this day' switch (PATCH skipDates, 2026-11-18) — it never creates, moves or deletes a block", /<VmDayBoard branchId=/.test(branch) && /title=\{tr\("Play by schedule"\)\}/.test(branch) && /buildDayScenes\(/.test(rd("components/vm/vm-day-board.tsx")) && !/method:\s*"(POST|PUT|DELETE)"/.test(rd("components/vm/vm-day-board.tsx")) && (rd("components/vm/vm-day-board.tsx").match(/method:\s*"PATCH"/g) ?? []).length === 1 && /skipDates: withSkipDate\(/.test(rd("components/vm/vm-day-board.tsx")));

// ── 2026-11-19: the song's colour at once, an instant open, the next song only, the volume folded, the actions as squares ──
const tone = rd("components/vm/vm-tone.ts");
const toneLib = rd("lib/cover-tone.ts");
assert("F29 the song's colour is REMEMBERED (per picture + the last playing song) and put on the first frame; while a picture is still being read nothing is made from a NAME (no 'branch colour' first)", /const TONE_KEY = "vono-mobile-tone-v1:"/.test(toneLib) && /export function rememberedTone\(/.test(toneLib) && /export function lastTone\(/.test(toneLib) && /mode === "wait" && nowPlaying \? lastTone\(\) : null/.test(tone) && /decideTone\(st, pic, mode\)/.test(tone) && /const waiting = !f\.loaded \|\| !b \|\| b\.status === "unknown" \|\| \(b\.online && !s\)/.test(tone));
const fleet = rd("lib/mobile-fleet.tsx");
assert("F30 an instant open: the branch list and the last state of each branch are remembered on the phone and drawn at once as a picture (drawn as paused, never a command source: canControl still needs a live branch)", /const DB_CACHE_KEY = "vono-mobile-db-v1"/.test(fleet) && /const STATE_CACHE_KEY = "vono-mobile-state-v1:"/.test(fleet) && /status: rs\.status === "playing" \? "paused" : rs\.status, positionAt: undefined/.test(fleet) && /canControl: !!selected\?\.online && owner\.status === "connected"/.test(fleet));
const np = rd("components/vm/vm-now-playing.tsx");
assert("F31 while the phone is still connecting the song screen shows the remembered song, not 'This branch is offline'; and nothing says 'No branch selected' before the list is read", /\{!b\.online && b\.status !== "unknown" && f\.known \? \(/.test(np) && /if \(!f\.loaded \|\| !f\.known\) return <div className="vm-np" aria-busy \/>;/.test(np));
assert("F32 the actions are SQUARES on the second screen (library, identify, jingles, schedule, people, the branch) and there is no separate 'Up next' page", /className="vm-tile"/.test(branch) && /className="vm-tiles"/.test(branch) && /\.vm-tiles \{ display: grid; grid-template-columns: 1fr 1fr;/.test(css) && !/label=\{tr\("Up next"\)\}/.test(branch));
assert("F33 opening the app puts the colours on at once (no glide from the neutral dark); the glide stays for a song changing", /data-boot=\{booting \? "" : undefined\}/.test(rd("components/vm/vm-ui.tsx")) && /\.vm\[data-boot\] :is\(\.vm-flow, \.vm-np\[data-tone\], \.vm-mini\[data-tone\], \.vm-sheet--np\) \{ transition: none !important; \}/.test(css));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
