/**
 * P0 STEP 0 (owner-approved 2026-10-13) — Channel B (jingles) failure recovery. BEHAVIOURAL tests of the real
 * InterruptChannel with a fake interrupt deck + a fake clock, plus static wiring guards on the orchestrator.
 * Owner rules: explicit failure = immediate recovery · 10 s = failsafe only · ONE idempotent cleanup path ·
 * Channel B only (no global STOP, no music playback change).
 * Run (from desktop/): npx tsx scripts/verify-interrupt-channel.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { InterruptChannel, INTERRUPT_FAILSAFE_MS, type InterruptDeckStatus } from "../src/main/interrupt-channel";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}

const GAP = 290;

/** A fake Channel B deck + duck + clock. `ducked` mirrors the orchestrator's isDucked. */
function rig(opts: { engineReady?: boolean; noProcess?: boolean } = {}) {
  let t = 0;
  let timers: { id: number; at: number; fn: () => void }[] = [];
  let nextId = 1;
  const st: InterruptDeckStatus = { status: "idle", position: 0, lastError: null, engineReady: opts.engineReady ?? true, attemptId: 0 };
  const ev = { loads: [] as { url: string; attemptId: number }[], halts: 0, ducks: 0, unducks: [] as boolean[], logs: [] as { event: string; data: Record<string, unknown> }[] };
  let ducked = false;
  // eslint-disable-next-line prefer-const
  let ch: InterruptChannel;
  const push = (patch: Partial<InterruptDeckStatus>) => { Object.assign(st, patch); ch.onStatus({ ...st }); };
  ch = new InterruptChannel({
    load: (url, attemptId) => {
      ev.loads.push({ url, attemptId });
      // MpvManager.play() with no process pushes idle + error SYNCHRONOUSLY (attemptId NOT re-stamped)
      if (opts.noProcess) push({ status: "idle", lastError: "play(): mpv is not running", engineReady: false });
    },
    halt: () => { ev.halts++; st.status = "stopped"; ch.onStatus({ ...st }); },
    status: () => ({ ...st }),
    duck: () => { ev.ducks++; ducked = true; },
    unduck: (immediate) => { ev.unducks.push(immediate); ducked = false; },
    changed: () => {},
    log: (event, data) => ev.logs.push({ event, data }),
    setTimer: (fn, ms) => { const id = nextId++; timers.push({ id, at: t + ms, fn }); return id; },
    clearTimer: (h) => { timers = timers.filter((x) => x.id !== h); },
    now: () => t,
  }, GAP);
  const advance = (ms: number) => {
    const end = t + ms;
    for (;;) {
      const due = timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers = timers.filter((x) => x.id !== due.id);
      t = due.at;
      due.fn();
    }
    t = end;
  };
  const cur = () => ev.loads[ev.loads.length - 1].attemptId;
  /** MPV start-file of the current load + time-pos ticks. */
  const startFile = () => push({ status: "playing", position: 0, lastError: null, attemptId: cur() });
  const tick = (pos: number) => push({ status: "playing", position: pos, attemptId: cur() });
  const eof = () => push({ status: "idle", position: 0, lastError: null, attemptId: cur() });
  const endFileError = (msg = "loading failed") => push({ status: "idle", lastError: msg, attemptId: cur() });
  return { ch, ev, st, push, advance, startFile, tick, eof, endFileError, cur, isDucked: () => ducked, pending: () => timers.length };
}
const reasons = (r: ReturnType<typeof rig>) => r.ev.logs.map((l) => String(l.data.reason));

// ── T1 normal completion ──────────────────────────────────────────────────────────────────────────────────────────
{
  const r = rig();
  r.ch.enqueue("https://app/api/jingles/audio/a");
  assert("T1a enqueue → music ducked + clip loaded on Channel B", r.ev.ducks === 1 && r.ev.loads.length === 1 && r.isDucked() && r.ch.busy);
  r.startFile(); r.advance(1000); r.tick(1); r.advance(1000); r.tick(2); r.advance(1000); r.eof();
  assert("T1b natural end → 'completed', music restored with the RAMP, no halt, queue unlocked, no timers left",
    reasons(r).join() === "completed" && r.ev.unducks.join() === "false" && r.ev.halts === 0 && !r.ch.busy && !r.isDucked() && r.pending() === 0);
}

// ── T2 immediate load failure (corrupt file / DNS fail): no waiting ──────────────────────────────────────────────
{
  const r = rig();
  r.ch.enqueue("https://app/api/jingles/audio/bad");
  r.startFile(); r.advance(100); r.endFileError("unrecognized file format");
  assert("T2 explicit load error → recovered IMMEDIATELY (t=100ms, not 10 s): 'load_error', Channel B halted, volume restored",
    reasons(r).join() === "load_error" && r.ev.logs[0].data.ms === 100 && r.ev.halts === 1 && !r.isDucked() && !r.ch.busy && r.pending() === 0);
}

