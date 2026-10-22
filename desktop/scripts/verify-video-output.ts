/**
 * P0 Video V1 (owner-approved 2026-10-09) — synced video: the picture comes from the SAME MPV player as the sound.
 * OFF by default (today's audio-only engine, identical arguments); ON per station (applies at the next VONO start).
 * Covers: the OFF path is unchanged, video spawn arguments, Auto quality, fade-through-black locked to the audio ramp,
 * stall protection (picture dropped for the rest of the song, back at the next load), placement / hiding, the switch
 * file, and the renderer wiring. REAL PlaybackOrchestrator + MpvManager command capture (no MPV process).
 * Run (from desktop/): npx tsx scripts/verify-video-output.ts
 */
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { MpvManager } from "../src/main/mpv-manager";
import { PlaybackOrchestrator, type VideoMixEvent } from "../src/main/playback-orchestrator";
import { VideoOutput, VideoQuality, mixFrame, videoFormatForCap, VIDEO_CAPS } from "../src/main/video-output";
import { readVideoOutputConfig, writeVideoOutputConfig, setVideoOutputConfigPathForTests } from "../src/main/video-output-config";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
type Raw = { raw: (s: string) => void; child: unknown; videoSpawnArgs: () => string[]; handleEvent: (m: Record<string, unknown>) => void };
/** An MpvManager whose IPC writes are captured (no process). */
function capturedDeck(name: string, video: boolean) {
  const d = new MpvManager(name);
  if (video) d.enableVideoOutput(`VONO Video ${name}`, videoFormatForCap(1080));
  const sent: unknown[][] = [];
  const r = d as unknown as Raw;
  r.raw = (s: string) => { try { const m = JSON.parse(s) as { command: unknown[] }; sent.push(m.command); } catch { /* */ } };
  r.child = {}; // loads are accepted
  return { d, sent, r, props: (n: string) => sent.filter((c) => c[0] === "set_property" && c[1] === n).map((c) => c[2]) };
}

