/**
 * Device enrollment on the WS server — real process-level test (docs/DEVICE_ENROLLMENT_DESIGN.md §6). A device whose SIGNED token says "REMOTE" (the manager approved it as a remote) is
 * always CONTROL: it never becomes MASTER (not first in an empty room, not when the MASTER leaves, not by SET_MASTER), yet its commands reach the real MASTER. A token with no enrollment claim
 * (today's tokens) behaves exactly as before, and so does a PLAYER claim. Boots the actual WS server on an ephemeral port; no DB, no network.
 * Run: npx tsx server/verify-enrollment-role.ts
 */
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";

const TEST_SECRET = "test-ws-secret-enrollment-role-0123456789";
const PORT = 43000 + Math.floor(Math.random() * 2000);
const WINDOW_MS = 900;
const leaseDir = mkdtempSync(path.join(os.tmpdir(), "vono-enroll-"));
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

function mintToken(userId: string, workspaceId: string, branch: string, enrollmentRole?: unknown): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = { purpose: "ws_register", userId, iat: now, exp: now + 60, workspaceId, authorizedBranches: [branch] };
  if (enrollmentRole !== undefined) payload.enrollmentRole = enrollmentRole;
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

async function webDevice(ws: string, branch: string, deviceId: string, enrollmentRole?: unknown, user = "u1"): Promise<{ c: Client; mode: string }> {
  const c = await mkClient();
  c.send({
    type: "REGISTER", role: "device", authToken: mintToken(user, ws, branch, enrollmentRole), deviceId, branchId: branch, isMobile: false,
    registrationIntent: { schemaVersion: 1, runtimeMode: "branch_playback", devicePurpose: "branch_web_station" },
  });
  const m = await c.waitFor((x) => x.type === "SET_DEVICE_MODE");
  return { c, mode: String(m?.mode ?? "none") };
}

async function main(): Promise<void> {
  await import("./index.js");
  let ready = false;
  for (let i = 0; i < 50 && !ready; i++) {
    try { const c = await mkClient(); c.ws.close(); ready = true; } catch { await sleep(100); }
  }
  assert("WS server booted", ready);
  if (!ready) return finish();

  // E0: today's tokens (no enrollment claim) are untouched — the first web device is MASTER, the second CONTROL
  {
    const a = await webDevice("ws-e0", "b", "e0-A");
    const b = await webDevice("ws-e0", "b", "e0-B");
    assert("E0 legacy token (no claim): first device → MASTER, second → CONTROL — exactly as before", a.mode === "MASTER" && b.mode === "CONTROL");
    a.c.ws.close(); b.c.ws.close();
    await sleep(WINDOW_MS + 400);
  }

  // E1: an approved REMOTE is CONTROL even when it is alone in the room, and SET_MASTER does not change that
  {
    const r = await webDevice("ws-e1", "b", "e1-R", "REMOTE");
    assert("E1 approved Remote alone in an empty room → CONTROL (never the first-come MASTER)", r.mode === "CONTROL");
    r.c.send({ type: "SET_MASTER" });
    const got = await r.c.waitFor(modeIs("MASTER"), 700);
    assert("E1 SET_MASTER from an approved Remote is ignored", got === null);
    r.c.ws.close();
    await sleep(WINDOW_MS + 400);
  }

  // E2: a PLAYER claim behaves like a legacy device (first → MASTER); a Remote beside it stays CONTROL and its command reaches the player
  {
    const p = await webDevice("ws-e2", "b", "e2-P", "PLAYER");
    const r = await webDevice("ws-e2", "b", "e2-R", "REMOTE");
    assert("E2 approved Player first → MASTER; approved Remote → CONTROL", p.mode === "MASTER" && r.mode === "CONTROL");
    r.c.send({ type: "COMMAND", targetDeviceId: "e2-P", command: "PLAY_INTERRUPT", payload: { url: "/api/jingles/audio/x" } });
    const cmd = await p.c.waitFor((m) => m.type === "COMMAND" && m.command === "PLAY_INTERRUPT", 1500);
    assert("E2 a command from the approved Remote reaches the Player", cmd !== null);
    // E3: the Player leaves → the Remote is NOT promoted, not even after the reload window and the grace
    p.c.ws.close();
    const promoted = await r.c.waitFor(modeIs("MASTER"), WINDOW_MS + 1500);
    assert("E3 when the MASTER leaves, an approved Remote is never promoted", promoted === null);
    r.c.ws.close();
    await sleep(WINDOW_MS + 400);
  }

  // E4: a second legacy device IS still promoted when the MASTER leaves (the Remote rule does not disturb the old election)
  {
    const a = await webDevice("ws-e4", "b", "e4-A");
    const rem = await webDevice("ws-e4", "b", "e4-R", "REMOTE");
    const leg = await webDevice("ws-e4", "b", "e4-L");
    assert("E4 setup: legacy MASTER, approved Remote + legacy device are CONTROL", a.mode === "MASTER" && rem.mode === "CONTROL" && leg.mode === "CONTROL");
    a.c.ws.close(1001, "going away");
    const promoted = await leg.c.waitFor(modeIs("MASTER"), WINDOW_MS + 2500);
    const remPromoted = rem.c.buf.some(modeIs("MASTER"));
    assert("E4 the legacy device is promoted, the Remote is skipped", promoted !== null && !remPromoted);
    leg.c.ws.close(); rem.c.ws.close();
    await sleep(WINDOW_MS + 400);
  }

  // E5: a made-up role in the claim is ignored (legacy behaviour), never trusted
  {
    const x = await webDevice("ws-e5", "b", "e5-X", "ADMIN");
    assert("E5 an unknown claim value is treated as no claim (first → MASTER)", x.mode === "MASTER");
    x.c.ws.close();
  }

  finish();
}

function finish(): void {
  try { rmSync(leaseDir, { recursive: true, force: true }); } catch { /* ignore */ }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

void main();
