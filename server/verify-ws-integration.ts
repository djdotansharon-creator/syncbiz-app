/**
 * PR-0 — real process-level WS integration smoke test.
 *
 * Boots the actual WS server (server/index.ts) on an ephemeral local port with a test secret + temp lease dir,
 * mints signed tokens in-process (same shape as lib/auth-ws-token), and drives real WebSocket clients to prove
 * the workspace-scoped room wiring end-to-end. No external network, no Prisma, no DB.
 *
 * Run: npx tsx server/verify-ws-integration.ts
 */
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";

// ── Environment MUST be set before importing the server (it reads these at module load) ──────────────────────
const TEST_SECRET = "test-ws-secret-integration-0123456789";
const PORT = 39000 + Math.floor(Math.random() * 2000);
const leaseDir = mkdtempSync(path.join(os.tmpdir(), "vono-wsint-"));
process.env.SYNCBIZ_WS_SECRET = TEST_SECRET;
process.env.WS_SECRET = TEST_SECRET;
process.env.PORT = String(PORT);
process.env.RAILWAY_VOLUME_MOUNT_PATH = leaseDir; // isolate the master-lease file
process.env.NODE_ENV = "test";
const URL = `ws://127.0.0.1:${PORT}`;

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Mint a ws_register token with the exact signed shape the server verifies. */
function mintToken(userId: string, opts: { workspaceId?: string; authorizedBranches?: string[] | null } = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = { purpose: "ws_register", userId, iat: now, exp: now + 60 };
  if (opts.workspaceId !== undefined) payload.workspaceId = opts.workspaceId;
  if (opts.authorizedBranches !== undefined && opts.authorizedBranches !== null) payload.authorizedBranches = opts.authorizedBranches;
  const b64 = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  const sig = createHmac("sha256", TEST_SECRET).update(b64).digest("base64url");
  return `${b64}.${sig}`;
}

type Msg = Record<string, unknown>;
type Client = {
  ws: WebSocket;
  buf: Msg[];
  send: (o: unknown) => void;
  waitFor: (pred: (m: Msg) => boolean, ms?: number) => Promise<Msg>;
  got: (pred: (m: Msg) => boolean) => boolean;
  close: () => void;
};
function mkClient(): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const buf: Msg[] = [];
    const waiters: { pred: (m: Msg) => boolean; resolve: (m: Msg) => void }[] = [];
    ws.on("message", (data) => {
      let m: Msg;
      try { m = JSON.parse(data.toString()) as Msg; } catch { return; }
      buf.push(m);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].pred(m)) { waiters[i].resolve(m); waiters.splice(i, 1); }
      }
    });
    ws.on("open", () =>
      resolve({
        ws,
        buf,
        send: (o) => ws.send(JSON.stringify(o)),
        waitFor: (pred, ms = 2500) =>
          new Promise<Msg>((res, rej) => {
            const hit = buf.find(pred);
            if (hit) return res(hit);
            const w = { pred, resolve: res };
            waiters.push(w);
            setTimeout(() => {
              const idx = waiters.indexOf(w);
              if (idx >= 0) { waiters.splice(idx, 1); rej(new Error("timeout waiting for message")); }
            }, ms);
          }),
        got: (pred) => buf.some(pred),
        close: () => ws.close(),
      }),
    );
    ws.on("error", reject);
  });
}
const isType = (t: string) => (m: Msg) => m.type === t;

async function registerDevice(c: Client, token: string, deviceId: string, branchId: string, purpose = "branch_desktop_station") {
  c.send({
    type: "REGISTER", role: "device", authToken: token, deviceId, branchId, isMobile: false,
    registrationIntent: { schemaVersion: 1, runtimeMode: "branch_playback", devicePurpose: purpose },
  });
  await c.waitFor(isType("REGISTERED"));
}
async function registerController(c: Client, token: string, branchId: string) {
  c.send({ type: "REGISTER", role: "controller", authToken: token, branchId });
  await c.waitFor(isType("REGISTERED"));
}
async function registerOwner(c: Client, token: string) {
  c.send({ type: "REGISTER", role: "owner_global", authToken: token });
  await c.waitFor(isType("REGISTERED"));
}
const deviceListHas = (deviceId: string) => (m: Msg) =>
  m.type === "DEVICE_LIST" && Array.isArray((m as { devices?: { id: string }[] }).devices) &&
  (m as { devices: { id: string }[] }).devices.some((d) => d.id === deviceId);
