/**
 * 2026-11-09 (CDP measurement on the live Dev-PC station, owner-approved: "smooth and stable, no mistakes"): the device-player context changed
 * once a second only because the MASTER position moved to the next whole second, and that redrew ~36 consumers — the whole library (104 cards).
 * Rule (lib/master-state-gate.ts): while a song simply plays on, a message whose position agrees with the extrapolation is not applied; seek,
 * stall, pause, track / volume / queue changes and transitions are applied exactly as before, and a fresh base is taken every 5 s.
 * This simulates MAIN (4 messages a second, whole-second positions, positionAt = capture time) and checks what the SCREEN shows
 * (computeLivePosition — the one function every surface uses) against the true position, at every 50 ms.
 * Run: npx tsx scripts/verify-master-state-gate.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { gateMasterState, type MasterGateMemo, type MasterGateInput } from "../lib/master-state-gate";
import { computeLivePosition } from "../lib/remote-control/live-position";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const root = path.join(__dirname, "..");
const read = (p: string) => readFileSync(path.join(root, p), "utf-8").replace(/\r\n/g, "\n");

type Msg = MasterGateInput & { position: number; positionAt: number; status: string };
const T0 = 1_790_000_000_000;
const base = { currentSource: { id: "s1", title: "Song", cover: null }, currentTrackIndex: 0, queueIndex: 0, volume: 80, duration: 300, shuffle: false };

/**
 * Run a scenario: `truth(t)` gives MAIN's real state at t ms (position as a float, status, extra fields); MAIN sends every `every` ms.
 * Returns the applied messages and the worst display error per window.
 */
function run(totalMs: number, truth: (t: number) => { pos: number; status: string; extra?: Record<string, unknown> }, opts: { every?: number; transition?: (t: number) => boolean } = {}) {
  const every = opts.every ?? 250;
  let memo: MasterGateMemo | null = null;
  let shown: Msg | null = null;
  const applied: { t: number; msg: Msg }[] = [];
  const err: { t: number; e: number }[] = [];
  for (let t = 0; t <= totalMs; t += 50) {
    if (t % every === 0) {
      const tr = truth(t);
      const msg: Msg = { ...base, ...(tr.extra ?? {}), status: tr.status, position: Math.floor(tr.pos), positionAt: T0 + t };
      const g = gateMasterState(memo, msg, opts.transition ? opts.transition(t) : false);
      memo = g.memo;
      if (g.apply) { shown = msg; applied.push({ t, msg }); }
    }
    if (shown) {
      // what every screen shows at time t: the real computeLivePosition, with the clock set to t
      const realNow = Date.now;
      Date.now = () => T0 + t;
      const screen = computeLivePosition(shown, null);
      Date.now = realNow;
      err.push({ t, e: screen - truth(t).pos });
    }
  }
  const worst = (from: number, to = Infinity) => Math.max(0, ...err.filter((x) => x.t >= from && x.t <= to).map((x) => Math.abs(x.e)));
  return { applied, worst, err };
}

