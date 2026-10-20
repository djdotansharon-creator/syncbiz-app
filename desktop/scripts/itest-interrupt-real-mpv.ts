/**
 * P0 STEP 0 — INTEGRATION test with the REAL PlaybackOrchestrator + REAL mpv.exe (Channel B only; music decks stay
 * idle). Local-only: a 127.0.0.1 http server serves a SILENT wav / a stalling response; nothing leaves the machine.
 * Measures per scenario: recovery time, the REAL music-deck volume read back from mpv after recovery, the duck low
 * point, the end reason, and that every clip is cleaned up exactly once.
 * Build + run (from desktop/), with VONO CLOSED (the test refuses otherwise):
 *   npx esbuild scripts/itest-interrupt-real-mpv.ts --bundle --platform=node --external:electron --outfile=<tmp>/itest.cjs
 *   npx electron <tmp>/itest.cjs
 * Requires MPV_BIN (absolute path to mpv.exe).
 */
import http from "node:http";
import { writeFileSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "electron";
import { PlaybackOrchestrator } from "../src/main/playback-orchestrator";

const MPV = process.env.MPV_BIN ?? "";
let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else fail++;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function silentWav(seconds: number): Buffer {
  const rate = 8000, n = rate * seconds, b = Buffer.alloc(44 + n);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n, 4); b.write("WAVE", 8); b.write("fmt ", 12); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate, 28); b.writeUInt16LE(1, 32);
  b.writeUInt16LE(8, 34); b.write("data", 36); b.writeUInt32LE(n, 40); b.fill(128, 44);
  return b;
}

/** SAFETY (2026-10-13 incident): the orchestrator uses the FIXED pipe names (\\.\pipe\syncbiz-music / -music-b /
 *  -interrupt). With a VONO station running on the same machine the test's IPC clients can attach to the LIVE
 *  player's MPV (Windows allows several instances of one pipe name). Refuse to run unless no mpv / VONO runs. */
function assertNoLivePlayer(): void {
  if (process.platform !== "win32") return;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const out = String(require("node:child_process").execSync("tasklist /FO CSV /NH", { encoding: "utf8" })).toLowerCase();
  if (out.includes("\"mpv.exe\"") || out.includes("\"syncbiz player.exe\"")) {
    console.error("REFUSED: a VONO player / mpv.exe is running on this machine — close VONO first (shared MPV pipe names).");
    app.exit(3);
    throw new Error("live player running");
  }
}

type EndEvent = { reason: string; attemptId: number; ms: number };

