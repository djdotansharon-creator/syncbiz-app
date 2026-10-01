/**
 * Pilot PERMANENT MASTER — real process-level WS integration test.
 *
 * Boots the actual WS server on an ephemeral port with a test secret + temp lease dir, mints signed tokens
 * in-process carrying the new permanent-master claims (stationDeviceId, designatedMasterByBranch), and drives
 * real WebSocket clients. The WS server learns a branch's designation purely from the signed token claim, so
 * NO DB is needed here. Each scenario uses its own workspace/branch to isolate rooms.
 *
 * Run: npx tsx server/verify-permanent-master.ts
 */
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { loadDesignations, saveDesignations } from "./branch-designation-store.js";

const TEST_SECRET = "test-ws-secret-permanent-master-0123456789";
const PORT = 41000 + Math.floor(Math.random() * 2000);
const leaseDir = mkdtempSync(path.join(os.tmpdir(), "vono-pm-"));
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

type MintOpts = {
  workspaceId?: string;
  authorizedBranches?: string[];
  stationDeviceId?: string;
  designatedMasterByBranch?: Record<string, string>;
};
function mintToken(userId: string, opts: MintOpts = {}): string {
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
type Client = {
  ws: WebSocket; buf: Msg[]; send: (o: unknown) => void;
  waitFor: (pred: (m: Msg) => boolean, ms?: number) => Promise<Msg>;
  got: (pred: (m: Msg) => boolean) => boolean; latest: (pred: (m: Msg) => boolean) => Msg | undefined; close: () => void;
};
function mkClient(): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const buf: Msg[] = [];
    const waiters: { pred: (m: Msg) => boolean; resolve: (m: Msg) => void }[] = [];
    ws.on("message", (data) => {
      let m: Msg; try { m = JSON.parse(data.toString()) as Msg; } catch { return; }
      buf.push(m);
      for (let i = waiters.length - 1; i >= 0; i--) { if (waiters[i].pred(m)) { waiters[i].resolve(m); waiters.splice(i, 1); } }
    });
    ws.on("open", () => resolve({
      ws, buf, send: (o) => ws.send(JSON.stringify(o)),
      waitFor: (pred, ms = 2500) => new Promise<Msg>((res, rej) => {
        const hit = buf.find(pred); if (hit) return res(hit);
        const w = { pred, resolve: res }; waiters.push(w);
        setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); rej(new Error("timeout")); } }, ms);
      }),
      got: (pred) => buf.some(pred),
      latest: (pred) => [...buf].reverse().find(pred),
      close: () => ws.close(),
    }));
    ws.on("error", reject);
  });
}
const isType = (t: string) => (m: Msg) => m.type === t;
const modeMsg = isType("SET_DEVICE_MODE");
const modeOf = (m: Msg | undefined) => (m as { mode?: string } | undefined)?.mode;

async function registerDevice(
  c: Client, token: string, deviceId: string, branchId: string,
  opts: { purpose?: string; embeddedRenderer?: boolean } = {},
): Promise<string | undefined> {
  c.send({
    type: "REGISTER", role: "device", authToken: token, deviceId, branchId, isMobile: false,
    embeddedRenderer: opts.embeddedRenderer === true,
    registrationIntent: { schemaVersion: 1, runtimeMode: "branch_playback", devicePurpose: opts.purpose ?? "branch_desktop_station" },
  });
  await c.waitFor(isType("REGISTERED"));
  const m = await c.waitFor(modeMsg);
  return modeOf(m);
}
async function registerController(c: Client, token: string, branchId: string) {
  c.send({ type: "REGISTER", role: "controller", authToken: token, branchId });
  await c.waitFor(isType("REGISTERED"));
}
const masterOfList = (m: Msg | undefined) => (m as { masterDeviceId?: string | null } | undefined)?.masterDeviceId ?? null;

