/**
 * A quiet block's stop must really silence the music (owner 2026-11-17: the father's player did not go quiet at a quiet time that used to work).
 * Behavioural test of the pure helper (lib/schedule-quiet-stop.ts) + static wiring checks of the engine.
 * Run: npx tsx scripts/verify-quiet-stop-retry.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { QUIET_STOP_MAX_TRIES, clearQuietStopTries, noteQuietStopTry, quietStopFinished, waitForQuiet } from "../lib/schedule-quiet-stop";

const root = path.join(__dirname, "..");
const rd = (p: string) => readFileSync(path.join(root, p), "utf-8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
function assert(name: string, cond: boolean): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (cond) pass++; else fail++;
}

async function main() {
  const instant = () => Promise.resolve();
  // Q1 the music goes quiet at once
  assert("Q1 already quiet → confirmed at once", (await waitForQuiet(() => false, { sleep: instant })) === true);
  // Q2 goes quiet after a moment (the command took a second)
  let n = 0;
  assert("Q2 quiet after a few looks → confirmed", (await waitForQuiet(() => ++n < 5, { sleep: instant })) === true);
  // Q3 never goes quiet (the STOP command was lost)
  let looks = 0;
  const lost = await waitForQuiet(() => { looks++; return true; }, { sleep: instant, withinMs: 4000, everyMs: 250 });
  assert("Q3 still playing after the whole wait → NOT confirmed (the quiet block is not marked done)", lost === false && looks === 17);
  // Q4 the engine stops waiting when the window goes away
  let c = 0;
  assert("Q4 a closed window stops the wait", (await waitForQuiet(() => true, { sleep: instant, cancelled: () => ++c > 2 })) === false);
  // Q5 no signal (the status cannot be read) → the old behaviour (counts as quiet)
  assert("Q5 a status that cannot be read counts as quiet (nothing new can loop)", (await waitForQuiet(() => { throw new Error("no status"); }, { sleep: instant })) === true);

  // Q6 tries: repeated at most QUIET_STOP_MAX_TRIES times, a quiet music finishes at once
  clearQuietStopTries("k");
  const t1 = noteQuietStopTry("k"), t2 = noteQuietStopTry("k"), t3 = noteQuietStopTry("k");
  assert("Q6 a lost stop is repeated, and given up after the third try (it never fights a person who starts music in a quiet time)", QUIET_STOP_MAX_TRIES === 3 && !quietStopFinished(false, t1) && !quietStopFinished(false, t2) && quietStopFinished(false, t3));
  assert("Q7 a stop that worked is finished on the first try", quietStopFinished(true, 1));
  clearQuietStopTries("k");
  assert("Q8 the count starts again after a clear", noteQuietStopTry("k") === 1);
  clearQuietStopTries("k");

  // wiring
  const eng = rd("components/schedule-auto-player.tsx");
  assert("Q9 the engine marks a quiet block done only after the stop is finished (confirmed quiet or tried enough) — not the moment the command is handed over", /waitForQuiet\(/.test(eng) && /quietStopFinished\(quiet, tryNo\)/.test(eng) && /if \(!finished\) return;[\s\S]{0,200}localStorage\.setItem\(k, "1"\)/.test(eng));
  assert("Q10 the stop is still the Stop button's own path (stopScheduled), unchanged", /\(h\.stopScheduled \?\? h\.stop\)\(\);/.test(eng));
  assert("Q11 a line is written to the console for every quiet stop (evidence for the next time)", /\[VONO schedule\] quiet block/.test(eng));
  const hook = rd("lib/use-schedule-playback-handlers.ts");
  assert("Q12 'is music playing' is read at call time from a ref (the handlers keep their identity while the status changes — the 2026-10-15 flood fix stays)", /audibleRef\.current = providerStatus === "playing" \|\| masterStatus === "playing"/.test(hook) && /const isAudible = useCallback\(\(\) => audibleRef\.current, \[\]\)/.test(hook));
  const dec = rd("lib/schedule-actions.ts");
  assert("Q13 the decision (pure) is unchanged: a quiet block that has not fired stops, one that has does not (unless reasserted)", /hasFired\(startKey\) && !input\.reassertSilence \? null : \{ kind: "stop"/.test(dec));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main();
