/**
 * C2 SECURITY — behavioral test over the REAL WS server (server/index.ts): a URL-bearing COMMAND with a forbidden
 * media target is DROPPED before forwarding, while every legitimate target (public http/https, YouTube/SoundCloud,
 * HTTP radio, Droploud, server-relative JINGLES, and LOCAL metadata-only PLAY_SOURCE) is forwarded unchanged.
 *
 * Jingles & Playback Reliability is a Critical Business Function — the interrupt (jingle) paths are tested
 * explicitly, plus command REPLAY, device RECONNECT and a SECOND room (multi-branch isolation).
 *
 * Boots the real server on an ephemeral port with a test secret + temp lease dir; no DB, no external network.
 * Run: npx tsx server/verify-c2-ws-url-policy.ts
 */
import { createHmac } from "node:crypto";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";

const TEST_SECRET = "test-ws-secret-c2-policy-0123456789";
const PORT = 41000 + Math.floor(Math.random() * 2000);
const leaseDir = mkdtempSync(path.join(os.tmpdir(), "vono-c2-"));
process.env.SYNCBIZ_WS_SECRET = TEST_SECRET;
process.env.WS_SECRET = TEST_SECRET;
process.env.PORT = String(PORT);
process.env.RAILWAY_VOLUME_MOUNT_PATH = leaseDir;
process.env.NODE_ENV = "test";
const WSURL = `ws://127.0.0.1:${PORT}`;

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function mintToken(userId: string, workspaceId: string, branches: string[]): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = { purpose: "ws_register", userId, iat: now, exp: now + 60, workspaceId, authorizedBranches: branches };
  const b64 = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  const sig = createHmac("sha256", TEST_SECRET).update(b64).digest("base64url");
  return `${b64}.${sig}`;
}

type Msg = Record<string, unknown>;
type Client = { ws: WebSocket; buf: Msg[]; send: (o: unknown) => void; waitFor: (p: (m: Msg) => boolean, ms?: number) => Promise<Msg>; got: (p: (m: Msg) => boolean) => boolean; count: (p: (m: Msg) => boolean) => number; close: () => void };
function mkClient(): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WSURL);
    const buf: Msg[] = [];
    const waiters: { pred: (m: Msg) => boolean; resolve: (m: Msg) => void }[] = [];
    ws.on("message", (data) => {
      let m: Msg; try { m = JSON.parse(data.toString()) as Msg; } catch { return; }
      buf.push(m);
      for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i].pred(m)) { waiters[i].resolve(m); waiters.splice(i, 1); }
    });
    ws.on("open", () => resolve({
      ws, buf,
      send: (o) => ws.send(JSON.stringify(o)),
      waitFor: (pred, ms = 2500) => new Promise<Msg>((res, rej) => {
        const hit = buf.find(pred); if (hit) return res(hit);
        const w = { pred, resolve: res }; waiters.push(w);
        setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); rej(new Error("timeout")); } }, ms);
      }),
      got: (pred) => buf.some(pred),
      count: (pred) => buf.filter(pred).length,
      close: () => ws.close(),
    }));
    ws.on("error", reject);
  });
}
const isType = (t: string) => (m: Msg) => m.type === t;
async function regDevice(c: Client, token: string, deviceId: string, branchId: string) {
  c.send({ type: "REGISTER", role: "device", authToken: token, deviceId, branchId, isMobile: false,
    registrationIntent: { schemaVersion: 1, runtimeMode: "branch_playback", devicePurpose: "branch_desktop_station" } });
  await c.waitFor(isType("REGISTERED"));
}
async function regController(c: Client, token: string, branchId: string) {
  c.send({ type: "REGISTER", role: "controller", authToken: token, branchId });
  await c.waitFor(isType("REGISTERED"));
}
const cmd = (command: string) => (m: Msg) => m.type === "COMMAND" && (m as { command?: string }).command === command;
const cmdUrl = (command: string, url: string) => (m: Msg) => {
  if (m.type !== "COMMAND" || (m as { command?: string }).command !== command) return false;
  const p = (m as { payload?: { url?: string; source?: { url?: string } } }).payload ?? {};
  return p.url === url || p.source?.url === url;
};
const errContains = (s: string) => (m: Msg) => m.type === "ERROR" && String((m as { message?: string }).message).includes(s);