// ── the OFF path is today's engine ──
const mgrSrc = readFileSync(path.join(__dirname, "..", "src", "main", "mpv-manager.ts"), "utf-8").replace(/\r\n/g, "\n");
assert("O1 OFF: the audio-only spawn arguments are unchanged (same literal: --no-video, bestaudio/best …)",
  /const mpvArgs = this\.video \? this\.videoSpawnArgs\(\) : \[\n      "--no-video",\n      "--idle",\n      "--ytdl-format=bestaudio\/best",\n      "--cache=yes",\n      "--cache-secs=30",\n      "--demuxer-max-bytes=64MiB",\n      "--network-timeout=30",/.test(mgrSrc));
{
  const a = capturedDeck("off", false);
  a.d.setVideoProperty("geometry", "10x10+0+0"); a.d.setVideoFormat("x"); a.d.dropVideoForCurrentFile();
  a.d.play("https://www.youtube.com/watch?v=aaaaaaaaaaa", 1);
  assert("O2 OFF: every video call is a no-op; a load sends no video command", !a.d.isVideoOutput() && !a.sent.some((c) => ["geometry", "ytdl-format", "vid", "brightness"].includes(String(c[1]))), JSON.stringify(a.sent));
}
// ── video spawn arguments ──
{
  const v = capturedDeck("on", true);
  const args = v.r.videoSpawnArgs();
  assert("A1 ON: no --no-video; same cache / network settings as audio", !args.includes("--no-video") && ["--cache=yes", "--cache-secs=30", "--demuxer-max-bytes=64MiB", "--network-timeout=30", "--idle"].every((x) => args.includes(x)));
  assert("A2 ON: the picture window never takes focus, has no taskbar entry / border, keeps VONO's size, starts hidden",
    ["--focus-on=never", "--show-in-taskbar=no", "--no-border", "--auto-window-resize=no", "--force-window=no", "--geometry=16x9+-32000+-32000", "--ontop"].every((x) => args.includes(x)));
  assert("A3 ON: hardware decoding + frame dropping (the picture yields, never the sound); no cover-art window for audio files",
    ["--hwdec=auto-safe", "--framedrop=vo", "--audio-display=no"].every((x) => args.includes(x)));
  assert("A4 ON: Auto quality starts at 1080p with an AUDIO-ONLY last resort (a missing picture never fails the song)",
    args.includes(`--ytdl-format=${videoFormatForCap(1080)}`) && videoFormatForCap(1080).endsWith("/bestaudio/best") && videoFormatForCap(720).includes("height<=?720"));
}
// ── fade-through-black follows the audio ramp ──
{
  const f0 = mixFrame(0), f25 = mixFrame(0.25), f50 = mixFrame(0.5), f75 = mixFrame(0.75), f1 = mixFrame(1);
  assert("M1 first half: the outgoing picture fades to black, the incoming stays hidden", !f0.showIncoming && f0.outBrightness === 0 && f25.outBrightness === -50 && !f25.showIncoming);
  assert("M2 midpoint: the incoming picture takes the screen (from black) and fades in to normal at the end", f50.showIncoming && f50.inBrightness === -100 && f75.inBrightness === -50 && f1.inBrightness === 0);
}
// ── Auto quality ──
{
  const q = new VideoQuality();
  assert("Q1 starts at 1080p", q.cap() === 1080);
  q.onStall();
  assert("Q2 a buffering stall → 720p for the next songs", q.cap() === 720);
  q.onSongBoundary();
  q.onDrops(30); q.onDrops(40);
  assert("Q3 too many dropped frames in one song → one step down (480p), once per song", q.cap() === 480 && !q.onDrops(500) && q.cap() === 480);
  q.onSongBoundary(); // closes the song that had the dropped frames
  q.onSongBoundary(); q.onSongBoundary(); q.onSongBoundary();
  assert("Q4 three clean songs → one step back up (720p)", q.cap() === 720, String(q.cap()));
  for (let i = 0; i < 10; i++) q.onStall();
  assert("Q5 never below the lowest step (360p)", q.cap() === VIDEO_CAPS[VIDEO_CAPS.length - 1]);
  for (let i = 0; i < 40; i++) q.onSongBoundary();
  assert("Q6 never above 1080p", q.cap() === 1080);
}
// ── VideoOutput: placement, mix, stall, hiding ──
{
  const A = capturedDeck("A", true), B = capturedDeck("B", true);
  const vo = new VideoOutput({ A: A.d, B: B.d });
  const win = new EventEmitter();
  vo.attachWindow(win as never, { toScreen: (r) => ({ x: r.x + 1000, y: r.y + 100, width: r.width, height: r.height }) });
  const lastGeo = (x: ReturnType<typeof capturedDeck>) => x.props("geometry").pop();
  vo.onMix({ kind: "active", deck: "A", reason: "cold" });
  A.r.handleEvent({ event: "property-change", name: "video-params", data: { w: 1920, h: 1080 } });
  assert("P1 no slot reported yet → the picture stays hidden", lastGeo(A) === undefined || lastGeo(A) === "16x9+-32000+-32000");
  vo.setDockRect({ x: 10, y: 20, width: 640, height: 360 });
  assert("P2 slot reported → deck A's window covers it (screen pixels)", lastGeo(A) === "640x360+1010+120", String(lastGeo(A)));
  const evs: VideoMixEvent[] = [0, 0.3, 0.6, 1].map((frac) => ({ kind: "ramp", from: "A", to: "B", frac }));
  vo.onMix(evs[0]); vo.onMix(evs[1]);
  B.r.handleEvent({ event: "property-change", name: "video-params", data: { w: 1280, h: 720 } });
  assert("P3 crossfade first half: A fades (brightness -60), B hidden", A.props("brightness").pop() === -60 && (lastGeo(B) === undefined || lastGeo(B) === "16x9+-32000+-32000"));
  vo.onMix(evs[2]);
  assert("P4 after the midpoint: B takes the slot (fading in), A hidden", lastGeo(B) === "640x360+1010+120" && lastGeo(A) === "16x9+-32000+-32000" && B.props("brightness").pop() === -80);
  vo.onMix(evs[3]); vo.onMix({ kind: "active", deck: "B", reason: "swap" });
  assert("P5 ramp done → B at normal brightness", B.props("brightness").pop() === 0);
  B.r.handleEvent({ event: "property-change", name: "paused-for-cache", data: true });
  assert("S1 a buffering stall while B's picture shows → picture OFF for the rest of this song (audio untouched) + next loads capped 720p on both decks",
    B.props("vid").pop() === "no" && B.props("ytdl-format").pop() === videoFormatForCap(720) && A.props("ytdl-format").pop() === videoFormatForCap(720));
  B.r.handleEvent({ event: "property-change", name: "video-params", data: null });
  assert("S2 … the empty picture window is hidden", lastGeo(B) === "16x9+-32000+-32000");
  B.d.play("https://www.youtube.com/watch?v=bbbbbbbbbbb", 2);
  const loadAt = B.sent.findIndex((c) => c[0] === "loadfile");
  const vidAt = B.sent.map((c, i) => (c[1] === "vid" && c[2] === "auto" ? i : -1)).filter((i) => i >= 0).pop() ?? -1;
  assert("S3 the picture returns only with the NEXT load (vid=auto sent right before loadfile — never mid-song)", vidAt >= 0 && vidAt < loadAt);
  B.r.handleEvent({ event: "property-change", name: "video-params", data: { w: 1280, h: 720 } });
  win.emit("minimize");
  assert("W1 VONO minimized → the picture hides", lastGeo(B) === "16x9+-32000+-32000");
  win.emit("restore");
  assert("W2 restored → back on the slot", lastGeo(B) === "640x360+1010+120");
  vo.setDockRect(null);
  assert("W3 slot gone (artwork mode / other screen) → hidden", lastGeo(B) === "16x9+-32000+-32000");
}
// ── the orchestrator reports the mix (reporting only) ──
async function orchestratorEvents(): Promise<void> {
  const orch = new PlaybackOrchestrator();
  type Deck = { handleEvent: (m: Record<string, unknown>) => void; st: { engineReady: boolean }; play: (u: string, id?: number) => void };
  const o = orch as unknown as { musicDeckA: Deck; musicDeckB: Deck; activeMusicDeck: "A" | "B" };
  for (const d of [o.musicDeckA, o.musicDeckB]) d.st.engineReady = true;
  const evs: VideoMixEvent[] = [];
  orch.setVideoMixListener((e) => evs.push(e));
  const at = (d: Deck, s: number) => d.handleEvent({ event: "property-change", name: "time-pos", data: s });
  const start = (d: Deck) => { d.handleEvent({ event: "start-file" }); d.handleEvent({ event: "property-change", name: "duration", data: 200 }); d.handleEvent({ event: "file-loaded" }); d.handleEvent({ event: "property-change", name: "core-idle", data: false }); at(d, 1); at(d, 2); };
  orch.playMusic("https://www.youtube.com/watch?v=ccccccccccc", 1_000_000_001); start(o.musicDeckA);
  orch.playMusicCrossfade("https://www.youtube.com/watch?v=ddddddddddd", 1, 1_000_000_002); start(o.musicDeckB);
  await new Promise((r) => setTimeout(r, 1400));
  const ramps = evs.filter((e) => e.kind === "ramp") as Array<{ frac: number; from: string; to: string }>;
  assert("R1 cold play → 'active A (cold)'", evs[0]?.kind === "active" && (evs[0] as { deck: string }).deck === "A");
  assert("R2 the audio ramp reports its progress A→B (0 … 1, increasing)", ramps.length >= 5 && ramps[0].frac === 0 && ramps[ramps.length - 1].frac === 1 && ramps.every((r, i) => i === 0 || r.frac >= ramps[i - 1].frac) && ramps.every((r) => r.from === "A" && r.to === "B"));
  const last = evs[evs.length - 1] as { kind: string; deck?: string; reason?: string };
  assert("R3 ramp complete → 'active B (swap)'", last.kind === "active" && last.deck === "B" && last.reason === "swap");
  orch.setVideoMixListener(() => { throw new Error("boom"); });
  let threw = false;
  try { orch.stopMusic(); } catch { threw = true; }
  assert("R4 a failing picture listener can never break the audio path", !threw);
  orch.kill();
}

async function main(): Promise<void> {
  await orchestratorEvents();
  // ── the switch file ──
  const dir = mkdtempSync(path.join(os.tmpdir(), "vono-video-"));
  setVideoOutputConfigPathForTests(path.join(dir, "video-output.json"));
  assert("C1 no file → OFF (default)", readVideoOutputConfig().enabled === false);
  writeVideoOutputConfig({ enabled: true });
  assert("C2 switch saved ON", readVideoOutputConfig().enabled === true);
  writeVideoOutputConfig({ enabled: false });
  assert("C3 switch saved OFF", readVideoOutputConfig().enabled === false);
  setVideoOutputConfigPathForTests(null);
  // ── wiring pins ──
  const rd = (p: string) => readFileSync(path.join(__dirname, "..", "..", p), "utf-8").replace(/\r\n/g, "\n");
  const idx = rd("desktop/src/main/index.ts"), ap = rd("components/audio-player.tsx"), bg = rd("components/player-surface/desktop-player-background.tsx");
  assert("W4 MAIN reads the switch ONCE, before the decks spawn (OFF = today's engine)", /if \(readVideoOutputConfig\(\)\.enabled\) \{[\s\S]*?orchestrator\.enableVideoOutput\(videoOut\.initialFormat\(\)\);[\s\S]*?\}\s*else \{[\s\S]*?\}\n  orchestrator\.start\(binaries\);/.test(idx));
  assert("W5 station (CONTROL mirror) with synced video: MPV slot, never the YouTube iframe", /isControlMirror && mpvVideo\.active \? \(/.test(ap) && /<MpvVideoSurface className=/.test(ap));
  assert("W6 local desktop background: no iframe / iframe timers while synced video is active", /const showVideo = !mpvVideoActive && /.test(bg) && /if \(mpvVideoActive \|\| mode !== "video"/.test(bg));
  console.log(`\n${pass} passed, ${fail} failed`);
}
main().then(() => process.exit(process.exitCode ?? 0), (e) => { console.error(e); process.exit(1); });
