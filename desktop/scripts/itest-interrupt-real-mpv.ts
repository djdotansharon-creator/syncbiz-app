/**
 * P0 STEP 0 — INTEGRATION test with the REAL PlaybackOrchestrator + REAL mpv.exe (Channel B only; music decks stay
 * idle). Local-only: a 127.0.0.1 http server serves a SILENT wav / a stalling response; nothing leaves the machine.
 * Build + run (from desktop/):
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

async function run(): Promise<void> {
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

  const orch = new PlaybackOrchestrator();
  orch.setVolume(80);
  orch.start({ mpvBin: MPV, ytDlpBin: null });
  for (let i = 0; i < 50 && !orch.getState().interrupt.engineReady; i++) await sleep(200);
  assert("setup: real Channel B MPV engine ready", orch.getState().interrupt.engineReady);

  // wait until the channel is idle + undocked; returns ms waited
  const settle = async (limitMs: number) => {
    const t0 = Date.now();
    while (Date.now() - t0 < limitMs) {
      const s = orch.getState();
      if (!s.interruptBusy && !s.isDucked && s.interruptQueueDepth === 0) return Date.now() - t0;
      await sleep(50);
    }
    return -1;
  };
  const ducked = () => orch.getState().isDucked;

  // R1 normal clip (3 s silent wav)
  orch.playInterrupt(`${B}/ok/1.wav`);
  await sleep(300);
  const d1 = ducked();
  const w1 = await settle(8000);
  assert("R1 normal jingle: ducked while playing, restored at its natural end (~3 s)", d1 && w1 > 2000 && w1 < 6000, `ms=${w1}`);

  // R2 corrupt file → immediate
  orch.playInterrupt(corrupt);
  const w2 = await settle(5000);
  assert("R2 corrupt file → recovered immediately (< 2 s)", w2 >= 0 && w2 < 2000, `ms=${w2}`);

  // R3 unavailable URL (connection refused — mpv itself would wait ~37 s)
  orch.playInterrupt("http://127.0.0.1:9/x.mp3");
  const w3 = await settle(15000);
  assert("R3 unavailable URL → recovered by the failsafe (≈10 s, not 37–55 s)", w3 >= 0 && w3 < 12000, `ms=${w3}`);

  // R4 network drops mid-download (headers + 2 KB then silence)
  orch.playInterrupt(`${B}/stall/x.mp3`);
  const w4 = await settle(15000);
  assert("R4 network drop mid-clip → recovered ≤ ~10 s (mpv alone: ~33 s)", w4 >= 0 && w4 < 12000, `ms=${w4}`);

  // R5 MPV process killed mid-clip → engine_down immediately
  orch.playInterrupt(`${B}/ok/2.wav`);
  await sleep(700);
  const wasDucked = ducked();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ((orch as any).interruptMpv as any).child?.kill();
  const w5 = await settle(5000);
  assert("R5 MPV killed mid-jingle → recovered immediately (< 2 s), music restored", wasDucked && w5 >= 0 && w5 < 2000, `ms=${w5}`);

  // R6 after the watchdog restart, a queued failure + a good clip: the queue continues
  for (let i = 0; i < 60 && !orch.getState().interrupt.engineReady; i++) await sleep(250);
  assert("R6a Channel B MPV restarted by its own watchdog", orch.getState().interrupt.engineReady);
  orch.playInterrupt(corrupt);
  orch.playInterrupt(`${B}/ok/3.wav`);
  await sleep(1200);
  const playingNext = orch.getState().interruptBusy && ducked();
  const w6 = await settle(10000);
  assert("R6b failed clip then queued good clip → the good clip plays, then everything restored", playingNext && w6 > 1000, `ms=${w6}`);

  // R7 volume is the user's volume at the end of every case
  const st = orch.getState();
  assert("R7 end state: not ducked, queue empty, master volume unchanged (80)", !st.isDucked && !st.interruptBusy && st.masterVolume === 80);

  orch.kill();
  srv.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  app.exit(fail ? 1 : 0);
}

app.whenReady().then(() => run().catch((e) => { console.error(e); app.exit(2); }));
