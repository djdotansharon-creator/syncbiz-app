/**
 * Web (browser) MASTER reload window — real process-level WS test (owner 2026-10-23, browser tab identity).
 *
 * Browsers close the socket with 1001 on a page RELOAD exactly as on a tab close. With one deviceId per tab, a web
 * MASTER's reload must NOT hand MASTER to another tab: its lease stays reserved for WEB_RELOAD_RECLAIM_MS; the same
 * deviceId reclaims it; other web devices are CONTROL meanwhile; only when it does not return is a CONTROL promoted.
 *
 * Boots the actual WS server on an ephemeral port (window shortened to 1500 ms), drives real WebSocket clients.
 * No DB, no network. Run: npx tsx server/verify-web-reload-window.ts
 */
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";

const TEST_SECRET = "test-ws-secret-reload-window-0123456789";
const PORT = 41000 + Math.floor(Math.random() * 2000);
const WINDOW_MS = 1500;
const leaseDir = mkdtempSync(path.join(os.tmpdir(), "vono-reload-"));
process.env.SYNCBIZ_WS_SECRET = TEST_SECRET;
process.env.WS_SECRET = TEST_SECRET;
process.env.PORT = String(PORT);
process.env.RAILWAY_VOLUME_MOUNT_PATH = leaseDir;
process.env.WEB_RELOAD_RECLAIM_MS = String(WINDOW_MS);
process.env.NODE_ENV = "test";
const URL = `ws://127.0.0.1:${PORT}`;

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function mintToken(userId: string, workspaceId: string, branch: string): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = { purpose: "ws_register", userId, iat: now, exp: now + 60, workspaceId, authorizedBranches: [branch] };
  const b64 = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  const sig = createHmac("sha256", TEST_SECRET).update(b64).digest("base64url");
  return `${b64}.${sig}`;
}

type Msg = Record<string, unknown>;
type Client = { ws: WebSocket; buf: Msg[]; send: (o: unknown) => void; waitFor: (p: (m: Msg) => boolean, ms?: number) => Promise<Msg | null> };
function mkClient(): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const buf: Msg[] = [];
    const waiters: { pred: (m: Msg) => boolean; resolve: (m: Msg) => void }[] = [];
    ws.on("message", (data) => {
      let m: Msg;
      try { m = JSON.parse(data.toString()) as Msg; } catch { return; }
      buf.push(m);
      for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i].pred(m)) { waiters[i].resolve(m); waiters.splice(i, 1); }
    });
    ws.on("open", () => resolve({
      ws, buf,
      send: (o) => ws.send(JSON.stringify(o)),
      // resolves null on timeout (lets a test assert "did NOT happen")
      waitFor: (pred, ms = 2500) => new Promise<Msg | null>((res) => {
        const hit = buf.find(pred);
        if (hit) return res(hit);
        const w = { pred, resolve: res };
        waiters.push(w);
        setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); res(null); } }, ms);
      }),
    }));
    ws.on("error", reject);
  });
}
const modeIs = (mode: string) => (m: Msg) => m.type === "SET_DEVICE_MODE" && m.mode === mode;

async function webDevice(ws: string, branch: string, deviceId: string, user = "u1"): Promise<{ c: Client; mode: string }> {
  const c = await mkClient();
  c.send({
    type: "REGISTER", role: "device", authToken: mintToken(user, ws, branch), deviceId, branchId: branch, isMobile: false,
    registrationIntent: { schemaVersion: 1, runtimeMode: "branch_playback", devicePurpose: "branch_web_station" },
  });
  const m = await c.waitFor((x) => x.type === "SET_DEVICE_MODE");
  return { c, mode: String(m?.mode ?? "none") };
}
const close1001 = (c: Client) => c.ws.close(1001, "going away");