const stateFor = (deviceId: string) => (m: Msg) => m.type === "STATE_UPDATE" && (m as { deviceId?: string }).deviceId === deviceId;
const playing = { status: "playing", position: 1, duration: 0, currentSource: null };

async function main(): Promise<void> {
  // Wait for the server to be listening.
  const { default: _server } = await import("./index.js").then((m) => ({ default: m })).catch(() => ({ default: null }));
  void _server;
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    try { const c = await mkClient(); c.close(); ready = true; } catch { await sleep(100); }
  }
  assert("WS server booted and accepts connections", ready);
  if (!ready) { finish(); return; }

  // ── 1. SAME WORKSPACE + SAME BRANCH, TWO DIFFERENT USERS ────────────────────────────────────────────────
  {
    const devA = await mkClient();
    await registerDevice(devA, mintToken("userA", { workspaceId: "ws-1", authorizedBranches: ["branch-A"] }), "s1-devA", "branch-A");
    const modeA = await devA.waitFor(isType("SET_DEVICE_MODE"));
    assert("1. device A becomes MASTER in its room", (modeA as { mode?: string }).mode === "MASTER");

    const ctrlB = await mkClient();
    await registerController(ctrlB, mintToken("userB", { workspaceId: "ws-1", authorizedBranches: ["branch-A"] }), "branch-A");
    const dl = await ctrlB.waitFor(deviceListHas("s1-devA"));
    assert("1. controller B (different user) sees device A in DEVICE_LIST (shared room)", true);
    assert("1. controller B observes the same MASTER namespace", (dl as { masterDeviceId?: string }).masterDeviceId === "s1-devA");

    devA.send({ type: "STATE_UPDATE", state: playing });
    await ctrlB.waitFor(stateFor("s1-devA"));
    assert("1. device A STATE_UPDATE reaches controller B", true);
    devA.close(); ctrlB.close();
  }

  // ── 2. CROSS-WORKSPACE ISOLATION ─────────────────────────────────────────────────────────────────────────
  {
    const devWs2 = await mkClient();
    await registerDevice(devWs2, mintToken("userX", { workspaceId: "ws-2", authorizedBranches: ["branch-A"] }), "s2-devWs2", "branch-A");
    await devWs2.waitFor(isType("SET_DEVICE_MODE"));

    const ctrlWs1 = await mkClient();
    await registerController(ctrlWs1, mintToken("userY", { workspaceId: "ws-1", authorizedBranches: ["branch-A"] }), "branch-A");
    const dl = await ctrlWs1.waitFor(isType("DEVICE_LIST"));
    assert("2. ws-1 controller does NOT see ws-2 device", !ctrlWs1.got(deviceListHas("s2-devWs2")));
    assert("2. ws-1 controller has no MASTER (empty room)", (dl as { masterDeviceId?: string | null }).masterDeviceId == null);

    devWs2.send({ type: "STATE_UPDATE", state: playing });
    await sleep(400);
    assert("2. ws-2 STATE_UPDATE does NOT cross into ws-1 controller", !ctrlWs1.got(stateFor("s2-devWs2")));

    // COMMAND with a targetDeviceId pointing at the ws-2 MASTER must NOT be delivered.
    ctrlWs1.send({ type: "COMMAND", command: "PLAY", payload: {}, targetDeviceId: "s2-devWs2" });
    await sleep(400);
    assert("2. cross-workspace COMMAND (targetDeviceId) not delivered to ws-2 device", !devWs2.got(isType("COMMAND")));
    assert("2. ws-1 controller gets 'No MASTER device'", ctrlWs1.got((m) => m.type === "ERROR" && String((m as { message?: string }).message).includes("No MASTER")));
    devWs2.close(); ctrlWs1.close();
  }

  // ── 3. SAME WORKSPACE, DIFFERENT BRANCH — targetDeviceId cannot cross branch ──────────────────────────────
  {
    const devB = await mkClient();
    await registerDevice(devB, mintToken("userM", { workspaceId: "ws-3", authorizedBranches: ["branch-B"] }), "s3-devB", "branch-B");
    await devB.waitFor(isType("SET_DEVICE_MODE"));

    const ctrlA = await mkClient();
    await registerController(ctrlA, mintToken("userN", { workspaceId: "ws-3", authorizedBranches: ["branch-A"] }), "branch-A");
    await ctrlA.waitFor(isType("DEVICE_LIST"));
    ctrlA.send({ type: "COMMAND", command: "PLAY", payload: {}, targetDeviceId: "s3-devB" });
    await sleep(400);
    assert("3. same-workspace cross-branch COMMAND not delivered", !devB.got(isType("COMMAND")));
    assert("3. controller-A gets 'No MASTER device'", ctrlA.got((m) => m.type === "ERROR" && String((m as { message?: string }).message).includes("No MASTER")));
    devB.close(); ctrlA.close();
  }

  // ── 4. OWNER AUTHORIZATION ───────────────────────────────────────────────────────────────────────────────
  {
    const devA = await mkClient();
    await registerDevice(devA, mintToken("uA", { workspaceId: "ws-4", authorizedBranches: ["branch-A"] }), "s4-devA", "branch-A");
    await devA.waitFor(isType("SET_DEVICE_MODE"));
    devA.send({ type: "STATE_UPDATE", state: playing });
    const devB = await mkClient();
    await registerDevice(devB, mintToken("uB", { workspaceId: "ws-4", authorizedBranches: ["branch-B"] }), "s4-devB", "branch-B");
    await devB.waitFor(isType("SET_DEVICE_MODE"));

    const owner = await mkClient();
    await registerOwner(owner, mintToken("uOwner", { workspaceId: "ws-4", authorizedBranches: ["branch-A"] }));
    const bl = await owner.waitFor(isType("BRANCH_LIST"));
    const branchIds = ((bl as { branches?: { branchId: string }[] }).branches ?? []).map((b) => b.branchId);
    assert("4. BRANCH_LIST includes authorized branch-A", branchIds.includes("branch-A"), branchIds.join(","));
    assert("4. BRANCH_LIST EXCLUDES unauthorized branch-B", !branchIds.includes("branch-B"), branchIds.join(","));

    devA.send({ type: "STATE_UPDATE", state: playing });
    await owner.waitFor(stateFor("s4-devA"));
    assert("4. branch-A STATE_UPDATE reaches owner", true);
    devB.send({ type: "STATE_UPDATE", state: playing });
    await sleep(400);
    assert("4. branch-B STATE_UPDATE does NOT reach owner (unauthorized)", !owner.got(stateFor("s4-devB")));
    devA.close(); devB.close(); owner.close();
  }

  // ── 5. LEGACY TOKEN (no workspaceId) → legacy room, does not join a workspace room ────────────────────────
  {
    const devLegacy = await mkClient();
    await registerDevice(devLegacy, mintToken("userLegacy", { authorizedBranches: ["default"] }), "s5-devLegacy", "default");
    await devLegacy.waitFor(isType("SET_DEVICE_MODE"));
    assert("5. legacy token (no workspaceId) registers successfully", true);

    // A workspace controller in ws:default must NOT see the legacy device (different room).
    const wsCtrl = await mkClient();
    await registerController(wsCtrl, mintToken("userWs", { workspaceId: "ws-5", authorizedBranches: ["default"] }), "default");
    await wsCtrl.waitFor(isType("DEVICE_LIST"));
    await sleep(200);
    assert("5. workspace controller does NOT see the legacy device (separate room)", !wsCtrl.got(deviceListHas("s5-devLegacy")));
    devLegacy.close(); wsCtrl.close();
  }

  finish();
}

function finish(): void {
  try { rmSync(leaseDir, { recursive: true, force: true }); } catch { /* ignore */ }
  console.log(`\n${pass} passed, ${fail} failed`);
  // The server keeps the event loop alive (listen + heartbeat interval) — exit explicitly.
  process.exit(fail > 0 ? 1 : 0);
}

void main();
