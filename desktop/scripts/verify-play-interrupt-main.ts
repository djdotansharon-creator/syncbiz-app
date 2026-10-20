/**
 * JINGLES P0 — Electron MAIN (designated branch MASTER) must execute PLAY_INTERRUPT via the EXISTING interrupt
 * channel, and Preview must never broadcast.
 *
 *  #1/#2  CONTROL → server → MAIN COMMAND PLAY_INTERRUPT → orchestrator.playInterrupt (real DeviceWsManager,
 *         local ws server on 127.0.0.1, fake orchestrator recording calls)
 *  #3     relative server URL resolves against the configured app origin
 *  #4     absolute https URL stays valid
 *  #5     LOCAL filesystem path / file: / local:// rejected → nothing plays
 *  #6     invalid payloads fail safely
 *  #7/#8/#9 Preview emits zero PLAY_INTERRUPT; browser/mobile preview local; explicit On-Air still emits it (static)
 *  #10    interrupt does not alter designation / MASTER role
 *  #11    LOCAL session/queue intact (no music-channel call, mock session unchanged)
 * The server never sends `designated`, so the ProgramData designation cache is never written.
 *
 * Run (from desktop/): npx tsx scripts/verify-play-interrupt-main.ts
 */
import { readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { WebSocketServer, type WebSocket as WsSocket } from "ws";
import { DeviceWsManager, resolveInterruptUrl, interruptUrlsForPayload } from "../src/device-websocket-client/device-ws-manager";
import { readDesignationRecord } from "../src/main/designation-cache";
import type { DesktopRuntimeConfig } from "../src/shared/mvp-types";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const read = (...p: string[]) => readFileSync(path.join(__dirname, "..", "..", ...p), "utf-8").replace(/\r\n/g, "\n");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise<number>((res) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => res(p)); }); });
const APP = "https://syncbiz-app-test-production.up.railway.app";

// ── PURE resolution (#3–#6) ─────────────────────────────────────────────────────────────────────────────────
assert("#3 relative /api/jingles/audio/<id> → absolute on the app origin",
  resolveInterruptUrl("/api/jingles/audio/91361cb7-e1cf", APP) === `${APP}/api/jingles/audio/91361cb7-e1cf`);
assert("#3 relative bell path resolves", resolveInterruptUrl("/api/jingles/bell/ding", APP) === `${APP}/api/jingles/bell/ding`);
assert("#4 absolute https URL kept", resolveInterruptUrl("https://cdn.example.com/a.mp3", APP) === "https://cdn.example.com/a.mp3");
assert("http on a foreign origin rejected", resolveInterruptUrl("http://evil.example.com/a.mp3", APP) === null);
assert("http allowed only when it IS the configured app origin (local dev)",
  resolveInterruptUrl("http://localhost:3000/api/jingles/audio/x", "http://localhost:3000") === "http://localhost:3000/api/jingles/audio/x");
assert("#5 Windows path rejected", resolveInterruptUrl("C:\\Music\\jingle.mp3", APP) === null && resolveInterruptUrl("C:/Music/jingle.mp3", APP) === null);
assert("#5 UNC path rejected", resolveInterruptUrl("\\\\server\\share\\a.mp3", APP) === null);
assert("#5 file: and local:// rejected", resolveInterruptUrl("file:///C:/a.mp3", APP) === null && resolveInterruptUrl("local://abc", APP) === null);
assert("#5 POSIX-like absolute path is treated as server-relative (never a local file)",
  resolveInterruptUrl("/home/user/a.mp3", APP) === `${APP}/home/user/a.mp3`);
assert("#6 protocol-relative //host rejected", resolveInterruptUrl("//evil.example.com/a.mp3", APP) === null);
assert("#6 bare relative / empty / non-string / huge rejected",
  resolveInterruptUrl("a.mp3", APP) === null && resolveInterruptUrl("", APP) === null &&
  resolveInterruptUrl(undefined, APP) === null && resolveInterruptUrl(42, APP) === null &&
  resolveInterruptUrl("/" + "x".repeat(3000), APP) === null);
assert("#6 javascript:/data: rejected", resolveInterruptUrl("javascript:alert(1)", APP) === null && resolveInterruptUrl("data:audio/mp3;base64,AA", APP) === null);
assert("#6 relative with NO configured app origin rejected", resolveInterruptUrl("/api/jingles/audio/x", "") === null);
assert("payload: preRoll+bellStyle → [bell, main]",
  JSON.stringify(interruptUrlsForPayload({ url: "/api/jingles/audio/x", preRoll: true, bellStyle: "ding" }, APP)) ===
  JSON.stringify([`${APP}/api/jingles/bell/ding`, `${APP}/api/jingles/audio/x`]));