async function main(): Promise<void> {
  await import("./index.js").catch(() => null);
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) { try { const c = await mkClient(); c.close(); ready = true; } catch { await sleep(100); } }
  assert("WS server booted", ready);
  if (!ready) return finish();

  // ── Designated branch (ws-pm1 / default), designated MAIN = dsk-main-1 ──────────────────────────────────────
  const WS1 = "ws-pm1", BR = "default", MAIN = "dsk-main-1";
  const desig = { [BR]: MAIN };
  {
    // 1. designated MAIN (token bound to it) → MASTER
    const devMain = await mkClient();
    const mode = await registerDevice(devMain, mintToken("u1", { workspaceId: WS1, authorizedBranches: [BR], stationDeviceId: MAIN, designatedMasterByBranch: desig }), MAIN, BR);
    assert("1. designated MAIN registers → MASTER", mode === "MASTER", `mode=${mode}`);

    // 2. renderer on same Electron (embeddedRenderer, no stationDeviceId) → CONTROL
    const devRnd = await mkClient();
    const rmode = await registerDevice(devRnd, mintToken("u1", { workspaceId: WS1, authorizedBranches: [BR], designatedMasterByBranch: desig }), "rnd-1", BR, { embeddedRenderer: true });
    assert("2. embedded renderer on same Electron → CONTROL", rmode === "CONTROL", `mode=${rmode}`);

    // 3. second Desktop (different durable id, bound to itself) → CONTROL
    const devSecond = await mkClient();
    const smode = await registerDevice(devSecond, mintToken("u1", { workspaceId: WS1, authorizedBranches: [BR], stationDeviceId: "dsk-2", designatedMasterByBranch: desig }), "dsk-2", BR);
    assert("3. second Desktop → CONTROL (not the designated station)", smode === "CONTROL", `mode=${smode}`);

    // 4. designated MASTER disconnects → branch has NO MASTER (no auto-failover)
    devMain.close();
    await sleep(300);
    const ctrl = await mkClient();
    await registerController(ctrl, mintToken("u1", { workspaceId: WS1, authorizedBranches: [BR] }), BR);
    const dl = await ctrl.waitFor(isType("DEVICE_LIST"));
    assert("4. designated MASTER offline → no MASTER (no failover)", masterOfList(dl) == null, `master=${masterOfList(dl)}`);

    // 5. designated MASTER reconnects → MASTER again
    const devMain2 = await mkClient();
    const mode5 = await registerDevice(devMain2, mintToken("u1", { workspaceId: WS1, authorizedBranches: [BR], stationDeviceId: MAIN, designatedMasterByBranch: desig }), MAIN, BR);
    assert("5. designated MASTER reconnects → MASTER", mode5 === "MASTER", `mode=${mode5}`);
    await sleep(200);
    const dl2 = await (await (async () => ctrl)()).waitFor((m) => m.type === "DEVICE_LIST" && masterOfList(m) === MAIN);
    assert("5. room MASTER is the designated device again", masterOfList(dl2) === MAIN);
    devRnd.close(); devSecond.close(); ctrl.close(); devMain2.close();
  }

  // 6. "server restart" — designation known ONLY from the token claim (no prior server state in a fresh room):
  //    a non-station device learns the designation (→ CONTROL), then the designated device → MASTER.
  {
    const WS6 = "ws-pm6", M6 = "dsk-main-6";
    const d6 = { [BR]: M6 };
    const other = await mkClient();
    const omode = await registerDevice(other, mintToken("u6", { workspaceId: WS6, authorizedBranches: [BR], stationDeviceId: "dsk-other-6", designatedMasterByBranch: d6 }), "dsk-other-6", BR);
    assert("6. (post-restart) non-designated device learns designation from token → CONTROL", omode === "CONTROL", `mode=${omode}`);
    const main6 = await mkClient();
    const m6mode = await registerDevice(main6, mintToken("u6", { workspaceId: WS6, authorizedBranches: [BR], stationDeviceId: M6, designatedMasterByBranch: d6 }), M6, BR);
    assert("6. designation survives via token claim → designated device MASTER", m6mode === "MASTER", `mode=${m6mode}`);
    other.close(); main6.close();
  }

  // 7. untrusted / wrong deviceId cannot claim the designation
  {
    const WS7 = "ws-pm7", M7 = "dsk-main-7";
    const d7 = { [BR]: M7 };
    // (a) deviceId matches the designation, but the token is NOT bound to the station (no stationDeviceId) → CONTROL
    const spoofA = await mkClient();
    const a = await registerDevice(spoofA, mintToken("u7", { workspaceId: WS7, authorizedBranches: [BR], designatedMasterByBranch: d7 }), M7, BR);
    assert("7a. deviceId=designated but token not bound → CONTROL", a === "CONTROL", `mode=${a}`);
    // (b) deviceId matches, token bound to a DIFFERENT station → CONTROL
    const spoofB = await mkClient();
    const b = await registerDevice(spoofB, mintToken("u7", { workspaceId: WS7, authorizedBranches: [BR], stationDeviceId: "dsk-wrong", designatedMasterByBranch: d7 }), M7, BR);
    assert("7b. deviceId=designated but token bound to another station → CONTROL", b === "CONTROL", `mode=${b}`);
    spoofA.close(); spoofB.close();
  }

  // 8. branch WITHOUT a designation preserves current behavior (normal election); embedded renderer still never elects.
  {
    const WS8 = "ws-pm8";
    const rnd = await mkClient();
    const rmode = await registerDevice(rnd, mintToken("u8", { workspaceId: WS8, authorizedBranches: [BR] }), "rnd-8", BR, { embeddedRenderer: true });
    assert("8. non-designated branch: embedded renderer → CONTROL (never elects)", rmode === "CONTROL", `mode=${rmode}`);
    const desk = await mkClient();
    const dmode = await registerDevice(desk, mintToken("u8", { workspaceId: WS8, authorizedBranches: [BR] }), "dsk-8", BR);
    assert("8. non-designated branch: real desktop → MASTER (current behavior preserved)", dmode === "MASTER", `mode=${dmode}`);
    rnd.close(); desk.close();
  }

  // ── BLOCKER 1 — SET_MASTER cannot bypass a designation ──────────────────────────────────────────────────────
  {
    const WSb1 = "ws-pm-b1", M = "dsk-b1-main", d = { [BR]: M };
    const devMain = await mkClient();
    const mm = await registerDevice(devMain, mintToken("ub1", { workspaceId: WSb1, authorizedBranches: [BR], stationDeviceId: M, designatedMasterByBranch: d }), M, BR);
    assert("B1 setup: designated MAIN → MASTER", mm === "MASTER", `mode=${mm}`);
    const devSecond = await mkClient();
    const sm = await registerDevice(devSecond, mintToken("ub1", { workspaceId: WSb1, authorizedBranches: [BR], stationDeviceId: "dsk-b1-2", designatedMasterByBranch: d }), "dsk-b1-2", BR);
    assert("B1 setup: second desktop → CONTROL", sm === "CONTROL", `mode=${sm}`);
    // Second desktop tries to grab MASTER via SET_MASTER.
    devSecond.send({ type: "SET_MASTER" });
    await sleep(400);
    const gotMaster = devSecond.got((m) => m.type === "SET_DEVICE_MODE" && (m as { mode?: string }).mode === "MASTER");
    assert("B1 second desktop SET_MASTER → NOT made MASTER", !gotMaster);
    assert("B1 second desktop SET_MASTER → rejected (ERROR)", devSecond.got((m) => m.type === "ERROR" && /permanent designated MASTER/i.test(String((m as { message?: string }).message))));
    const ctrl = await mkClient();
    await registerController(ctrl, mintToken("ub1", { workspaceId: WSb1, authorizedBranches: [BR] }), BR);
    const dl = await ctrl.waitFor(isType("DEVICE_LIST"));
    assert("B1 designated MAIN remains the only MASTER", masterOfList(dl) === M, `master=${masterOfList(dl)}`);
    devMain.close(); devSecond.close(); ctrl.close();
  }

  // ── BLOCKER 2 — designation is AUTHORITATIVE (survives restart; stale tokens never revert it) ────────────────
  async function syncDesignation(workspaceId: string, branchId: string, durableDeviceId: string | null): Promise<void> {
    const res = await fetch(`http://127.0.0.1:${PORT}/internal/branch-master-designation`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-SyncBiz-Secret": TEST_SECRET },
      body: JSON.stringify({ workspaceId, branchId, durableDeviceId }),
    });
    void (await res.text());
  }
  {
    const WSb2 = "ws-pm-b2", M = "dsk-b2-main";
    // Admin designates via the authoritative internal sync (this is exactly what a post-restart load produces).
    await syncDesignation(WSb2, BR, M);
    // 3. An OLD token (no designation claim, not bound) connects FIRST → must be CONTROL (authoritative enforced).
    const old = await mkClient();
    const om = await registerDevice(old, mintToken("ub2", { workspaceId: WSb2, authorizedBranches: [BR] }), "dsk-b2-old", BR);
    assert("B2.3 authoritative designation + OLD token (no claim) first → CONTROL", om === "CONTROL", `mode=${om}`);
    // 4. designated trusted MAIN connects → MASTER.
    const main = await mkClient();
    const m4 = await registerDevice(main, mintToken("ub2", { workspaceId: WSb2, authorizedBranches: [BR], stationDeviceId: M, designatedMasterByBranch: { [BR]: M } }), M, BR);
    assert("B2.4 designated trusted MAIN → MASTER", m4 === "MASTER", `mode=${m4}`);

    // 5. Admin REPLACES the designation (M → M2). 6. An OLD token carrying the OLD designation claim cannot restore M.
    const M2 = "dsk-b2-main2";
    await syncDesignation(WSb2, BR, M2);
    await sleep(200);
    const staleM = await mkClient();
    const sm = await registerDevice(staleM, mintToken("ub2", { workspaceId: WSb2, authorizedBranches: [BR], stationDeviceId: M, designatedMasterByBranch: { [BR]: M } }), M, BR);
    assert("B2.6 stale token (old designation=M, bound to M) after replace → CONTROL (cannot restore old MASTER)", sm === "CONTROL", `mode=${sm}`);
    const main2 = await mkClient();
    const m2mode = await registerDevice(main2, mintToken("ub2", { workspaceId: WSb2, authorizedBranches: [BR], stationDeviceId: M2, designatedMasterByBranch: { [BR]: M2 } }), M2, BR);
    assert("B2.6 new designated device M2 → MASTER", m2mode === "MASTER", `mode=${m2mode}`);
    old.close(); main.close(); staleM.close(); main2.close();
  }

  // Store round-trip proves the reload-on-startup mechanism (what the WS server does at boot).
  {
    const probe = { "ws:store-probe:default": "dsk-probe" };
    saveDesignations(probe);
    const back = loadDesignations();
    assert("store round-trip (reload-on-startup) persists designations", back["ws:store-probe:default"] === "dsk-probe");
  }

  finish();
}

function finish(): void {
  try { rmSync(leaseDir, { recursive: true, force: true }); } catch { /* ignore */ }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

void main();
