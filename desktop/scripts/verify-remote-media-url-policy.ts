/**
 * C1 SECURITY — remote media URL policy (SSRF / internal-address / local-file hardening for the station player).
 *
 *  PURE (exhaustive)  — resolveRemoteMediaTarget allows every legitimate PUBLIC http(s) source (HTTP Radio,
 *                       YouTube / SoundCloud page URLs, Droploud→R2, /api/media, m3u8/aac) and rejects internal /
 *                       private / loopback / link-local / CGNAT / ULA hosts in every encoding (decimal / octal /
 *                       hex IPv4, IPv4-mapped & bracketed IPv6), localhost / *.local, file / local / UNC / Windows
 *                       paths / backslashes, protocol-relative //host, non-http(s) schemes, and URL credentials.
 *  BEHAVIORAL (A1)    — a real DeviceWsManager on a local WS server: a forbidden PLAY / PLAY_SOURCE url never
 *                       reaches orchestrator.playMusicCrossfade; an allowed one does; LOCAL metadata-only is intact.
 *  STATIC wiring      — A1 at PLAY + PLAY_SOURCE (device-ws-manager); A2 at loadInternal BEFORE resolveOfflineUrl
 *                       (mpv-manager); the policy module is pure (no fs / net imports).
 *
 * Run (from desktop/): npx tsx scripts/verify-remote-media-url-policy.ts
 */
import { readFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { WebSocketServer, type WebSocket as WsSocket } from "ws";
import { resolveRemoteMediaTarget, isAllowedRemoteMediaUrl, setTrustedAppOrigin } from "../src/shared/remote-media-url-policy";
import { DeviceWsManager } from "../src/device-websocket-client/device-ws-manager";
import { setPlaybackSourcePathForTests } from "../src/main/playback-source-store";
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

const ok = (name: string, raw: unknown, base?: string) =>
  assert(`ALLOW  ${name}`, resolveRemoteMediaTarget(raw, base) !== null, JSON.stringify(raw));
const okEq = (name: string, raw: string, base?: string) =>
  assert(`ALLOW  ${name}`, resolveRemoteMediaTarget(raw, base) === raw, `${JSON.stringify(raw)} → ${JSON.stringify(resolveRemoteMediaTarget(raw, base))}`);
const no = (name: string, raw: unknown, base?: string) =>
  assert(`REJECT ${name}`, resolveRemoteMediaTarget(raw, base) === null, JSON.stringify(raw));

// ── ALLOW — every legitimate remote source keeps working ────────────────────────────────────────────────────
okEq("https public", "https://cdn.example.com/a.mp3");
okEq("http public (HTTP RADIO)", "http://ice1.somafm.com:8000/groovesalad");
okEq("YouTube page URL (yt-dlp resolves)", "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
okEq("youtu.be", "https://youtu.be/dQw4w9WgXcQ");
okEq("SoundCloud page URL", "https://soundcloud.com/artist/track");
okEq("Droploud → R2 media", "https://pub-abc123.r2.dev/track/full.mp3");
okEq("VONO app origin /api/media", `${APP}/api/media/8f3c2a11`);
okEq("HLS .m3u8 stream", "https://radio.example.com/live/stream.m3u8");
okEq("plain .aac http stream", "http://radio.example.com:9000/stream.aac");
okEq("public IPv4 literal stream", "http://8.8.8.8/stream");
okEq("public IPv4 literal with port", "http://1.2.3.4:8000/stream");
okEq("public IPv6 literal", "http://[2001:4860:4860::8888]/stream");
okEq("host string contains a private IP in the PATH only (host is public)", "https://cdn.example.com/10.0.0.1/a.mp3");
// public IPs just OUTSIDE each private block must stay allowed (boundary)
okEq("172.15.x is public (below 172.16/12)", "http://172.15.0.1/s");
okEq("172.32.x is public (above 172.16/12)", "http://172.32.0.1/s");
okEq("100.63.x is public (below CGNAT)", "http://100.63.0.1/s");
okEq("100.128.x is public (above CGNAT)", "http://100.128.0.1/s");
okEq("192.167 / 192.169 are public", "http://192.167.0.1/s");
// server-relative path (A1 only, with the configured app origin) → resolved onto that origin
assert("ALLOW  server-relative /api/media on app origin → absolute",
  resolveRemoteMediaTarget("/api/media/x", APP) === `${APP}/api/media/x`);
assert("ALLOW  server-relative /api/jingles on app origin → absolute",
  resolveRemoteMediaTarget("/api/jingles/audio/x", APP) === `${APP}/api/jingles/audio/x`);
assert("isAllowedRemoteMediaUrl matches resolve", isAllowedRemoteMediaUrl("https://cdn.example.com/a.mp3") && !isAllowedRemoteMediaUrl("http://10.0.0.1/a"));

// ── Same-origin trusted-app-origin exception (localhost-jingle fix; LOCAL config only, no remote bypass) ──────
assert("TRUST explicit base: localhost app-origin jingle allowed (dev)",
  resolveRemoteMediaTarget("http://localhost:3000/api/jingles/audio/x", "http://localhost:3000") === "http://localhost:3000/api/jingles/audio/x");
assert("TRUST explicit base: localhost app-origin media allowed (dev)",
  resolveRemoteMediaTarget("http://localhost:3000/api/media/x", "http://localhost:3000") === "http://localhost:3000/api/media/x");
assert("TRUST no base → localhost still rejected (strict)", resolveRemoteMediaTarget("http://localhost:3000/api/media/x") === null);
assert("TRUST a DIFFERENT internal host is NOT exempt even with a base", resolveRemoteMediaTarget("http://10.0.0.1/x", "http://localhost:3000") === null);
assert("TRUST port must match for the exception", resolveRemoteMediaTarget("http://localhost:3001/x", "http://localhost:3000") === null);
// module-global (set once from LOCAL config at main startup; A2 relies on it since mpv-manager passes no base)
setTrustedAppOrigin("http://localhost:3000");
assert("TRUST global: A2 (no base) allows the configured app origin", resolveRemoteMediaTarget("http://localhost:3000/api/media/x") === "http://localhost:3000/api/media/x");
assert("TRUST global: a non-trusted internal host stays rejected", resolveRemoteMediaTarget("http://10.0.0.1/x") === null && resolveRemoteMediaTarget("http://127.0.0.1/x") === null);
setTrustedAppOrigin("https://syncbiz-app-test-production.up.railway.app");
assert("TRUST global prod origin does NOT newly allow any internal host", resolveRemoteMediaTarget("http://10.0.0.1/x") === null && resolveRemoteMediaTarget("http://localhost:3000/x") === null);
setTrustedAppOrigin(null);
assert("TRUST global cleared → strict again", resolveRemoteMediaTarget("http://localhost:3000/api/media/x") === null);

// ── REJECT — internal IPv4 literals (every private / special block) ─────────────────────────────────────────
no("10.0.0.0/8 private", "http://10.0.0.5/a");
no("172.16.0.0/12 private (low)", "http://172.16.0.1/a");
no("172.31.x private (high)", "http://172.31.255.1/a");
no("192.168.0.0/16 private", "http://192.168.1.1/a");
no("127.0.0.0/8 loopback", "http://127.0.0.1/a");
no("127.x loopback (other)", "http://127.9.9.9/a");
no("169.254.0.0/16 link-local", "http://169.254.169.254/latest/meta-data");
no("100.64.0.0/10 CGNAT", "http://100.100.0.1/a");
no("0.0.0.0/8 this-host", "http://0.0.0.0/a");
no("255.255.255.255 broadcast", "http://255.255.255.255/a");

// ── REJECT — internal addresses via ENCODING / alternate forms (parser canonicalises, or throws → null) ──────
no("IPv4 decimal 2130706433 = 127.0.0.1", "http://2130706433/a");
no("IPv4 hex 0x7f000001 = 127.0.0.1", "http://0x7f000001/a");
no("IPv4 octal 0177.0.0.1 = 127.0.0.1", "http://0177.0.0.1/a");
no("IPv4 short 127.1 = 127.0.0.1", "http://127.1/a");
no("IPv4 hex-octet 10.0.0.5", "http://0x0a.0x00.0x00.0x05/a");
no("IPv4 decimal 3232235777 = 192.168.1.1", "http://3232235777/a");

// ── REJECT — IPv6 internal, incl. IPv4-mapped ───────────────────────────────────────────────────────────────
no("IPv6 ::1 loopback", "http://[::1]/a");
no("IPv6 :: unspecified", "http://[::]/a");
no("IPv6 fe80::/10 link-local", "http://[fe80::1]/a");
no("IPv6 fc00::/7 ULA (fc)", "http://[fc00::1]/a");
no("IPv6 fc00::/7 ULA (fd)", "http://[fd12:3456::1]/a");
no("IPv6 IPv4-mapped ::ffff:10.0.0.1", "http://[::ffff:10.0.0.1]/a");
no("IPv6 IPv4-mapped ::ffff:127.0.0.1", "http://[::ffff:127.0.0.1]/a");

// ── REJECT — localhost / mDNS names ─────────────────────────────────────────────────────────────────────────
no("localhost", "http://localhost/a");
no("localhost:port", "http://localhost:3000/api/media/x");
no("*.localhost", "http://api.localhost/a");
no("*.local (mDNS)", "http://printer.local/a");

// ── REJECT — non-http(s) schemes ────────────────────────────────────────────────────────────────────────────
no("file:// local file", "file:///C:/Music/secret.mp3");
no("local:// scheme", "local://abc123");
no("ytdl:// scheme (VONO never emits it)", "ytdl://https://x");
no("data: URI", "data:audio/mp3;base64,AAAA");
no("javascript:", "javascript:alert(1)");
no("blob:", "blob:https://x/y");

// ── REJECT — Windows / UNC / backslash / bare-relative / protocol-relative ──────────────────────────────────
no("Windows drive path (backslash)", "C:\\Music\\x.mp3");
no("Windows drive path (forward slash)", "C:/Music/x.mp3");
no("UNC path", "\\\\fileserver\\share\\x.mp3");
no("backslash anywhere in an http url", "https://ok.example.com/a\\..\\b.mp3");
no("protocol-relative //host", "//evil.example.com/a.mp3");
no("bare relative filename", "a.mp3");
no("bare relative path", "music/folder/a.mp3");

// ── REJECT — URL credentials (also keeps secrets out of logs) ───────────────────────────────────────────────
no("credentials user:pass@public", "http://user:pass@public.example.com/a.mp3");
no("userinfo masks internal host", "http://public.example.com@10.0.0.1/a");
no("internal in userinfo, public host → still rejected (credentials present)", "http://10.0.0.1@public.example.com/a");

// ── REJECT — malformed / oversized / wrong type / no base for relative ──────────────────────────────────────
no("empty string", "");
no("non-string (number)", 42 as unknown);
no("non-string (undefined)", undefined as unknown);
no("non-string (object)", {} as unknown);
no("oversized (>2048)", "https://x.example.com/" + "a".repeat(3000));
no("server-relative with NO configured origin", "/api/media/x", "");
no("server-relative with undefined origin", "/api/media/x");
no("server-relative with a non-http origin", "/api/media/x", "ftp://host");

// ── BEHAVIORAL (A1): real DeviceWsManager — forbidden url never plays, allowed url does ──────────────────────
(async () => {
  setPlaybackSourcePathForTests(path.join(os.tmpdir(), `vono-c1-test-${process.pid}.json`));
  const played: string[] = [];
  const calls: string[] = [];
  const fakeOrch = {
    onStatus: () => undefined,
    getState: () => ({ music: { status: "playing", engineReady: true, lastError: null, attemptId: 7, attemptMode: "cold" }, isDucked: false, duckTargetVolume: 0, duckPercent: 40, currentMediaKey: "" }),
    getCrossfadeSec: () => 6,
    isMusicAttemptPending: () => false,
    playInterrupt: () => calls.push("playInterrupt"),
    playMusic: (u: string) => { calls.push("playMusic"); played.push(u); },
    playMusicCrossfade: (u: string) => { calls.push("playMusicCrossfade"); played.push(u); },
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
        sock.send(JSON.stringify({ type: "SET_DEVICE_MODE", mode: "MASTER" }));
      }
    });
  });
  const cfg = { wsUrl: `ws://127.0.0.1:${port}`, wsToken: "t-not-a-secret", deviceId: "dsk-test-0000", branchId: "default", apiBaseUrl: APP } as unknown as DesktopRuntimeConfig;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = new DeviceWsManager(cfg, fakeOrch as any);
  m.connect();
  await sleep(500);
  assert("station registered as MASTER", m.snapshot().registered === true && m.snapshot().deviceRole === "MASTER");
  const sendCmd = (command: string, payload: unknown) => station!.send(JSON.stringify({ type: "COMMAND", command, payload }));

  // PLAY — forbidden targets never play.
  sendCmd("PLAY", { url: "http://169.254.169.254/latest/meta-data" }); // cloud-metadata SSRF classic
  sendCmd("PLAY", { url: "http://10.0.0.5/internal" });
  sendCmd("PLAY", { url: "file:///C:/secret.mp3" });
  sendCmd("PLAY", { url: "\\\\fileserver\\share\\x.mp3" });
  await sleep(250);
  assert("#A1 PLAY: forbidden targets never reached playMusicCrossfade", played.length === 0, JSON.stringify(played));

  // PLAY — an allowed public target plays.
  sendCmd("PLAY", { url: "https://cdn.example.com/legit.mp3" });
  await sleep(250);
  assert("#A1 PLAY: allowed public target played", played.length === 1 && played[0] === "https://cdn.example.com/legit.mp3", JSON.stringify(played));

  // PLAY_SOURCE — forbidden remote url rejected before any playback.
  const playedAfterPlay = played.length;
  sendCmd("PLAY_SOURCE", { source: { id: "s1", type: "source", url: "http://192.168.1.50/a.mp3" }, trackIndex: 0 });
  await sleep(250);
  assert("#A1 PLAY_SOURCE: forbidden remote source never played", played.length === playedAfterPlay, JSON.stringify(played));

  // PLAY_SOURCE — an allowed public url plays.
  sendCmd("PLAY_SOURCE", { source: { id: "s2", type: "source", url: "https://pub-abc.r2.dev/full.mp3" }, trackIndex: 0 });
  await sleep(250);
  assert("#A1 PLAY_SOURCE: allowed public source played", played.length === playedAfterPlay + 1 && played[played.length - 1] === "https://pub-abc.r2.dev/full.mp3", JSON.stringify(played));

  // PLAY_SOURCE — LOCAL (type "local", url stripped on the wire) is metadata-only, never a music-channel load.
  const playedAfterSrc = played.length;
  sendCmd("PLAY_SOURCE", { source: { id: "s3", type: "local", title: "Local Song" } });
  await sleep(250);
  assert("#A1 PLAY_SOURCE: LOCAL type never triggers a remote load (renderer owns local audio)", played.length === playedAfterSrc, JSON.stringify(played));
  assert("#A1 no crash — still registered", m.snapshot().registered === true);

  m.disconnect();
  wss.close();
  setPlaybackSourcePathForTests(null);

  // ── STATIC wiring ─────────────────────────────────────────────────────────────────────────────────────────
  const mgr = read("desktop", "src", "device-websocket-client", "device-ws-manager.ts");
  assert("import of the policy present in device-ws-manager",
    /import \{ resolveRemoteMediaTarget \} from "\.\.\/shared\/remote-media-url-policy"/.test(mgr));
  const playCase = mgr.slice(mgr.indexOf('case "PLAY": {'), mgr.indexOf('case "PLAY_SOURCE": {'));
  assert("A1 wired at PLAY: resolveRemoteMediaTarget gates the url + rejects with a break",
    /resolveRemoteMediaTarget\(rawUrl, this\.config\.apiBaseUrl\)/.test(playCase) && /PLAY rejected/.test(playCase));
  const srcCase = mgr.slice(mgr.indexOf('case "PLAY_SOURCE": {'), mgr.indexOf('case "QUEUE_NEXT": {'));
  assert("A1 wired at PLAY_SOURCE early gate: resolveRemoteMediaTarget rejects a forbidden non-LOCAL target",
    /resolveRemoteMediaTarget\(rUrl, this\.config\.apiBaseUrl\)/.test(srcCase) && /forbidden\/non-public media target \(C1\)/.test(srcCase));

  const mpv = read("desktop", "src", "main", "mpv-manager.ts");
  assert("import of the policy present in mpv-manager (2026-11-18: resolveMpvLoadTarget = the remote policy + the LOCAL drive-path exception)",
    /import \{ resolveMpvLoadTarget \} from "\.\.\/shared\/remote-media-url-policy"/.test(mpv));
  const loadStart = mpv.indexOf("private loadInternal(");
  const load = mpv.slice(loadStart, mpv.indexOf("pause(): void {", loadStart));
  const idxPolicy = load.indexOf("resolveMpvLoadTarget(u)");
  const idxOffline = load.indexOf("resolveOfflineUrl(u)");
  assert("A2 wired in loadInternal: policy gate present", idxPolicy > -1);
  assert("A2 ordering: policy check runs BEFORE resolveOfflineUrl (loopback output never re-checked)",
    idxPolicy > -1 && idxOffline > -1 && idxPolicy < idxOffline, `policy@${idxPolicy} offline@${idxOffline}`);
  assert("A2 is fail-safe: a rejected target returns without loadfile, no st mutation",
    /if \(!resolveMpvLoadTarget\(u\)\) \{[\s\S]{0,400}?return;\s*\}/.test(load));

  const policy = read("desktop", "src", "shared", "remote-media-url-policy.ts");
  assert("policy module is PURE (no node: imports, no require, no fetch/net)",
    !/from "node:/.test(policy) && !/require\(/.test(policy) && !/\bfetch\b|createServer|net\./.test(policy));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(process.exitCode ?? 0);
})();
