/**
 * CONTROL ROOM broadcast — real process-level WS integration test (owner-approved 2026-10-09).
 *
 * Boots the actual WS server (ephemeral port, test secret, temp lease dir) and drives real WebSocket clients:
 *  - an owner COMMAND carrying `requestId` gets COMMAND_DELIVERY {delivered:true} when the branch's designated station is
 *    connected (and the station really receives the command), {delivered:false, reason:"no_station"} when it is not —
 *    WITHOUT closing the owner socket (one unavailable branch never stops the others), and
 *    {delivered:false, reason:"not_authorized"} for a branch outside the token claim;
 *  - without `requestId` the legacy behaviour is unchanged (ERROR "No MASTER device");
 *  - BRANCH_LIST carries the info-only Control Room fields (deviceType, canonicalBranchId, devices[]).
 *
 * Run: npx tsx server/verify-control-room-broadcast.ts
 */
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";

const TEST_SECRET = "test-ws-secret-control-room-0123456789";
const PORT = 43000 + Math.floor(Math.random() * 2000);
const leaseDir = mkdtempSync(path.join(os.tmpdir(), "vono-cr-"));
process.env.SYNCBIZ_WS_SECRET = TEST_SECRET;
process.env.WS_SECRET = TEST_SECRET;
process.env.PORT = String(PORT);
process.env.RAILWAY_VOLUME_MOUNT_PATH = leaseDir;
process.env.NODE_ENV = "test";
const URL = `ws://127.0.0.1:${PORT}`;

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function mintToken(userId: string, opts: { workspaceId?: string; authorizedBranches?: string[]; stationDeviceId?: string; designatedMasterByBranch?: Record<string, string> } = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = { purpose: "ws_register", userId, iat: now, exp: now + 60 };
  if (opts.workspaceId !== undefined) payload.workspaceId = opts.workspaceId;
  if (opts.authorizedBranches) payload.authorizedBranches = opts.authorizedBranches;
  if (opts.stationDeviceId) payload.stationDeviceId = opts.stationDeviceId;
  if (opts.designatedMasterByBranch) payload.designatedMasterByBranch = opts.designatedMasterByBranch;
  const b64 = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  const sig = createHmac("sha256", TEST_SECRET).update(b64).digest("base64url");
  return `${b64}.${sig}`;
}

type Msg = Record<string, unknown>;
type Client = { ws: WebSocket; buf: Msg[]; send: (o: unknown) => void; waitFor: (pred: (m: Msg) => boolean, ms?: number) => Promise<Msg>; closed: () => boolean; close: () => void };
function mkClient(): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const buf: Msg[] = [];
    let isClosed = false;
    const waiters: { pred: (m: Msg) => boolean; resolve: (m: Msg) => void }[] = [];
    ws.on("message", (data) => {
      let m: Msg; try { m = JSON.parse(data.toString()) as Msg; } catch { return; }
      buf.push(m);
      for (let i = waiters.length - 1; i >= 0; i--) { if (waiters[i].pred(m)) { waiters[i].resolve(m); waiters.splice(i, 1); } }
    });
    ws.on("close", () => { isClosed = true; });
    ws.on("open", () => resolve({
      ws, buf, send: (o) => ws.send(JSON.stringify(o)),
      waitFor: (pred, ms = 2500) => new Promise<Msg>((res, rej) => {
        const hit = buf.find(pred); if (hit) return res(hit);
        const w = { pred, resolve: res }; waiters.push(w);
        setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); rej(new Error("timeout")); } }, ms);
      }),
      closed: () => isClosed,
      close: () => ws.close(),
    }));
    ws.on("error", reject);
  });
}
const isType = (t: string) => (m: Msg) => m.type === t;
const ackFor = (id: string) => (m: Msg) => m.type === "COMMAND_DELIVERY" && m.requestId === id;