// G1 a song simply plays on for 60 s
{
  const r = run(60_000, (t) => ({ pos: 12.4 + t / 1000, status: "playing" }));
  assert("G1a steady play, 60 s at 4 messages/s (240 messages): at most 14 reach the screen (was 61 — one per second)", r.applied.length <= 14, `${r.applied.length} applied`);
  assert("G1b the screen never differs from the true position by more than 1 s", r.worst(0) <= 1.0, `worst ${r.worst(0).toFixed(3)} s`);
  assert("G1c after the first fresh base (≤ 6 s) the screen stays within 0.3 s of the truth", r.worst(6_000) <= 0.3, `worst ${r.worst(6_000).toFixed(3)} s`);
  const gaps = r.applied.slice(1).map((a, i) => a.t - r.applied[i].t);
  assert("G1d a fresh base at least every 6 s", Math.max(...gaps) <= 6_000, `max gap ${Math.max(...gaps)} ms`);
}
// G2 seek forward
{
  const r = run(30_000, (t) => ({ pos: t < 10_000 ? 5 + t / 1000 : 120 + (t - 10_000) / 1000, status: "playing" }));
  const first = r.applied.find((a) => a.t >= 10_000);
  assert("G2a SEEK forward (0:15 → 2:00): the very next message is applied", !!first && first.t === 10_000, first ? `at ${first.t} ms` : "none");
  assert("G2b after the seek the screen is within 1 s of the truth", r.worst(10_000) <= 1.0, `worst ${r.worst(10_000).toFixed(3)} s`);
}
// G3 small seek backwards (−3 s)
{
  const r = run(20_000, (t) => ({ pos: t < 8_000 ? 40 + t / 1000 : 45 + (t - 8_000) / 1000, status: "playing" }));
  const first = r.applied.find((a) => a.t >= 8_000);
  assert("G3 SEEK back by 3 s: applied at once", !!first && first.t === 8_000, first ? `at ${first.t} ms` : "none");
}
// G4 stall (MPV frozen, still "playing")
{
  const r = run(40_000, (t) => ({ pos: t < 20_000 ? 30 + t / 1000 : t < 30_000 ? 50.3 : 50.3 + (t - 30_000) / 1000, status: "playing" }));
  const firstStall = r.applied.find((a) => a.t > 20_000);
  assert("G4a STALL: the frozen position reaches the screen within 2.5 s", !!firstStall && firstStall.t - 20_000 <= 2_500, firstStall ? `after ${firstStall.t - 20_000} ms` : "none");
  const during = r.applied.filter((a) => a.t > 20_000 && a.t < 30_000).length;
  assert("G4b while frozen it is re-applied about every 1.5 s (the bar keeps showing the freeze, as before)", during >= 5, `${during} times in 10 s`);
  assert("G4c during the freeze the screen is never more than 1.75 s ahead of the frozen position", r.worst(22_500, 30_000) <= 1.75, `worst ${r.worst(22_500, 30_000).toFixed(3)} s`);
  assert("G4d after it resumes the screen is back within 1 s", r.worst(32_500) <= 1.0, `worst ${r.worst(32_500).toFixed(3)} s`);
}
// G5 a short hiccup (0.8 s) — the screen corrects itself on the next fresh base
{
  const r = run(30_000, (t) => ({ pos: t < 10_000 ? 20 + t / 1000 : t < 10_800 ? 30 : 30 + (t - 10_800) / 1000, status: "playing" }));
  assert("G5 a 0.8 s hiccup: the screen is at most 1.5 s off and back within 0.3 s by 6 s later", r.worst(10_000) <= 1.5 && r.worst(17_000) <= 0.3, `worst ${r.worst(10_000).toFixed(3)} / after ${r.worst(17_000).toFixed(3)} s`);
}
// G6 pause / resume
{
  const r = run(20_000, (t) => ({ pos: t < 5_000 ? 10 + t / 1000 : t < 12_000 ? 15 : 15 + (t - 12_000) / 1000, status: t >= 5_000 && t < 12_000 ? "paused" : "playing" }));
  const p = r.applied.find((a) => a.t >= 5_000);
  const res = r.applied.find((a) => a.t >= 12_000);
  assert("G6a PAUSE: applied at once", !!p && p.t === 5_000 && p.msg.status === "paused");
  assert("G6b RESUME: applied at once", !!res && res.t === 12_000 && res.msg.status === "playing");
  const pausedApplied = r.applied.filter((a) => a.t > 5_000 && a.t < 12_000).length;
  assert("G6c while paused the 2026-11-05 rule is unchanged (identical message re-applied every 1.5 s)", pausedApplied >= 4 && pausedApplied <= 5, `${pausedApplied} in 7 s`);
}
// G7 track change / volume / queue / duration / attempt — applied at once
{
  const fields: [string, (t: number) => Record<string, unknown>][] = [
    ["track", (t) => ({ currentSource: t >= 7_000 ? { id: "s2", title: "Next", cover: null } : base.currentSource, currentTrackIndex: t >= 7_000 ? 1 : 0 })],
    ["volume", (t) => ({ volume: t >= 7_000 ? 60 : 80 })],
    ["queue", (t) => ({ queueIndex: t >= 7_000 ? 3 : 0 })],
    ["duration", (t) => ({ duration: t >= 7_000 ? 301 : 300 })],
    ["shuffle", (t) => ({ shuffle: t >= 7_000 })],
    ["attempt", (t) => ({ mpvAttemptId: t >= 7_000 ? 9 : 8 })],
  ];
  for (const [name, extra] of fields) {
    const r = run(12_000, (t) => ({ pos: 50 + t / 1000, status: "playing", extra: extra(t) }));
    const a = r.applied.find((x) => x.t >= 7_000);
    assert(`G7 ${name} change while playing: applied at once`, !!a && a.t === 7_000);
  }
}
// G8 a song transition in progress → the previous rule (every new second applied)
{
  const r = run(10_000, (t) => ({ pos: 3 + t / 1000, status: "playing" }), { transition: () => true });
  assert("G8 during a song transition every new second is applied, exactly as before (the transition logic reads the position)", r.applied.length >= 10, `${r.applied.length} in 10 s`);
}
// G9..G12 edge cases
{
  const m: Msg = { ...base, status: "playing", position: 10, positionAt: T0 };
  assert("G9 the first message is always applied", gateMasterState(null, m, false).apply === true);
  const memo = gateMasterState(null, m, false).memo;
  const circ: Record<string, unknown> = { ...m }; circ.self = circ;
  assert("G10 an unserialisable message is always applied", gateMasterState(memo, circ as MasterGateInput, false).apply === true);
  assert("G11 MAIN's clock going backwards is applied", gateMasterState(memo, { ...m, positionAt: T0 - 5_000 }, false).apply === true);
  const noAt = gateMasterState(null, { ...m, positionAt: undefined as unknown as number }, false).memo;
  assert("G12 no capture time while playing → the previous rule (a new second is applied)", gateMasterState(noAt, { ...m, position: 11, positionAt: undefined as unknown as number }, false).apply === true);
  const dropped = gateMasterState(memo, { ...m, position: 10, positionAt: T0 + 400 }, false);
  assert("G13 a dropped message keeps the applied base (only the last-seen position moves)", dropped.apply === false && dropped.memo.at === T0 && dropped.memo.pos === 10);
}

// static: the context uses the gate, still has exactly one setMasterState, and the gate is pure (display-only)
const dpc = read("lib/device-player-context.tsx");
const gateSrc = read("lib/master-state-gate.ts");
assert("S1 onStateUpdate goes through gateMasterState with the song-transition flag, and only an applied message sets masterState",
  /const gate = gateMasterState\(lastAppliedStateRef\.current, state, urlTransitionRef\.current != null\);\s*lastAppliedStateRef\.current = gate\.memo;\s*if \(!gate\.apply\) return;\s*setMasterState\(state\);/.test(dpc)
  && (dpc.match(/setMasterState\(/g) ?? []).length === 1);
assert("S2 the gate imports nothing and sends nothing (display-only)", !/^import /m.test(gateSrc) && !/send|command|mpv|window|document/i.test(gateSrc.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(process.exitCode ?? 0);