assert("payload: bellStyle off / unsafe → main only",
  interruptUrlsForPayload({ url: "/api/jingles/audio/x", preRoll: true, bellStyle: "off" }, APP).length === 1 &&
  interruptUrlsForPayload({ url: "/api/jingles/audio/x", preRoll: true, bellStyle: "../../etc" }, APP).length === 1);
assert("payload: invalid url → [] (nothing plays, even with a bell)",
  interruptUrlsForPayload({ url: "C:\\a.mp3", preRoll: true, bellStyle: "ding" }, APP).length === 0 &&
  interruptUrlsForPayload(null, APP).length === 0 && interruptUrlsForPayload({}, APP).length === 0);

// ── BEHAVIORAL: real DeviceWsManager ↔ local server (#1 #2 #5 #6 #10 #11) ──────────────────────────────────
(async () => {
  const calls: string[] = [];
  const interrupts: string[] = [];
  const fakeOrch = {
    onStatus: () => undefined,
    getState: () => ({ music: { status: "playing", engineReady: true, lastError: null, attemptId: 7, attemptMode: "cold" }, isDucked: false, duckTargetVolume: 0, duckPercent: 40, currentMediaKey: "" }),
    getCrossfadeSec: () => 6,
    playInterrupt: (u: string) => { calls.push("playInterrupt"); interrupts.push(u); },
    playMusic: () => calls.push("playMusic"),
    playMusicCrossfade: () => calls.push("playMusicCrossfade"),
    pauseMusic: () => calls.push("pauseMusic"),
    resumeMusic: () => calls.push("resumeMusic"),
    stopMusic: () => calls.push("stopMusic"),
    stopInterrupt: () => calls.push("stopInterrupt"),
    setVolume: () => calls.push("setVolume"),
  };
  const port = await freePort();
  const wss = new WebSocketServer({ host: "127.0.0.1", port });
  let station: WsSocket | null = null;
  wss.on("connection", (sock) => {
    station = sock;
    sock.on("message", (raw) => {
      const m = JSON.parse(String(raw));
      if (m.type === "REGISTER") {
        sock.send(JSON.stringify({ type: "REGISTERED" }));
        sock.send(JSON.stringify({ type: "SET_DEVICE_MODE", mode: "MASTER" })); // no `designated` → cache untouched
      }
    });
  });
  const designationBefore = JSON.stringify(readDesignationRecord());
  const cfg = { wsUrl: `ws://127.0.0.1:${port}`, wsToken: "t-not-a-secret", deviceId: "dsk-test-0000", branchId: "default", apiBaseUrl: APP } as unknown as DesktopRuntimeConfig;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = new DeviceWsManager(cfg, fakeOrch as any);
  m.connect();
  await sleep(500);
  const before = m.snapshot();
  assert("station registered as MASTER", before.deviceRole === "MASTER" && before.registered === true);
  // Server forwards a CONTROL's command exactly as server/index.ts does: { type:"COMMAND", command, payload }.
  const send = (payload: unknown) => station!.send(JSON.stringify({ type: "COMMAND", command: "PLAY_INTERRUPT", payload }));

  send({ url: "/api/jingles/audio/91361cb7-e1cf", preRoll: true, bellStyle: "ding" });
  await sleep(300);
  assert("#1/#2 CONTROL PLAY_INTERRUPT reaches MAIN → orchestrator.playInterrupt (bell then announcement)",
    JSON.stringify(interrupts) === JSON.stringify([`${APP}/api/jingles/bell/ding`, `${APP}/api/jingles/audio/91361cb7-e1cf`]), JSON.stringify(interrupts));
  send({ url: "https://cdn.example.com/a.mp3" });
  await sleep(200);
  assert("#4 absolute https announcement played as-is", interrupts[interrupts.length - 1] === "https://cdn.example.com/a.mp3");
  const n = interrupts.length;
  send({ url: "C:\\Users\\x\\Music\\secret.mp3" });
  send({ url: "file:///C:/a.mp3" });
  send({});
  send(null);
  send({ url: 123 });
  await sleep(300);
  assert("#5/#6 local paths & invalid payloads → nothing played, no crash", interrupts.length === n && m.snapshot().registered === true);

  const after = m.snapshot();
  assert("#10 MASTER role + registration unchanged by interrupts", after.deviceRole === "MASTER" && after.registered === true);
  assert("#10 designation cache unchanged", JSON.stringify(readDesignationRecord()) === designationBefore);
  assert("#10 offline-designation flag unchanged", after.designatedStationOffline === before.designatedStationOffline);
  assert("#11 music channel never touched (only playInterrupt calls)", calls.every((c) => c === "playInterrupt"), calls.join(","));
  assert("#11 LOCAL session/queue state unchanged",
    after.mockPlaybackStatus === before.mockPlaybackStatus && after.mockCurrentSourceLabel === before.mockCurrentSourceLabel &&
    JSON.stringify(after.stationPlayback ?? null) === JSON.stringify(before.stationPlayback ?? null));
  m.disconnect();
  wss.close();

  // ── STATIC wiring ─────────────────────────────────────────────────────────────────────────────────────────
  const mgr = read("desktop", "src", "device-websocket-client", "device-ws-manager.ts");
  const route = mgr.slice(mgr.indexOf("private routeToOrchestrator("), mgr.indexOf("default:\n        break;", mgr.indexOf("private routeToOrchestrator(")));
  assert("#2 routeToOrchestrator has an additive PLAY_INTERRUPT case → interruptUrlsForPayload → orch.playInterrupt",
    /case "PLAY_INTERRUPT": \{[\s\S]*interruptUrlsForPayload\(payload, this\.config\.apiBaseUrl\)[\s\S]*orch\.playInterrupt\(u\)/.test(route));
  const orchSrc = read("desktop", "src", "main", "playback-orchestrator.ts");
  assert("orchestrator.playInterrupt reused (existing method, dedupe queue)", /playInterrupt\(url: string\): void \{/.test(orchSrc));

  const shell = read("components", "jingles-control", "JinglesShell.tsx");
  // Every Preview button's onClick: only preview.toggle, never fireOnAir / handleResultPlay / sendCommandToMaster.
  const previewButtons = [...shell.matchAll(/<button[^>]*?>?[\s\S]{0,600}?(?:▶ Preview|"■" : "▶")[\s\S]{0,40}?<\/button>/g)].map((x) => x[0]);
  const previewOnClicks = [...shell.matchAll(/onClick=\{\(\) => \{\s*if \(!isDesktop\) preview\.toggle\([^)]*\);\s*\}\}/g)];
  assert("#7 two Preview buttons wired to LOCAL preview.toggle only", previewOnClicks.length === 2);
  assert("#7 no Preview path can call fireOnAir / handleResultPlay / sendCommandToMaster",
    !/isDesktop \? (fireOnAir|handleResultPlay)/.test(shell) && previewButtons.every((b) => !/fireOnAir|handleResultPlay|sendCommandToMaster/.test(b)));
  assert("#7 desktop Preview is disabled with an explicit unavailable state (never silently On-Air)",
    (shell.match(/disabled=\{!(?:resultCard\.url|a\.url) \|\| isDesktop\}/g) ?? []).length === 2 && /Preview isn't available in the desktop app yet/.test(shell));
  assert("#9 explicit On-Air buttons still emit via fireOnAir / handleResultPlay",
    /onClick=\{handleResultPlay\}[\s\S]{0,200}📡 On-Air/.test(shell) && /onClick=\{\(\) => fireOnAir\(a\.url\)\}[\s\S]{0,200}📡 On-Air/.test(shell));
  assert("#9 fireOnAir still routes CONTROL → PLAY_INTERRUPT", /sendCommandToMaster\("PLAY_INTERRUPT", \{ url \}\)/.test(shell));
  const hook = read("components", "jingles-control", "use-audio-preview.ts");
  assert("#8 browser preview hook is local-only (no WS / bridge / PLAY_INTERRUPT)", !/PLAY_INTERRUPT|sendCommand|syncbizDesktop/.test(hook));
  const mobile = read("components", "mobile", "mobile-jingles.tsx");
  const mobPreview = mobile.slice(mobile.indexOf("const togglePreview = useCallback("), mobile.indexOf("const togglePreview = useCallback(") + 900);
  assert("#8 mobile preview stays local (togglePreview has no PLAY_INTERRUPT)", mobPreview.length > 100 && !/PLAY_INTERRUPT|sendCommandToMaster/.test(mobPreview));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(process.exitCode ?? 0);
})();