async function main(): Promise<void> {
  await import("./index.js").catch(() => null);
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) { try { const c = await mkClient(); c.close(); ready = true; } catch { await sleep(100); } }
  assert("WS server booted", ready);
  if (!ready) return finish();

  const WS = "ws-cr1", A = "branch-a", B = "branch-b", MAIN = "dsk-cr-main";
  const desig = { [A]: MAIN };
  // designated station in branch A
  const station = await mkClient();
  station.send({
    type: "REGISTER", role: "device", authToken: mintToken("u1", { workspaceId: WS, authorizedBranches: [A], stationDeviceId: MAIN, designatedMasterByBranch: desig }),
    deviceId: MAIN, branchId: A, isMobile: false,
    // the exact intent the desktop MAIN sends (desktop/src/shared/syncbiz-registration-intent.ts)
    registrationIntent: { platform: "desktop", runtimeMode: "branch_playback", devicePurpose: "branch_desktop_station", leaseRoleHint: "none", contentScope: "branch" },
  });
  await station.waitFor(isType("REGISTERED"));
  const mode = await station.waitFor(isType("SET_DEVICE_MODE"));
  assert("station in branch A is MASTER", (mode as { mode?: string }).mode === "MASTER");

  // a phone controlling branch A
  const phone = await mkClient();
  phone.send({ type: "REGISTER", role: "device", authToken: mintToken("u1", { workspaceId: WS, authorizedBranches: [A] }), deviceId: "phone-1", branchId: A, isMobile: true });
  await phone.waitFor(isType("REGISTERED"));

  // the Control Room (owner_global) — authorised for A and B
  const owner = await mkClient();
  owner.send({ type: "REGISTER", role: "owner_global", authToken: mintToken("u1", { workspaceId: WS, authorizedBranches: [A, B] }) });
  await owner.waitFor(isType("REGISTERED"));
  owner.send({ type: "BRANCH_LIST_REQUEST" });
  await sleep(200);
  const bl = [...owner.buf].reverse().find(isType("BRANCH_LIST")) as { branches?: Array<Record<string, unknown>> } | undefined;
  const a = bl?.branches?.find((b) => b.branchId === A) as { deviceType?: string; canonicalBranchId?: string; devices?: Array<{ role: string; type: string }> } | undefined;
  assert("BRANCH_LIST: branch A deviceType = computer", a?.deviceType === "computer", String(a?.deviceType));
  assert("BRANCH_LIST: branch A canonicalBranchId present", a?.canonicalBranchId === A, String(a?.canonicalBranchId));
  assert("BRANCH_LIST: devices = playing computer + control phone/tablet",
    !!a?.devices && a.devices.some((d) => d.role === "playing" && d.type === "computer") && a.devices.some((d) => d.role === "control" && d.type === "phone_tablet"),
    JSON.stringify(a?.devices));

  // 1. delivered to the station
  owner.send({ type: "COMMAND", requestId: "r1", targetBranchId: A, command: "PLAY_INTERRUPT", payload: { url: "/api/jingles/audio/00000000-0000-0000-0000-000000000001" } });
  const ack1 = await owner.waitFor(ackFor("r1"));
  assert("1. branch with a connected station → COMMAND_DELIVERY delivered:true", ack1.delivered === true && ack1.targetBranchId === A);
  const got = await station.waitFor((m) => m.type === "COMMAND" && m.command === "PLAY_INTERRUPT");
  assert("1. … and the station really receives PLAY_INTERRUPT", !!got);

  // 2. branch without a station → not delivered, owner socket stays open
  owner.send({ type: "COMMAND", requestId: "r2", targetBranchId: B, command: "PLAY_INTERRUPT", payload: { url: "/api/jingles/audio/x" } });
  const ack2 = await owner.waitFor(ackFor("r2"));
  assert("2. branch without a station → delivered:false (no_station)", ack2.delivered === false && ack2.reason === "no_station");
  await sleep(150);
  assert("2. … the Control Room socket is NOT closed", !owner.closed() && !owner.buf.some(isType("ERROR")));

  // 3. after a failure, the next branch still works (one unavailable branch never stops the others)
  owner.send({ type: "COMMAND", requestId: "r3", targetBranchId: A, command: "PLAY_INTERRUPT", payload: { url: "/api/jingles/audio/y" } });
  const ack3 = await owner.waitFor(ackFor("r3"));
  assert("3. next branch after a failed one → delivered:true", ack3.delivered === true);

  // 4. branch outside the token claim
  owner.send({ type: "COMMAND", requestId: "r4", targetBranchId: "branch-x", command: "PLAY_INTERRUPT", payload: { url: "/api/jingles/audio/z" } });
  const ack4 = await owner.waitFor(ackFor("r4"));
  assert("4. unauthorised branch → delivered:false (not_authorized), socket open", ack4.delivered === false && ack4.reason === "not_authorized" && !owner.closed());

  // 5. legacy behaviour unchanged without requestId
  owner.send({ type: "COMMAND", targetBranchId: B, command: "PAUSE" });
  const err = await owner.waitFor(isType("ERROR")).catch(() => null);
  assert("5. without requestId → legacy ERROR 'No MASTER device' (unchanged)", (err as { message?: string } | null)?.message === "No MASTER device");
  assert("5. … and no COMMAND_DELIVERY is sent for it", owner.buf.filter(isType("COMMAND_DELIVERY")).length === 4);

  // 6. the phone (a device, not owner) never gets ACKs for its commands
  phone.send({ type: "COMMAND", requestId: "p1", command: "PAUSE" });
  await sleep(200);
  assert("6. a non-owner COMMAND with requestId gets no COMMAND_DELIVERY (owner_global only)", !phone.buf.some(isType("COMMAND_DELIVERY")));

  station.close(); phone.close(); owner.close();
  return finish();
}

function finish(): void {
  console.log(`\n${pass} passed, ${fail} failed`);
  try { rmSync(leaseDir, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(process.exitCode ?? 0);
}
main().catch((e) => { console.error(e); process.exitCode = 1; finish(); });