// ── T3 no-start timeout (nothing ever arrives) + the unreachable-URL shape (start-file, then silence) ─────────────
{
  const r = rig();
  r.ch.enqueue("https://app/api/jingles/audio/x");
  r.advance(INTERRUPT_FAILSAFE_MS - 1);
  const stillWaiting = r.ch.busy && r.isDucked() && r.ev.logs.length === 0;
  r.advance(1);
  assert("T3a no signal at all → still waiting at 9.999 s, 'no_start_timeout' exactly at 10 s, volume restored",
    stillWaiting && reasons(r).join() === "no_start_timeout" && r.ev.logs[0].data.ms === INTERRUPT_FAILSAFE_MS && !r.isDucked() && !r.ch.busy && r.ev.halts === 1);

  const u = rig();
  u.ch.enqueue("http://unreachable/x.mp3");
  u.startFile(); // probe: mpv emits start-file at once, end-file(error) only after 37–55 s
  u.advance(INTERRUPT_FAILSAFE_MS);
  assert("T3b unreachable URL (start-file but no progress) → recovered at 10 s, not 37–55 s",
    reasons(u).join() === "no_start_timeout" && !u.isDucked() && !u.ch.busy);
  u.endFileError(); // the late mpv end-file(error) of that clip
  assert("T3c the late end-file(error) after the timeout is a no-op (cleanup once)", u.ev.logs.length === 1 && u.ev.unducks.length === 1);
}

// ── T4 stall timeout (network drops mid-clip) ────────────────────────────────────────────────────────────────────
{
  const r = rig();
  r.ch.enqueue("https://app/api/jingles/audio/long");
  r.startFile();
  for (let s = 1; s <= 8; s++) { r.advance(1000); r.tick(s); } // 8 s of real progress (longer than nothing)
  const alive = r.ch.busy && r.ev.logs.length === 0;
  r.advance(INTERRUPT_FAILSAFE_MS - 1);
  const notYet = r.ch.busy;
  r.advance(1);
  assert("T4 progress keeps the clip alive; 10 s after the LAST progress → 'stall_timeout', Channel B halted, volume restored",
    alive && notYet && reasons(r).join() === "stall_timeout" && r.ev.halts === 1 && !r.isDucked() && !r.ch.busy);
}

// ── T5 MPV process death (mid-clip and before start) + no process at load ───────────────────────────────────────
{
  const r = rig();
  r.ch.enqueue("https://app/api/jingles/audio/a");
  r.startFile(); r.advance(1000); r.tick(1);
  r.push({ status: "idle", position: 0, engineReady: false, lastError: "mpv process exited (code: 1)" }); // onMpvProcessExit
  assert("T5a MPV dies mid-clip → 'engine_down' immediately, volume restored, queue unlocked",
    reasons(r).join() === "engine_down" && !r.isDucked() && !r.ch.busy && r.pending() === 0);

  const b = rig();
  b.ch.enqueue("https://app/api/jingles/audio/a"); // MPV dies BEFORE start-file (the old forever-stuck case)
  b.push({ status: "idle", position: 0, engineReady: false, lastError: "[watchdog] restarting mpv" });
  assert("T5b MPV dies after load but before start-file → 'engine_down' immediately (was: stuck forever, music ducked)",
    reasons(b).join() === "engine_down" && !b.isDucked() && !b.ch.busy);

  const n = rig({ engineReady: false, noProcess: true });
  n.ch.enqueue("https://app/api/jingles/audio/a"); // no MPV process at all (restarting / binary missing)
  assert("T5c no MPV process at load → 'engine_down' synchronously (no 10 s wait), volume restored",
    reasons(n).join() === "engine_down" && n.ev.logs[0].data.ms === 0 && !n.isDucked() && !n.ch.busy && n.pending() === 0);
}

// ── T6 double failure: error + process exit + timeout → ONE cleanup ─────────────────────────────────────────────
{
  const r = rig();
  r.ch.enqueue("https://app/api/jingles/audio/a");
  r.ch.enqueue("https://app/api/jingles/audio/b");
  r.startFile();
  r.endFileError();
  r.push({ status: "idle", engineReady: false, lastError: "mpv process exited" });
  r.endFileError();
  r.advance(INTERRUPT_FAILSAFE_MS * 3); // any stale failsafe would fire here
  const loadsOfB = r.ev.loads.filter((l) => l.url.endsWith("/b")).length;
  assert("T6 error + process exit + repeated error + timeouts → exactly ONE recovery (1 unduck, 1 abort log) and ONE advance",
    r.ev.unducks.length === 2 /* A's single cleanup + B's own (B never starts → failsafe) */ &&
    r.ev.logs.filter((l) => l.data.attemptId === r.ev.loads[0].attemptId).length === 1 && loadsOfB === 1,
    JSON.stringify(r.ev.logs.map((l) => [l.data.attemptId, l.data.reason])));
}

