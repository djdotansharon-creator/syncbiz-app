/**
 * THE FLOW (owner 2026-11-18, an experiment): the phone's branch screen and a person's page as parts that scroll over a FIXED background, elements that rise into place with a small
 * overshoot (scrubbed by the scroll, so scrolling back plays it backwards), frameless rows, and details behind a closed arrow. Behavioural tests of the pure parts + static guards of the wiring.
 * Run: npx tsx scripts/verify-mobile-flow.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { easeOutBack, riseState } from "../components/vm/vm-flow";
import { branchFacts, canRenameBranch } from "../lib/use-branch-details";

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
assert("F12 the background is fixed (it does not move), the parts snap gently (proximity), and the whole effect is switched off for people who asked for reduced motion", /\.vm-flow-bg \{ position: fixed;[^}]*z-index: -1/.test(css) && /scroll-snap-type: y proximity/.test(css) && /@media \(prefers-reduced-motion: reduce\)[\s\S]*scroll-snap-type: none/.test(css) && /prefers-reduced-motion: reduce/.test(flow));
assert("F13 the effect never blurs: no filter / backdrop-filter in the flow's CSS (the top bar of a flow page is a plain gradient)", !/\.vm-flow[^{]*\{[^}]*(filter|backdrop-filter):\s*blur/.test(css) && /\.vm-page\[data-flow\] \.vm-bar\[data-on\] \{[^}]*backdrop-filter: none/.test(css));
const branch = rd("app/(app)/mobile/branch/[id]/page.tsx"), person = rd("app/(app)/mobile/people/[userId]/page.tsx");
assert("F14 the branch screen is a flow in three parts (now playing · what plays + schedule · people + the branch), every element is a Rise, and it draws no framed group", /<VmFlow tone=\{tone\}>/.test(branch) && (branch.match(/<VmFlowSection/g) ?? []).length === 3 && (branch.match(/<Rise/g) ?? []).length >= 10 && !/vm-group/.test(branch));
assert("F15 what is not needed every time sits behind an arrow that is CLOSED until pressed: the branch's details, and a person's e-mail / level / sign-in / joined", /useState\(false\)/.test(flow) && /<VmFold label=\{tr\("Details"\)/.test(branch) && /<VmFold label=\{tr\("Details"\)\}>/.test(person) && /<VmKv label=\{tr\("E-mail"\)/.test(person) && !/person\.email\}<\/(div|span)>/.test(person.split("<VmFold")[0]!));
assert("F16 the branch can be renamed only by the owner, through the Control Room's own route, with the branch number sent back unchanged", /canRenameBranch\(isOwner, facts\)/.test(branch) && /\/api\/control-room\/branches\/\$\{encodeURIComponent\(id\)\}/.test(rd("lib/use-branch-details.ts")) && /branchNumber: number/.test(rd("lib/use-branch-details.ts")) && /method: "PATCH"/.test(rd("lib/use-branch-details.ts")));
assert("F17 the faces: the phone's system face (SF / Roboto), and in Hebrew Heebo first (the even Hebrew face the player already uses)", /\.vm \{ font-family: -apple-system[^}]*system-ui/.test(css) && /\[dir="rtl"\] \.vm \{ font-family: var\(--font-heebo\)/.test(css));
assert("F18 the person's page is a flow too, in a darker shade of the person's own colour, and keeps every rule of the people screens (account actions only as the server allows)", /toneVars\(\{ h: nameHue\(name\), s: 0\.5 \}, true\)/.test(person) && /accountActionsFor\(person, account\)/.test(person) && /canGiveRole = ready\.rolesOn/.test(person));
assert("F19 nothing of playback, the network layer or the desktop is touched: the flow files import no player, no socket and no desktop code", !/usePlayback|device-player|useRemote|sendCommand|desktop\//.test(flow + rd("lib/use-branch-details.ts")));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
