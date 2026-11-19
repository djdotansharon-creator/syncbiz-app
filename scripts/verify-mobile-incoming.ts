/**
 * THE INCOMING SONG, SHOWN AT ONCE + THE PHONE'S OWN CONNECTION SAID PLAINLY (owner 2026-11-19):
 *  - "the background on the phone does not change within a second" → a real station needs seconds to start a stream and the phone kept the OLD song (picture, title, colours)
 *    until then. The phone now draws the song that was pressed at once, with "Loading…" and a stopped clock — a picture of where we are going, never a claim that it plays.
 *  - "if there is a problem with the connection it is not written as it should be" → the phone's OWN line to VONO is said on every screen (and a tap says "not sent"),
 *    never as "the branch is offline".
 * Behavioural tests of the pure rules + static guards of the wiring (and of what must NOT change: the shared display rule, the intent gate).
 * Run: npx tsx scripts/verify-mobile-incoming.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { followingOf, incomingFromStation, pickIncoming, withIncoming } from "../lib/mobile-incoming";
import { beginTransition, failTransition } from "../lib/url-transition-intent";
import type { StationPlaybackState } from "../lib/remote-control/types";

const root = path.join(__dirname, "..");
const rd = (p: string) => readFileSync(path.join(root, p), "utf-8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
function assert(name: string, cond: boolean): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}

const state = (o: Partial<StationPlaybackState>): StationPlaybackState => ({
  status: "playing", currentTrack: null, currentSource: null, currentTrackIndex: 0, queue: [], queueIndex: 0, ...o,
} as StationPlaybackState);
const OLD = state({ currentTrack: { title: "Old song", cover: "old.jpg" }, currentSource: { id: "src-old", title: "Old song", cover: "old.jpg" }, position: 71, positionAt: 1, duration: 200, volume: 55, sessionTitle: "Old list",
  sessionTracks: [{ id: "a", title: "A", cover: "a.jpg" }, { id: "b", title: "B", cover: "b.jpg" }, { id: "c", title: "C", cover: "c.jpg" }] as never, currentTrackIndex: 1, nextSessionTrack: { title: "C", cover: "c.jpg" } });
const NEW_LIVE = state({ currentTrack: { title: "New song", cover: "new.jpg" }, currentSource: { id: "src-new", title: "New song", cover: "new.jpg" }, currentTrackIndex: 0 });
const T = (key: string | null, now = 1000) => beginTransition({ origin: key ? "select" : "next", targetKey: key, now, priorAttemptId: 1, audibleAtStart: true });

// ── pickIncoming ──
assert("I1 nothing pending → nothing incoming (the live / held state is drawn as always)", pickIncoming({ transition: null, tapped: { title: "x", cover: null, at: 1000 }, live: NEW_LIVE, held: OLD }) === null);
{
  const t = { ...T("src-new#0"), phase: "confirmed" as const };
  assert("I2 once the station has confirmed (or the transition ended) the incoming song goes — the live state IS the song", pickIncoming({ transition: t, tapped: { title: "x", cover: null, at: 1000 }, live: NEW_LIVE, held: OLD }) === null);
}
{
  const t = T("src-new#0");
  const r = pickIncoming({ transition: t, tapped: { title: "Pressed", cover: "p.jpg", at: t.startedAt }, live: OLD, held: OLD });
  assert("I3 the song that was pressed is drawn at once — before the station has said anything", r?.title === "Pressed" && r.cover === "p.jpg");
  const stale = pickIncoming({ transition: t, tapped: { title: "Pressed earlier", cover: "e.jpg", at: t.startedAt - 5 }, live: OLD, held: OLD });
  assert("I4 an item pressed for an EARLIER transition is never drawn for this one", stale === null);
  const st = pickIncoming({ transition: t, tapped: { title: "Pressed", cover: "p.jpg", at: t.startedAt }, live: NEW_LIVE, held: OLD });
  assert("I5 when the station has published the asked item (metadata first) ITS title / picture are used — the truest (a playlist press shows its first song, not the list's name)", st?.title === "New song" && st.cover === "new.jpg");
  const other = pickIncoming({ transition: t, tapped: { title: "Pressed", cover: "p.jpg", at: t.startedAt }, live: state({ ...NEW_LIVE, currentSource: { id: "src-other", title: "Other", cover: null } }), held: OLD });
  assert("I6 an item the station loads that is NOT the asked one does not replace the pressed one", other?.title === "Pressed");
}
{
  const t = T(null);
  const viaStation = pickIncoming({ transition: t, tapped: null, live: NEW_LIVE, held: OLD });
  assert("I7 Next / Previous ask for no item in particular: the station's own selection is drawn as soon as it is published", viaStation?.title === "New song");
  const guess = pickIncoming({ transition: t, tapped: { title: "C", cover: "c.jpg", at: t.startedAt }, live: OLD, held: OLD });
  assert("I8 …and before that, the song the session's list says comes next", guess?.title === "C");
  assert("I9 …and nothing is made up when the list does not say", pickIncoming({ transition: t, tapped: null, live: OLD, held: OLD }) === null);
  assert("I10 a failed transition draws nothing incoming — the old song comes back by itself (with the failure line)", pickIncoming({ transition: failTransition(t, 2000), tapped: { title: "C", cover: null, at: t.startedAt }, live: OLD, held: OLD }) === null);
}
assert("I11 nothing is held (nothing was audible) → the station's state is already the new song: no override", incomingFromStation(NEW_LIVE, null) === null);

// ── withIncoming ──
{
  const w = withIncoming(OLD, { title: "New song", cover: "new.jpg" });
  assert("I12 title + picture are the incoming song's; the old session's name, list and 'next' are gone", w.currentTrack?.title === "New song" && w.currentTrack.cover === "new.jpg" && w.currentSource?.title === "New song" && !w.sessionTitle && (w.sessionTracks ?? []).length === 0 && !w.nextSessionTrack && (w.playNextQueue ?? []).length === 0);
  assert("I13 the clock is STOPPED at 0 (the old song's progress is not the new song's) — '–:––' until the station really plays it", w.position === 0 && w.positionAt === undefined && w.duration === 0);
  assert("I14 everything that is live stays (volume, modes) — only the song is replaced", w.volume === 55 && w.status === "playing");
  assert("I15 with no state at all a drawable one is made (the first press on a branch that has said nothing yet)", withIncoming(null, { title: "X", cover: null }).currentTrack?.title === "X");
  assert("I16 the base state is never mutated", OLD.currentTrack?.title === "Old song" && OLD.position === 71);
}

// ── followingOf ──
assert("I17 Next goes to the staged 'Play next' song first, then the next row of the session", followingOf(state({ ...OLD, playNextQueue: [{ id: "q", title: "Q", cover: null }] }), 1)?.title === "Q" && followingOf(OLD, 1)?.title === "C");
assert("I18 Previous goes to the row before (never the 'Play next' queue)", followingOf(state({ ...OLD, playNextQueue: [{ id: "q", title: "Q", cover: null }] }), -1)?.title === "A");
assert("I19 at the ends of the list nothing is guessed", followingOf(state({ ...OLD, currentTrackIndex: 0 }), -1) === null && followingOf(state({ ...OLD, currentTrackIndex: 2 }), 1) === null);

// ── wiring + what must NOT change ──
const fleet = rd("lib/mobile-fleet.tsx");
const inc = rd("lib/mobile-incoming.ts");
const shared = rd("lib/url-transition-intent.ts");
assert("I20 the display shows the incoming song (phone only): `display.shown` is `withIncoming(base, incoming)` while a transition is pending", /pickIncoming\(\{ transition, tapped, live: liveState, held: holdsAudible\(transition\) \? heldState : null \}\)/.test(fleet) && /shown: incoming \? withIncoming\(base, incoming\) : base/.test(fleet));
assert("I21 a press remembers what was pressed WITH its transition (a single song only — a playlist's first song is not its name or picture) and the colour is read at once", /const oneSong = source\.origin !== "playlist" \|\| \(source\.playlist \? getPlaylistTracks\(source\.playlist\)\.length === 1 : false\);/.test(fleet) && /setTapped\(oneSong && source\.title \? \{ title: source\.title, cover: pic, at: t\.startedAt \} : null\);/.test(fleet) && /warmTone\(pic\);/.test(fleet));
assert("I22 Next / Previous remember where they go from the session's own list", /const go = followingOf\(liveStateRef\.current, origin === "next" \? 1 : -1\);/.test(fleet) && /setTapped\(go \? \{ \.\.\.go, at: t\.startedAt \} : null\);/.test(fleet));
assert("I23 the SHARED display rule and the intent gate are untouched: the pure module is not imported by them, `displayPlaybackState` still holds the audible item, one navigation intent at a time", !/mobile-incoming/.test(shared) && /export function displayPlaybackState/.test(shared) && /if \(isBlocking\(transitionRef\.current\)\) return; \/\/ one navigation intent/.test(fleet));
assert("I24 the incoming song is only ever DRAWN: the module sends nothing and reads no socket", !/sendCommand|send\(|WebSocket|ownerRef/.test(inc));
assert("I25 the old song is not shown with a running clock under the new title: the clock fields are cleared", /positionAt: undefined/.test(inc) && /duration: 0/.test(inc));

const ui = rd("components/vm/vm-ui.tsx");
const np = rd("components/vm/vm-now-playing.tsx");
assert("I26 Next / Previous LOOK like they wait while a song is starting (they ignore a press then — one change at a time — and used to do it silently)", /data-busy=\{f\.display\.loading \? "" : undefined\}/.test(np) && /data-busy=\{f\.display\.loading \? "" : undefined\}/.test(ui) && /\.vm-tbtn\[data-busy\]/.test(rd("app/mobile-app.css")));

// ── the connection ──
assert("I27 the phone's own connection is said on EVERY screen, from ONE place: the shell", /<ConnectionBanner \/>/.test(ui) && /function ConnectionBanner\(\)/.test(ui));
assert("I28 it is one continuous stretch without a line (3 s) — the socket flipping between 'connecting' and 'failed' while it retries does not start the wait over", /useAfter\(f\.connection !== "connected", 3000\)/.test(ui));
assert("I29 a line that was up and is gone says 'Can't reach VONO. Trying again…'; a line that has not come up yet since opening says 'Connecting to your branches…'", /wasUp \? tr\("Can't reach VONO\. Trying again…"\) : tr\("Connecting to your branches…"\)/.test(ui));
const send = rd("components/vm/vm-source-row.tsx");
assert("I30 a press with no line says 'Not sent — no connection to VONO' — NOT '<branch> is offline' (the branch is not the one that is away)", /cur\.connection !== "connected" \? tr\("Not sent — no connection to VONO"\) : tr\("\{name\} is offline"/.test(send));
assert("I31 a branch's own 'offline' screen no longer promises that it 'keeps playing by itself' (not proven for every cause of being away)", !/keeps playing by itself/.test(np) && /Its player is not connected right now\. It will show here as soon as it is back\./.test(np));
const phrases = rd("lib/i18n/phrases.ts");
assert("I32 every new line is translated", /"Not sent — no connection to VONO": "/.test(phrases) && /"Its player is not connected right now\. It will show here as soon as it is back\.": "/.test(phrases));

console.log(`\n${pass} passed, ${fail} failed`);