async function run(): Promise<void> {
  assertNoLivePlayer();
  const dir = mkdtempSync(path.join(os.tmpdir(), "vono-itest-"));
  const corrupt = path.join(dir, "corrupt.mp3");
  writeFileSync(corrupt, Buffer.from("ID3 not audio ".repeat(300)));
  const wav3 = silentWav(3);
  const srv = http.createServer((req, res) => {
    if (req.url?.startsWith("/ok")) { res.writeHead(200, { "content-type": "audio/wav", "content-length": String(wav3.length) }); res.end(wav3); return; }
    if (req.url?.startsWith("/stall")) { res.writeHead(200, { "content-type": "audio/mpeg", "content-length": "900000" }); res.write(Buffer.alloc(2000, 0xff)); return; }
    res.writeHead(404); res.end();
  });
  await new Promise<void>((r) => srv.listen(39188, "127.0.0.1", () => r()));
  const B = "http://127.0.0.1:39188";

  // every channel end event (the orchestrator logs INTERRUPT_END / INTERRUPT_ABORT via console.log)
  const ends: EndEvent[] = [];
  const origLog = console.log.bind(console);
  console.log = (...args: unknown[]) => {
    if (typeof args[1] === "string" && /^INTERRUPT_(END|ABORT)$/.test(args[1]) && args[2] && typeof args[2] === "object") ends.push(args[2] as EndEvent);
    origLog(...args);
  };
  const lastReason = () => ends[ends.length - 1]?.reason ?? "?";

  const orch = new PlaybackOrchestrator();
  orch.start({ mpvBin: MPV, ytDlpBin: null });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const o = orch as any;
  const engineUp = async () => { for (let i = 0; i < 60 && !orch.getState().interrupt.engineReady; i++) await sleep(250); return orch.getState().interrupt.engineReady as boolean; };
  await engineUp();
  for (let i = 0; i < 40 && !o.activeSt().engineReady; i++) await sleep(250);
  orch.setVolume(80); // the user's volume, set once the music deck's mpv is up (as the station does after start)
  for (let i = 0; i < 50 && o.activeSt().volume !== 80; i++) await sleep(100);
  assert("setup: real Channel B MPV ready + music deck volume 80 (read back from mpv)", orch.getState().interrupt.engineReady && o.activeSt().volume === 80);

  /** the REAL volume of the audible music deck as mpv reports it, after the unduck ramp */
  const deckVolume = async () => { await sleep(450); return o.activeSt().volume as number; };
  let low = 100;
  const watchDuck = () => { low = 100; const id = setInterval(() => { low = Math.min(low, o.activeSt().volume); }, 25); return () => clearInterval(id); };
  /** wait until the channel is idle + not ducked + queue empty; returns ms waited (-1 = never) */
  const settle = async (limitMs: number) => {
    const t0 = Date.now();
    while (Date.now() - t0 < limitMs) {
      const st = orch.getState();
      if (!st.interruptBusy && !st.isDucked && st.interruptQueueDepth === 0) return Date.now() - t0;
      await sleep(25);
    }
    return -1;
  };
  const rows: string[] = [];
  const row = (name: string, ms: number, vol: number, extra: string) =>
    rows.push(`${name.padEnd(28)} recovery ${String(ms).padStart(6)} ms | volume after ${vol} | duck low ${low} | ${extra}`);

  // 1 normal jingle (3 s silent wav)
  let stop = watchDuck();
  orch.playInterrupt(`${B}/ok/1.wav`);
  const w1 = await settle(8000); stop();
  const v1 = await deckVolume();
  row("1 normal jingle", w1, v1, lastReason());
  assert("1 normal jingle → ducked while playing, natural end (~3 s), volume back to 80",
    low < 80 && w1 > 2000 && w1 < 6000 && v1 === 80 && lastReason() === "completed", `ms=${w1} vol=${v1} low=${low}`);

  // 2 broken file
  stop = watchDuck();
  orch.playInterrupt(corrupt);
  const w2 = await settle(5000); stop();
  const v2 = await deckVolume();
  row("2 broken file", w2, v2, lastReason());
  assert("2 broken file → immediate (< 2 s), volume back to 80", w2 >= 0 && w2 < 2000 && v2 === 80 && lastReason() === "load_error", `ms=${w2} vol=${v2}`);

  // 3 unavailable URL (connection refused — mpv alone waits ~37 s)
  stop = watchDuck();
  orch.playInterrupt("http://127.0.0.1:9/x.mp3");
  const w3 = await settle(15000); stop();
  const v3 = await deckVolume();
  row("3 unavailable URL", w3, v3, lastReason());
  assert("3 unavailable URL → failsafe ≈10 s (not 37 s), volume back to 80", w3 >= 9000 && w3 < 12000 && v3 === 80, `ms=${w3} vol=${v3}`);

  // 4 network drop mid-download (headers + 2 KB, then nothing)
  stop = watchDuck();
  orch.playInterrupt(`${B}/stall/x.mp3`);
  const w4 = await settle(15000); stop();
  const v4 = await deckVolume();
  row("4 network drop", w4, v4, lastReason());
  assert("4 network drop → ≈10 s (mpv alone ~33 s), volume back to 80", w4 >= 9000 && w4 < 12000 && v4 === 80, `ms=${w4} vol=${v4}`);

  // 5 MPV killed mid-jingle
  stop = watchDuck();
  orch.playInterrupt(`${B}/ok/2.wav`);
  await sleep(700);
  const wasDucked = orch.getState().isDucked;
  o.interruptMpv.child?.kill();
  const w5 = await settle(5000); stop();
  const v5 = await deckVolume();
  row("5 MPV killed mid-jingle", w5, v5, lastReason());
  assert("5 MPV killed mid-jingle → immediate, volume back to 80", wasDucked && w5 >= 0 && w5 < 2000 && v5 === 80 && lastReason() === "engine_down", `ms=${w5} vol=${v5}`);
  assert("5b Channel B MPV restarted by its own watchdog", await engineUp());

  // 6 failed jingle followed by a good queued jingle
  stop = watchDuck();
  const before6 = ends.length;
  orch.playInterrupt(corrupt);
  orch.playInterrupt(`${B}/ok/3.wav`);
  await sleep(1200);
  const nextPlaying = orch.getState().interruptBusy && orch.getState().isDucked;
  const w6 = await settle(10000); stop();
  const v6 = await deckVolume();
  const r6 = ends.slice(before6).map((e) => e.reason).join(" → ");
  row("6 failed → good queued", w6, v6, r6);
  assert("6 failed clip, then the queued good clip PLAYS to its end, volume back to 80", nextPlaying && r6 === "load_error → completed" && v6 === 80, `${r6} vol=${v6}`);

  // 7 double failure: a broken clip AND an MPV death at the same moment (+ every late event of both)
  stop = watchDuck();
  const before7 = ends.length;
  orch.playInterrupt(corrupt);
  o.interruptMpv.child?.kill(); // load error + process exit + socket close race each other
  const w7 = await settle(5000); stop();
  await sleep(1500); //            let every late event arrive
  const ends7 = ends.slice(before7);
  const v7 = await deckVolume();
  row("7 double failure", w7, v7, `${ends7.length} cleanup(s): ${ends7.map((e) => e.reason).join(",")}`);
  assert("7 double failure → exactly ONE cleanup for that clip, immediate, volume back to 80", ends7.length === 1 && w7 >= 0 && w7 < 2000 && v7 === 80, JSON.stringify(ends7));
  assert("7b Channel B MPV restarted again", await engineUp());
  const before7c = ends.length;
  stop = watchDuck();
  orch.playInterrupt(`${B}/ok/4.wav`);
  const w7c = await settle(8000); stop();
  const v7c = await deckVolume();
  row("7c next jingle after it", w7c, v7c, ends.slice(before7c).map((e) => e.reason).join(","));
  assert("7c the next jingle after the double failure → completed, volume back to 80 (queue not stuck)",
    ends.slice(before7c).map((e) => e.reason).join() === "completed" && v7c === 80 && w7c > 2000, `ms=${w7c} vol=${v7c}`);

  // global: never two end events for the same clip in the whole run
  const ids = ends.map((e) => e.attemptId);
  assert("GLOBAL cleanup-once: every clip has exactly one end event across the whole run", new Set(ids).size === ids.length, JSON.stringify(ids));
  const st = orch.getState();
  assert("END state: not ducked, queue empty, master volume 80, deck volume 80",
    !st.isDucked && !st.interruptBusy && st.interruptQueueDepth === 0 && st.masterVolume === 80 && o.activeSt().volume === 80);

  console.log = origLog;
  console.log("\n── SUMMARY ──\n" + rows.join("\n"));
  orch.kill();
  srv.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  app.exit(fail ? 1 : 0);
}

app.whenReady().then(() => run().catch((e) => { console.error(e); app.exit(2); }));