// ── T7 the next queued jingle continues after a failure ─────────────────────────────────────────────────────────
{
  const r = rig();
  r.ch.enqueue("https://app/api/jingles/audio/a");
  r.ch.enqueue("https://app/api/jingles/audio/b");
  assert("T7a second clip waits in the queue", r.ch.queueDepth === 1 && r.ev.loads.length === 1);
  r.startFile(); r.endFileError();
  const waitingGap = r.ev.loads.length === 1;
  r.advance(GAP);
  const b = r.ev.loads[1];
  assert("T7b after A fails, B loads after the unduck gap with a NEW attempt id, ducked again",
    waitingGap && !!b && b.url.endsWith("/b") && b.attemptId !== r.ev.loads[0].attemptId && r.isDucked() && r.ev.ducks === 2);
  r.startFile(); r.advance(1000); r.tick(1); r.eof();
  assert("T7c B completes normally → music restored, queue empty",
    reasons(r).join() === "load_error,completed" && !r.isDucked() && !r.ch.busy && r.ch.queueDepth === 0 && r.pending() === 0);
}

// ── T8 stale events of a previous load never end the current clip ───────────────────────────────────────────────
{
  const r = rig();
  r.ch.enqueue("https://app/api/jingles/audio/a");
  r.startFile(); r.eof();
  r.ch.enqueue("https://app/api/jingles/audio/b");
  r.advance(GAP);
  const prevId = r.ev.loads[0].attemptId;
  r.push({ status: "idle", lastError: null, attemptId: prevId }); // end-file reason=replace of the previous entry
  r.push({ status: "playing", position: 0, attemptId: prevId }); // pause=false property change (old attempt id)
  assert("T8 end-file(replace) / property events with the OLD attempt id are ignored — B still playing-pending",
    r.ch.busy && r.isDucked() && r.ev.logs.length === 1);
}

// ── T9 explicit stop (STOP command / designation revoke) — same cleanup path, immediate volume, no advance ────────
{
  const r = rig();
  r.ch.enqueue("https://app/api/jingles/audio/a");
  r.ch.enqueue("https://app/api/jingles/audio/b");
  r.startFile();
  r.ch.stopAll();
  r.advance(INTERRUPT_FAILSAFE_MS * 2);
  assert("T9 stopAll → 'stopped', volume restored IMMEDIATELY (no ramp), queue cleared, nothing else loads",
    reasons(r).join() === "stopped" && r.ev.unducks.join() === "true" && r.ch.queueDepth === 0 && r.ev.loads.length === 1 && !r.ch.busy && r.pending() === 0);
}

// ── T10 unchanged behaviour: dedupe of a WAITING url; bell + clip play in order ──────────────────────────────────
{
  const r = rig();
  r.ch.enqueue("https://app/api/jingles/bell/ding");
  r.ch.enqueue("https://app/api/jingles/audio/a");
  r.ch.enqueue("https://app/api/jingles/audio/a");
  assert("T10a same URL already waiting is not stacked twice", r.ch.queueDepth === 1);
  r.startFile(); r.eof(); r.advance(GAP);
  assert("T10b bell first, then the clip", r.ev.loads.map((l) => l.url.split("/").pop()).join() === "ding,a");
}

// ── Static wiring guards (orchestrator): Channel B only ──────────────────────────────────────────────────────────
{
  const orch = readFileSync(path.join(__dirname, "..", "src", "main", "playback-orchestrator.ts"), "utf-8");
  const chan = readFileSync(path.join(__dirname, "..", "src", "main", "interrupt-channel.ts"), "utf-8");
  const ctor = orch.slice(orch.indexOf("this.interrupt = new InterruptChannel("), orch.indexOf("this.musicDeckA.onStatus("));
  assert("W1 ports touch ONLY the interrupt deck + the duck (no music deck play/stop, no stopMusic / global STOP)",
    /load: \(url, attemptId\) => this\.interruptMpv\.play\(url, attemptId\)/.test(ctor) && /halt: \(\) => this\.interruptMpv\.stop\(\)/.test(ctor) &&
    !/musicDeck[AB]\.|stopMusic|activeMpv\(\)\.(play|stop)/.test(ctor));
  assert("W2 every Channel B status push goes through the channel (one place)",
    /this\.interruptMpv\.onStatus\(\(s\) => \{\s*this\.interruptSt = s;[\s\S]{0,300}this\.interrupt\.onStatus\(s\);/.test(orch));
  assert("W3 the old ad-hoc state is gone (interruptHasStarted / processQueue / onInterruptEnd)",
    !/interruptHasStarted|processQueue\(|onInterruptEnd\(/.test(orch));
  assert("W4 playInterrupt / stopInterrupt keep their public signatures (WS + IPC callers unchanged)",
    /playInterrupt\(url: string\): void \{\s*[^}]*this\.interrupt\.enqueue\(url\);/.test(orch) && /stopInterrupt\(\): void \{\s*this\.interrupt\.stopAll\(\);/.test(orch));
  assert("W5 the channel module is pure (no electron / mpv-manager / fs imports)", !/^import (?!type)/m.test(chan));
  assert("W6 logs carry reason + attemptId + ms only (never the URL)", /this\.ports\.log\([^)]*\{ reason, attemptId, ms:/.test(chan) && !/log\([^)]*url/.test(chan));
}

console.log(`\n${pass} passed, ${fail} failed`);
