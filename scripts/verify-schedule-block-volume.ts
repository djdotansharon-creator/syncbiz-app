/**
 * A schedule block's own VOLUME (owner 2026-11-17: "when I stand on a song I can decide how loud the player is at that time; if it is set and I come to raise it, a window asks whether to break the setting").
 * Behavioural tests of the pure rules (lib/schedule-volume.ts) + static checks of the wiring (migration, API, copy paths, engine, guard window, main player).
 * Run: npx tsx scripts/verify-schedule-block-volume.ts
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  __resetScheduleVolumeForTests, answerVolumeQuestion, applyBlockVolume, decideVolumeOnStart, guardVolume, needsVolumeConfirm, normalizeScheduleVolume, setScheduleVolumeLock,
} from "../lib/schedule-volume";

const root = path.join(__dirname, "..");
const rd = (p: string) => readFileSync(path.join(root, p), "utf-8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
function assert(name: string, cond: boolean): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (cond) pass++; else fail++;
}

// ── what a request carries
assert("V1 a volume is a whole number 0–100: 40 → 40, '40' → 40, 40.6 → 41, null / '' → null (clear it), nothing → undefined (not mentioned)", normalizeScheduleVolume(40) === 40 && normalizeScheduleVolume("40") === 40 && normalizeScheduleVolume(40.6) === 41 && normalizeScheduleVolume(null) === null && normalizeScheduleVolume("") === null && normalizeScheduleVolume(undefined) === undefined);
assert("V2 anything else is refused: -1, 101, NaN, 'loud'", normalizeScheduleVolume(-1) === "invalid" && normalizeScheduleVolume(101) === "invalid" && normalizeScheduleVolume(NaN) === "invalid" && normalizeScheduleVolume("loud") === "invalid" && normalizeScheduleVolume({}) === "invalid");

// ── when a block starts
assert("V3 a block with a volume sets it and remembers the volume the player had (only the first time)", JSON.stringify(decideVolumeOnStart({ blockVolume: 30, currentVolume: 80, base: null })) === JSON.stringify({ set: 30, saveBase: 80, clearBase: false }) && JSON.stringify(decideVolumeOnStart({ blockVolume: 50, currentVolume: 30, base: 80 })) === JSON.stringify({ set: 50, saveBase: null, clearBase: false }));
assert("V4 the next block without a volume brings the remembered volume back, once", JSON.stringify(decideVolumeOnStart({ blockVolume: null, currentVolume: 30, base: 80 })) === JSON.stringify({ set: 80, saveBase: null, clearBase: true }));
assert("V5 a block without a volume and nothing remembered touches nothing", JSON.stringify(decideVolumeOnStart({ blockVolume: null, currentVolume: 70, base: null })) === JSON.stringify({ set: null, saveBase: null, clearBase: false }));

// the engine's call (storage-less: base is read from localStorage, which does not exist here → null, and writing it is a no-op)
const sets: number[] = [];
assert("V6 the engine's call sets the block's volume through the Player's own path", applyBlockVolume({ getVolume: () => 80, setVolume: (v) => sets.push(v) }, 35) === 35 && sets.join() === "35");
assert("V7 no way to set the volume → nothing happens, nothing throws", applyBlockVolume({}, 35) === null && applyBlockVolume({ setVolume: () => { throw new Error("x"); } }, 35) === null);

// ── a raise above the setting asks first
const lock = { blockId: "b1", name: "Morning", volume: 40 };
assert("V8 raising above the block's volume needs a question; lowering, equal and a block without a volume do not", needsVolumeConfirm(60, lock, null) && !needsVolumeConfirm(40, lock, null) && !needsVolumeConfirm(20, lock, null) && !needsVolumeConfirm(90, null, null));
assert("V9 once the person said 'Raise anyway' this block stops asking", !needsVolumeConfirm(90, lock, "b1") && needsVolumeConfirm(90, lock, "b2"));

__resetScheduleVolumeForTests();
const applied: number[] = [];
assert("V10 no block in force → the change goes straight through", guardVolume(70, (v) => applied.push(v)) === true && applied.join() === "70");
setScheduleVolumeLock(lock);
assert("V11 a raise above the block's volume is NOT applied, it waits for the answer", guardVolume(70, (v) => applied.push(v)) === false && applied.join() === "70");
answerVolumeQuestion(false);
assert("V12 'Keep' leaves the volume alone", applied.join() === "70");
assert("V13 a lower value goes straight through while the block is in force", guardVolume(20, (v) => applied.push(v)) === true && applied.join() === "70,20");
guardVolume(80, (v) => applied.push(v));
answerVolumeQuestion(true);
assert("V14 'Raise anyway' applies the change", applied.join() === "70,20,80");
assert("V15 …and the block does not ask again", guardVolume(95, (v) => applied.push(v)) === true && applied.join() === "70,20,80,95");
setScheduleVolumeLock({ blockId: "b2", name: "Lunch", volume: 30 });
assert("V16 the next block asks again", guardVolume(60, (v) => applied.push(v)) === false);
setScheduleVolumeLock(null);
assert("V17 when the block's time is over the question is void (and the change does not slip through by itself)", applied.join() === "70,20,80,95");
answerVolumeQuestion(true);
assert("V18 an answer to a void question does nothing", applied.join() === "70,20,80,95");

// ── wiring
const mig = readdirSync(path.join(root, "prisma/migrations")).find((d) => d.endsWith("_schedule_volume"));
const sql = mig ? rd(`prisma/migrations/${mig}/migration.sql`) : "";
assert("V19 DATABASE additive only: one nullable column on Schedule, nothing dropped or rewritten", !!mig && /ALTER TABLE "Schedule" ADD COLUMN "volume" INTEGER;/.test(sql) && !/DROP|DELETE|UPDATE|TRUNCATE|NOT NULL/i.test(sql.replace(/--.*$/gm, "")) && /volume\s+Int\?/.test(rd("prisma/schema.prisma")));
const post = rd("app/api/schedules/route.ts"), patch = rd("app/api/schedules/[id]/route.ts");
assert("V20 the API reads the volume through one function, refuses a bad one (400), and PATCH can clear it (null)", /normalizeScheduleVolume\(/.test(post) && /normalizeScheduleVolume\(/.test(patch) && /volume must be a whole number from 0 to 100/.test(post) && /volume must be a whole number from 0 to 100/.test(patch) && /if \(volume !== undefined\) updates\.volume = volume/.test(patch));
const store = rd("lib/store.ts");
assert("V21 the store reads and writes it (create / update / row → Schedule)", /volume: row\.volume \?\? undefined/.test(store) && /volume: input\.volume \?\? null/.test(store) && /data\.volume !== undefined && \{ volume: data\.volume \?\? null \}/.test(store));
const tl = rd("lib/schedules-timeline.ts"), studio = rd("components/schedules-studio/schedules-studio.tsx");
assert("V22 a copy keeps the volume: paste and 'this day only'", /typeof src\.volume === "number" \? \{ volume: src\.volume \}/.test(tl) && /typeof src\.volume === "number" \? \{ volume: src\.volume \}/.test(studio));
assert("V23 the block's card has the Volume field (not for a quiet block) and the block shows it", /<BlockVolume value=/.test(studio) && /tr\("Volume \{n\}%", \{ n: sc\.schedule\.volume \}\)/.test(studio));
const eng = rd("components/schedule-auto-player.tsx");
assert("V24 the engine sets the volume BEFORE the music starts, tells the guard which block is in force, clears it when the schedule is off, and puts it back after a restart inside the block", /applyBlockVolume\(handlersRef\.current, typeof winner\.volume === "number"/.test(eng) && /setScheduleVolumeLock\(inForce && blockVolume !== null/.test(eng) && /setScheduleVolumeLock\(null\)/.test(eng) && /if \(firstLook && blockVolume !== null/.test(eng) && eng.indexOf("applyBlockVolume(handlersRef.current, typeof winner.volume") < eng.indexOf("await runSchedulePlayback("));
assert("V25 the quiet decision itself is untouched (a quiet block still ends the schedule's music and never sets a volume)", /isSilenceBlock\(current\)/.test(rd("lib/schedule-actions.ts")) && !/volume/.test(rd("lib/schedule-actions.ts")));
const ap = rd("components/audio-player.tsx"), pb = rd("components/playback-bar.tsx");
assert("V26 the main player's volume (slider, pill, mute) and the dock go through the guard; the Player's own path is unchanged underneath", /const onVolumeChange = \(v: number\) => \{ guardVolume\(v, applyVolume\); \};/.test(ap) && /guardVolume\(v, deviceCtx!\.setVolumeOrSend\)/.test(pb) && /guardVolume\(v, setVolume\)/.test(pb));
const prov = rd("app/(app)/providers.tsx");
assert("V27 the window is mounted once with the other app-wide parts", /<ScheduleVolumeGuard \/>/.test(prov));
const win = rd("components/schedule-volume-guard.tsx"), css = rd("components/schedule-volume-guard.css");
assert("V28 the window: an alert dialog (focus on 'Keep', Escape = keep), two answers, no blur filter, light and dark", /role="alertdialog"/.test(win) && /Escape/.test(win) && /answerVolumeQuestion\(false\)/.test(win) && /answerVolumeQuestion\(true\)/.test(win) && !/backdrop-filter|filter:\s*blur/.test(css) && /data-sb-display="white"/.test(css));
const he = rd("lib/i18n/phrases.ts");
assert("V29 every new sentence has its Hebrew", ["The player's own", "Set for this block", "Volume {n}%", "This time has its own volume", "“{name}” is set to {n}%. Raise it to {v}% anyway?", "The schedule set the volume to {n}% for now. Raise it to {v}% anyway?", "Keep {n}%", "Raise to {v}%"].every((k) => he.includes(`"${k}":`)));

assert("V30 the API routes read the value from the React-free file (importing the client store made the server build fail)", /from "@\/lib\/schedule-volume-value"/.test(post) && /from "@\/lib\/schedule-volume-value"/.test(patch) && !/from "@\/lib\/schedule-volume"/.test(post) && !/from "@\/lib\/schedule-volume"/.test(patch) && !/react/i.test(rd("lib/schedule-volume-value.ts").replace(/\/\*[\s\S]*?\*\//g, "")));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