async function main(): Promise<void> {
  await import("./index.js");
  let ready = false;
  for (let i = 0; i < 50 && !ready; i++) {
    try { const c = await mkClient(); c.ws.close(); ready = true; } catch { await sleep(100); }
  }
  assert("WS server booted", ready);
  if (!ready) return finish();

  // ── W0: two web tabs with DIFFERENT ids in one room → exactly one MASTER ──
  {
    const a = await webDevice("ws-w0", "b", "w0-A");
    const b = await webDevice("ws-w0", "b", "w0-B");
    assert("W0 first web tab → MASTER", a.mode === "MASTER");
    assert("W0 second web tab (own id) → CONTROL (no two MASTERs)", b.mode === "CONTROL");
    a.c.ws.close(); b.c.ws.close();
    await sleep(WINDOW_MS + 500);
  }

  // ── W1 (owner regression): MASTER reloads while another tab is open → MASTER stays with the reloading tab ──
  {
    const a = await webDevice("ws-w1", "b", "w1-A");
    const b = await webDevice("ws-w1", "b", "w1-B");
    close1001(a.c); // page reload (browser sends 1001)
    const early = await b.c.waitFor(modeIs("MASTER"), 400);
    assert("W1 during the reload the open CONTROL tab is NOT promoted", early === null);
    const a2 = await webDevice("ws-w1", "b", "w1-A"); // same tab, same id, back after reload
    assert("W1 the reloaded tab reclaims MASTER", a2.mode === "MASTER");
    const late = await b.c.waitFor(modeIs("MASTER"), WINDOW_MS + 800);
    assert("W1 after the window the other tab is still CONTROL (no silent MASTER switch)", late === null);
    // jingle path: a command from the CONTROL tab reaches the real MASTER
    b.c.send({ type: "COMMAND", targetDeviceId: "w1-A", command: "PLAY_INTERRUPT", payload: { url: "/api/jingles/audio/x" } });
    const cmd = await a2.c.waitFor((m) => m.type === "COMMAND" && m.command === "PLAY_INTERRUPT", 1500);
    assert("W1 a PLAY_INTERRUPT from the CONTROL tab reaches the MASTER tab", cmd !== null);
    a2.c.ws.close(); b.c.ws.close();
    await sleep(WINDOW_MS + 500);
  }

  // ── W2 (owner regression): MASTER reloads and a NEW tab opens in that gap → new tab is CONTROL, MASTER returns ──
  {
    const a = await webDevice("ws-w2", "b", "w2-A");
    close1001(a.c);
    await sleep(50);
    const n = await webDevice("ws-w2", "b", "w2-NEW");
    assert("W2 a new tab opening during the MASTER's reload gets CONTROL", n.mode === "CONTROL");
    const a2 = await webDevice("ws-w2", "b", "w2-A");
    assert("W2 the reloaded tab reclaims MASTER", a2.mode === "MASTER");
    const late = await n.c.waitFor(modeIs("MASTER"), WINDOW_MS + 800);
    assert("W2 the new tab never becomes MASTER", late === null);
    a2.c.ws.close(); n.c.ws.close();
    await sleep(WINDOW_MS + 500);
  }

  // ── W3: MASTER tab really closed (no return) → the CONTROL tab is promoted when the window ends ──
  {
    const a = await webDevice("ws-w3", "b", "w3-A");
    const b = await webDevice("ws-w3", "b", "w3-B");
    const t0 = Date.now();
    close1001(a.c);
    const promoted = await b.c.waitFor(modeIs("MASTER"), WINDOW_MS + 2000);
    const after = Date.now() - t0;
    assert("W3 MASTER tab closed for good → CONTROL promoted", promoted !== null, `${after} ms`);
    assert("W3 … only after the reload window (not instantly)", after >= WINDOW_MS - 50, `${after} ms ≥ ${WINDOW_MS}`);
    b.c.ws.close();
    await sleep(WINDOW_MS + 500);
  }

  // ── W4: window expired with nobody waiting → the next tab simply becomes MASTER ──
  {
    const a = await webDevice("ws-w4", "b", "w4-A");
    close1001(a.c);
    await sleep(WINDOW_MS + 600);
    const c = await webDevice("ws-w4", "b", "w4-C");
    assert("W4 after the window a new tab becomes MASTER (lease released)", c.mode === "MASTER");
    c.c.ws.close();
    await sleep(WINDOW_MS + 500);
  }

  // ── W5: network drop (1006, ambiguous) keeps the existing 90 s grace behaviour — unchanged by this PR ──
  {
    const a = await webDevice("ws-w5", "b", "w5-A");
    const b = await webDevice("ws-w5", "b", "w5-B");
    a.c.ws.terminate(); // abnormal close → 1006
    const promoted = await b.c.waitFor(modeIs("MASTER"), WINDOW_MS + 800);
    assert("W5 network drop: CONTROL not promoted within the short window (90 s grace unchanged)", promoted === null);
    const a2 = await webDevice("ws-w5", "b", "w5-A");
    assert("W5 network drop: the same device reclaims MASTER", a2.mode === "MASTER");
    a2.c.ws.close(); b.c.ws.close();
  }

  finish();
}

function finish(): void {
  try { rmSync(leaseDir, { recursive: true, force: true }); } catch { /* ignore */ }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

void main();