async function main(): Promise<void> {
  await import("./index.js").catch(() => null);
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) { try { const c = await mkClient(); c.close(); ready = true; } catch { await sleep(100); } }
  assert("WS server booted", ready);
  if (!ready) { console.log(`\n${pass} passed, ${fail} failed`); process.exit(1); }

  // ── Room 1 (ws-1 / branch-A): MASTER + controller ───────────────────────────────────────────────────────────
  const master = await mkClient();
  await regDevice(master, mintToken("u1", "ws-1", ["branch-A"]), "s1-master", "branch-A");
  await master.waitFor((m) => m.type === "SET_DEVICE_MODE" && (m as { mode?: string }).mode === "MASTER");
  const ctrl = await mkClient();
  await regController(ctrl, mintToken("u1", "ws-1", ["branch-A"]), "branch-A");
  await ctrl.waitFor(isType("DEVICE_LIST"));

  const send = (command: string, payload: unknown) => ctrl.send({ type: "COMMAND", command, payload });

  // ALLOW — legitimate targets are forwarded to the MASTER.
  send("PLAY", { url: "https://cdn.example.com/legit.mp3" });
  await master.waitFor(cmdUrl("PLAY", "https://cdn.example.com/legit.mp3"));
  assert("ALLOW public https PLAY forwarded", true);

  send("PLAY", { url: "http://ice1.somafm.com:8000/groovesalad" });
  await master.waitFor(cmdUrl("PLAY", "http://ice1.somafm.com:8000/groovesalad"));
  assert("ALLOW HTTP radio PLAY forwarded", true);

  send("PLAY_SOURCE", { source: { id: "yt1", type: "youtube", url: "https://www.youtube.com/watch?v=abc" } });
  await master.waitFor(cmdUrl("PLAY_SOURCE", "https://www.youtube.com/watch?v=abc"));
  assert("ALLOW YouTube PLAY_SOURCE forwarded", true);

  send("QUEUE_NEXT", { source: { id: "sc1", type: "soundcloud", url: "https://soundcloud.com/a/b" } });
  await master.waitFor(cmdUrl("QUEUE_NEXT", "https://soundcloud.com/a/b"));
  assert("ALLOW SoundCloud QUEUE_NEXT forwarded", true);

  // JINGLES (Critical Business Function) — relative + absolute interrupt URLs must forward.
  send("PLAY_INTERRUPT", { url: "/api/jingles/audio/91361cb7", preRoll: true, bellStyle: "ding" });
  await master.waitFor(cmdUrl("PLAY_INTERRUPT", "/api/jingles/audio/91361cb7"));
  assert("ALLOW relative JINGLE PLAY_INTERRUPT forwarded (jingles not blocked)", true);
  send("PLAY_INTERRUPT", { url: "https://cdn.example.com/announcement.mp3" });
  await master.waitFor(cmdUrl("PLAY_INTERRUPT", "https://cdn.example.com/announcement.mp3"));
  assert("ALLOW absolute https JINGLE PLAY_INTERRUPT forwarded", true);

  // LOCAL PLAY_SOURCE (type local, no url) — metadata-only, must forward (not treated as a forbidden target).
  send("PLAY_SOURCE", { source: { id: "loc1", type: "local", title: "Local Song" } });
  await master.waitFor((m) => m.type === "COMMAND" && (m as { command?: string }).command === "PLAY_SOURCE" && ((m as { payload?: { source?: { id?: string } } }).payload?.source?.id === "loc1"));
  assert("ALLOW LOCAL PLAY_SOURCE (no url) forwarded", true);

  // Non-URL commands untouched.
  send("PAUSE", {});
  await master.waitFor(cmd("PAUSE"));
  assert("ALLOW non-URL command (PAUSE) forwarded untouched", true);

  // BLOCK — forbidden targets never reach the MASTER; controller gets an ERROR.
  const n0 = master.buf.length;
  send("PLAY", { url: "http://169.254.169.254/latest/meta-data" });
  send("PLAY", { url: "http://10.0.0.5/internal" });
  send("PLAY_SOURCE", { source: { id: "bad1", type: "source", url: "http://192.168.1.50/a.mp3" } });
  send("PLAY_INTERRUPT", { url: "file:///C:/secret.mp3" });
  send("PLAY_INTERRUPT", { url: "http://[::1]:9222/json" });
  send("QUEUE_NEXT", { source: { id: "bad2", type: "source", url: "\\\\fileserver\\share\\x.mp3" } });
  send("PLAY_INTERRUPT", { url: "/internal/secret" }); // relative path OUTSIDE /api/ → forbidden (approved routes only)
  await sleep(400);
  assert("BLOCK no forbidden COMMAND reached the MASTER", master.buf.length === n0, `${master.buf.length - n0} leaked`);
  assert("BLOCK controller received 'Media target not allowed' errors", ctrl.count(errContains("Media target not allowed")) >= 7, String(ctrl.count(errContains("Media target not allowed"))));

  // REPLAY — the same jingle sent twice is forwarded twice (idempotent, never blocked on replay).
  const jN = master.count(cmd("PLAY_INTERRUPT"));
  send("PLAY_INTERRUPT", { url: "/api/jingles/audio/replay-x" });
  send("PLAY_INTERRUPT", { url: "/api/jingles/audio/replay-x" });
  await sleep(300);
  assert("REPLAY jingle forwarded twice", master.count(cmd("PLAY_INTERRUPT")) === jN + 2, String(master.count(cmd("PLAY_INTERRUPT")) - jN));

  // RECONNECT — MASTER drops and re-registers; a jingle still forwards to the reconnected MASTER.
  master.close();
  await sleep(200);
  const master2 = await mkClient();
  await regDevice(master2, mintToken("u1", "ws-1", ["branch-A"]), "s1-master", "branch-A");
  await master2.waitFor((m) => m.type === "SET_DEVICE_MODE" && (m as { mode?: string }).mode === "MASTER");
  await sleep(150);
  send("PLAY_INTERRUPT", { url: "/api/jingles/audio/after-reconnect" });
  await master2.waitFor(cmdUrl("PLAY_INTERRUPT", "/api/jingles/audio/after-reconnect"));
  assert("RECONNECT jingle forwarded to reconnected MASTER", true);
  send("PLAY", { url: "http://10.0.0.9/x" });
  await sleep(250);
  assert("RECONNECT forbidden still blocked after reconnect", !master2.got(cmdUrl("PLAY", "http://10.0.0.9/x")));

  // SECOND room (ws-2 / branch-A — different workspace): policy applies per room, isolation preserved.
  const master3 = await mkClient();
  await regDevice(master3, mintToken("u2", "ws-2", ["branch-A"]), "s2-master", "branch-A");
  await master3.waitFor((m) => m.type === "SET_DEVICE_MODE" && (m as { mode?: string }).mode === "MASTER");
  const ctrl2 = await mkClient();
  await regController(ctrl2, mintToken("u2", "ws-2", ["branch-A"]), "branch-A");
  await ctrl2.waitFor(isType("DEVICE_LIST"));
  ctrl2.send({ type: "COMMAND", command: "PLAY_INTERRUPT", payload: { url: "/api/jingles/audio/room2" } });
  await master3.waitFor(cmdUrl("PLAY_INTERRUPT", "/api/jingles/audio/room2"));
  assert("MULTI-ROOM jingle delivered in second room", true);
  assert("MULTI-ROOM second room unaffected by room-1 blocks", !master3.got(cmdUrl("PLAY", "http://10.0.0.5/internal")));

  ctrl.close(); master2.close(); master3.close(); ctrl2.close();

  // ── STATIC wiring ─────────────────────────────────────────────────────────────────────────────────────────
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const idx = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "index.ts"), "utf-8").replace(/\r\n/g, "\n");
  assert("WIRE import of policy present", /import \{ isForbiddenMediaTarget \} from "\.\/remote-media-url-policy\.js"/.test(idx));
  assert("WIRE COMMAND handler rejects forbidden target before forward",
    /commandHasForbiddenMediaTarget\(msg\.command, msg\.payload\)/.test(idx) && /Media target not allowed/.test(idx));
  assert("WIRE guest SUBMIT rejects forbidden url", /isForbiddenMediaTarget\(sourceUrl\)/.test(idx) && /URL not allowed/.test(idx));
  assert("WIRE guest APPROVE guards the forwarded PLAY_SOURCE", /!isForbiddenMediaTarget\(rec\.sourceUrl\)/.test(idx));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(process.exitCode ?? 0);
}
void main();
