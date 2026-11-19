/**
 * THE SONG'S COLOUR + COMING BACK TO THE APP (owner 2026-11-19):
 *  - "at the start there is a green background and then the picture" → nothing is made up from a NAME while we do not know yet;
 *  - "I put a song — the picture was already the song's but the background did not change colour" → a new picture has its own answer; "no colour" gives the name's colour, never the previous song's;
 *  - "when I connect again there is a disconnect until it connects" → a reconnect with an old token waits for the fresh one (the first try is no longer refused as "expired"), a dead socket is replaced
 *    the moment the app is back in front, a late close of an OLD socket cannot blank a live one, and the screens keep showing what they saw for a few seconds instead of going blank.
 * Behavioural tests of the pure rules + static guards of the wiring.
 * Run: npx tsx scripts/verify-song-tone.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { decideTone, type ToneState } from "../lib/cover-tone";
import { mustWaitForFreshToken } from "../lib/remote-control/ws-client";

const root = path.join(__dirname, "..");
const rd = (p: string) => readFileSync(path.join(root, p), "utf-8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
function assert(name: string, cond: boolean): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const RED = { h: 350, s: 0.6 };
const GREEN = { h: 140, s: 0.5 };
const st = (o: Partial<ToneState>): ToneState => ({ cover: null, hs: null, held: null, settled: false, ...o });

// ── the colour decision ──
// the "green at the start": nothing known yet (no branch, no picture) and the state says "settled" — a NAME's colour must NOT be made up
{
  const d = decideTone(st({ cover: null, settled: true }), null, "wait");
  assert("T1 while we do not know yet, a settled 'no picture' is NOT turned into a name's colour (the green at the start)", d.use === "stay" && d.hs === null);
}
assert("T2 while we do not know yet, the last song's colour stays", (() => { const d = decideTone(st({ cover: null, held: RED }), null, "wait"); return d.use === "stay" && d.hs === RED; })());
assert("T3 a picture with a colour wears it", (() => { const d = decideTone(st({ cover: "a.jpg", hs: RED, settled: true }), "a.jpg", "song"); return d.use === "own" && d.hs === RED; })());
// a NEW picture: its answer is not in yet — the colour on screen stays (and then glides); the old picture's colour is "held"
assert("T4 a new picture that is still being read keeps the colour that is on screen", (() => { const d = decideTone(st({ cover: "b.jpg", hs: null, held: RED, settled: false }), "b.jpg", "song"); return d.use === "stay" && d.hs === RED; })());
assert("T5 before the effect has even run for a new picture, the previous picture's colour stays", (() => { const d = decideTone(st({ cover: "a.jpg", hs: RED, settled: true }), "b.jpg", "song"); return d.use === "stay" && d.hs === RED; })());
// the "background did not change": the picture has answered "no colour / cannot be read" while the previous song's colour is still held → the NAME's colour, never the previous song's
assert("T6 a picture that cannot be read gives the NAME's colour — never the previous song's (the background that did not change)", (() => { const d = decideTone(st({ cover: "b.jpg", hs: null, held: RED, settled: true }), "b.jpg", "song"); return d.use === "name"; })());
assert("T7 a song with no picture at all wears its name's colour once it is known to play", decideTone(st({ cover: null, settled: true }), null, "song").use === "name");
assert("T8 nothing plays (known): the calm tint", decideTone(st({ cover: "a.jpg", hs: RED, settled: true }), "a.jpg", "calm").use === "calm");
assert("T9 the picture's own colour beats a held one", (() => { const d = decideTone(st({ cover: "b.jpg", hs: GREEN, held: RED, settled: true }), "b.jpg", "song"); return d.use === "own" && d.hs === GREEN; })());
assert("T10 while we wait, a remembered colour of the picture is used at once", (() => { const d = decideTone(st({ cover: "a.jpg", hs: RED, settled: false }), "a.jpg", "wait"); return d.use === "own"; })());

// ── the token rule ──
assert("K1 a reconnect whose token is old (the app was in the background) waits for the fresh one", mustWaitForFreshToken({ attempt: 1, freshFor: 0, tokenAgeMs: 90_000 }));
assert("K2 a reconnect with a young token does not wait (the fast path stays fast)", !mustWaitForFreshToken({ attempt: 1, freshFor: 0, tokenAgeMs: 5_000 }));
assert("K3 the first connect of a page never waits", !mustWaitForFreshToken({ attempt: 0, freshFor: -1, tokenAgeMs: 999_999 }));
assert("K4 a token that arrived for THIS attempt never waits", !mustWaitForFreshToken({ attempt: 3, freshFor: 3, tokenAgeMs: 0 }));
assert("K5 no token ever received (age = since the start) counts as old", mustWaitForFreshToken({ attempt: 2, freshFor: 1, tokenAgeMs: Date.now() }));

// ── the wiring ──
const ws = rd("lib/remote-control/ws-client.ts");
const own = ws.slice(ws.indexOf("export function useRemoteOwner("));
assert("W1 the owner socket waits for a fresh token before it connects (and is let go when the token arrives)", /mustWaitForFreshToken\(\{ attempt: reconnectTrigger/.test(own) && /waitingTokenRef\.current = true;/.test(own) && /setTokenGate\(\(g\) => g \+ 1\)/.test(own) && /\[reconnectTrigger, !!wsToken, tokenGate\]/.test(own));
assert("W2 a late close of an OLDER socket is ignored while a newer one is in charge", /if \(wsRef\.current !== null && wsRef\.current !== ws\) return;/.test(own));
assert("W3 coming back to the front asks the server something small; no answer in a moment → the socket is replaced", /ws\.send\(JSON\.stringify\(\{ type: "BRANCH_LIST_REQUEST" \}/.test(own) && /lastMsgAtRef\.current < now/.test(own) && /RESUME_PROBE_MS = 1_?500/.test(ws));
assert("W4 the first retry of an outage is quick while the app is in front, the backoff stays armed as the fallback (the old statement is untouched)", /QUICK_RETRY_MS = 250/.test(ws) && /if \(!intentionalClose\) reconnectSchedulerRef\.current\?\.scheduleRetry\(\)/.test(own) && /!quickRetryUsedRef\.current && typeof document/.test(own));
assert("W5 what was last seen is kept from the FIRST drop (not from every failed try) and cleared when connected", /setHeld\(\(prev\) => prev \?\? \{ branches: lastBranchesRef\.current/.test(own) && /setHeld\(null\);/.test(own) && /held,\n/.test(own));
const fleet = rd("lib/mobile-fleet.tsx");
assert("W6 the phone keeps drawing the last-seen branches for a few seconds after a drop — a picture only: commands still need a LIVE connection", /const HOLD_MS = 10_000;/.test(fleet) && /const liveKnown = owner\.status === "connected" \|\| holding;/.test(fleet) && /canControl: !!selected\?\.online && owner\.status === "connected"/.test(fleet));
const home = rd("app/(app)/mobile/home/page.tsx");
assert("W7 the 'connecting' notice appears only when the connection STAYS down (a blink shows nothing)", /useAfter\(\(f\.connection === "error" \|\| f\.connection === "disconnected"\) && !f\.holding, 2500\)/.test(home) && /\{showNotice \? \(/.test(home));
const toneLib = rd("lib/cover-tone.ts");
const tone = rd("components/vm/vm-tone.ts");
assert("W8 a picture that could not be read is not remembered as 'no colour' for the whole session (a later try may work)", /if \(!v\) cache\.delete\(url\);/.test(toneLib));
assert("W9 the song's colour is read AHEAD: when a song is chosen (before the station answers) and for the next song", /warmTone\(source\.cover\);/.test(fleet) && /warmTone\(nextCover\)/.test(rd("components/vm/vm-now-playing.tsx")));
assert("W10 the tone hook never makes a colour from a name while waiting: `useNowTone` says 'wait' while the list is unread / the phone connects / the state has not arrived — and a branch is not 'away' until the connection says so", /const waiting = !f\.loaded \|\| !b \|\| b\.status === "unknown" \|\| \(b\.online && !s\) \|\| \(!b\.online && f\.connection !== "connected" && !f\.holding\);/.test(tone) && /const mode: ToneMode = waiting \? "wait" : quiet \? \(calm \? "calm" : "wait"\) : "song";/.test(tone) && /const CALM_AFTER_MS = 700;/.test(tone) && /useHeldFor\(!waiting && quiet, CALM_AFTER_MS\)/.test(tone));
assert("W11 while the phone connects the song screen does not say 'Nothing playing' (it would turn into the song a moment later)", /b\.status === "unknown" \|\| \(b\.online && !shown\) \? \(/.test(rd("components/vm/vm-now-playing.tsx")));

console.log(`\n${pass} passed, ${fail} failed`);
