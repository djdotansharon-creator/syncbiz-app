/**
 * CONTROL ROOM GATE 2A-3 — canonical WS room activation.
 *
 * Part A (pure): boot re-key of persisted room state + routing-branch resolution, incl. fail-safe conflicts.
 * Part B (real process): seeds a temp volume with the LEGACY TEST state (designation + lease on
 * `ws:<ws>:default`, alias default → canonical), boots the actual WS server, and proves:
 *   - persisted designation / lease re-keyed to the canonical room BEFORE any socket (same durable MASTER id)
 *   - beta.10-style MAIN registering with raw "default" → MASTER in the canonical room (trusted station)
 *   - embedded renderer with "default" → CONTROL in the same canonical room
 *   - a controller with "default" sees the same MASTER and its COMMAND reaches MAIN
 *   - a second desktop cannot become MASTER; nothing is left on the legacy room
 *   - a workspace with a re-key conflict stays on its raw room (fail safe)
 *   - an active alias cannot be changed at runtime (409); same-value re-sync is idempotent (200)
 *
 * Run: npx tsx server/verify-gate2a3-activation.ts
 */
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import type { RoomState } from "./branch-alias.js";

const TEST_SECRET = "test-ws-secret-gate2a3-activation-0123456789";
const PORT = 43000 + Math.floor(Math.random() * 2000);
const vol = mkdtempSync(path.join(os.tmpdir(), "vono-2a3-"));
process.env.SYNCBIZ_WS_SECRET = TEST_SECRET;
process.env.WS_SECRET = TEST_SECRET;
process.env.PORT = String(PORT);
process.env.RAILWAY_VOLUME_MOUNT_PATH = vol;
process.env.NODE_ENV = "test";
const URL = `ws://127.0.0.1:${PORT}`;

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const WS = "31d30e23-8f4a-4bf2-a1df-c707b69b5673";
const CANON = "90d2b7b8-7bce-4d5d-a984-5f84fa8ba0d2";
const LENOVO = "dsk-cbeb93d0-0023-47e0-aebc-b07fe350415f";
const LEG = `ws:${WS}:default`;
const CAN = `ws:${WS}:${CANON}`;
const empty = (): RoomState => ({ designations: {}, cleared: [], masterByBranch: {}, masterDisconnectedAt: {}, primaryMasterByBranch: {} });

// NOTE: branch-alias.ts resolves its data dir at import time → it is imported dynamically AFTER the env above.
async function partA(): Promise<void> {
  const { rekeyRoomStateForAliases, resolveRoutingBranch } = await import("./branch-alias.js");
// ── Part A: pure ──────────────────────────────────────────────────────────────────────────────────────────────
{
  const aliases = { [WS]: { default: CANON } };
  const st: RoomState = { ...empty(), designations: { [LEG]: LENOVO }, masterByBranch: { [LEG]: LENOVO }, primaryMasterByBranch: { [LEG]: LENOVO }, masterDisconnectedAt: { [LEG]: 123 } };
  const r = rekeyRoomStateForAliases(aliases, st);
  assert("rekey: designation moved, same durable id", r.state.designations[CAN] === LENOVO && !(LEG in r.state.designations));
  assert("rekey: lease maps moved, same values", r.state.masterByBranch[CAN] === LENOVO && r.state.primaryMasterByBranch[CAN] === LENOVO && r.state.masterDisconnectedAt[CAN] === 123 &&
    !(LEG in r.state.masterByBranch) && !(LEG in r.state.primaryMasterByBranch) && !(LEG in r.state.masterDisconnectedAt));
  assert("rekey: workspace activated, changed", r.changed && r.activeWorkspaces.includes(WS) && r.results[0].outcome === "rekeyed");
  assert("rekey: input not mutated", st.designations[LEG] === LENOVO);
  const again = rekeyRoomStateForAliases(aliases, r.state);
  assert("rekey: idempotent (already, no change, still active)", !again.changed && again.results[0].outcome === "already" && again.activeWorkspaces.includes(WS));
  const conflict = rekeyRoomStateForAliases(aliases, { ...st, designations: { [LEG]: LENOVO, [CAN]: "dsk-other" } });
  assert("rekey: canonical key occupied → FAIL SAFE (untouched, not active)",
    !conflict.changed && conflict.results[0].outcome === "conflict" && !conflict.activeWorkspaces.includes(WS) && conflict.state.designations[LEG] === LENOVO);
  const tomb = rekeyRoomStateForAliases(aliases, { ...empty(), cleared: [LEG] });
  assert("rekey: tombstone moved by same rule", tomb.changed && tomb.state.cleared.includes(CAN) && !tomb.state.cleared.includes(LEG));
  const tombConflict = rekeyRoomStateForAliases(aliases, { ...empty(), designations: { [LEG]: LENOVO }, cleared: [LEG] });
  assert("rekey: designation + tombstone on legacy key → conflict", !tombConflict.changed && tombConflict.results[0].outcome === "conflict");
  const other = rekeyRoomStateForAliases(aliases, { ...st, designations: { ...st.designations, "ws:other:default": "dsk-x" } });
  assert("rekey: other workspace (no alias) untouched", other.state.designations["ws:other:default"] === "dsk-x");
  const none = rekeyRoomStateForAliases(aliases, empty());
  assert("rekey: nothing persisted → active, no change", !none.changed && none.results[0].outcome === "nothing" && none.activeWorkspaces.includes(WS));

  const act = new Set([WS]);
  const res = (ws: string | null, raw: string, a = act) => resolveRoutingBranch({ mode: "active", workspaceId: ws, rawBranchId: raw, aliases, activeWorkspaces: a });
  assert("route: active ws, raw 'default' → canonical", res(WS, "default") === CANON && res(WS, "") === CANON);
  assert("route: canonical raw stays canonical", res(WS, CANON) === CANON);
  assert("route: inactive (conflicted) ws → raw", res(WS, "default", new Set()) === "default");
  assert("route: no alias in other workspace → raw (no cross-workspace)", res("ws-other", "default", new Set(["ws-other"])) === "default");
  assert("route: legacy token without workspace → raw", res(null, "default") === "default");
  assert("route: non-legacy branch untouched", res(WS, "branch-x") === "branch-x");
}
}

// ── Part B: real process ──────────────────────────────────────────────────────────────────────────────────────
const W2 = "ws-conflict-2";
const dir = path.join(vol, "ws-lease");
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, "branch-master-designations.json"), JSON.stringify({ version: 1, designations: { [LEG]: LENOVO, [`ws:${W2}:default`]: "dsk-w2", [`ws:${W2}:canon-w2`]: "dsk-w2b" }, cleared: [] }));
writeFileSync(path.join(dir, "master-lease.json"), JSON.stringify({ version: 2, masterByBranch: { [LEG]: LENOVO }, masterDisconnectedAt: {}, primaryMasterByBranch: { [LEG]: LENOVO } }));
writeFileSync(path.join(dir, "branch-aliases.json"), JSON.stringify({ version: 1, aliases: { [WS]: { default: CANON }, [W2]: { default: "canon-w2" } } }));

function mint(userId: string, c: Record<string, unknown>): string {
  const now = Math.floor(Date.now() / 1000);
  const b64 = Buffer.from(JSON.stringify({ purpose: "desktop_access", userId, iat: now, exp: now + 3600, ...c }), "utf-8").toString("base64url");
  return `${b64}.${createHmac("sha256", TEST_SECRET).update(b64).digest("base64url")}`;
}
type Msg = Record<string, unknown>;
type Client = { send: (o: unknown) => void; waitFor: (p: (m: Msg) => boolean, ms?: number) => Promise<Msg>; got: (p: (m: Msg) => boolean) => boolean; latest: (p: (m: Msg) => boolean) => Msg | undefined; close: () => void };
function mkClient(): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const buf: Msg[] = [];
    const waiters: { pred: (m: Msg) => boolean; resolve: (m: Msg) => void }[] = [];
    ws.on("message", (d) => {
      let m: Msg; try { m = JSON.parse(d.toString()) as Msg; } catch { return; }
      buf.push(m);
      for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i].pred(m)) { waiters[i].resolve(m); waiters.splice(i, 1); }
    });
    ws.on("open", () => resolve({
      send: (o) => ws.send(JSON.stringify(o)),
      waitFor: (pred, ms = 2500) => new Promise<Msg>((res, rej) => {
        const hit = buf.find(pred); if (hit) return res(hit);
        const w = { pred, resolve: res }; waiters.push(w);
        setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); rej(new Error("timeout")); } }, ms);
      }),
      got: (p) => buf.some(p),
      latest: (p) => [...buf].reverse().find(p),
      close: () => ws.close(),
    }));
    ws.on("error", reject);
  });
}
const isType = (t: string) => (m: Msg) => m.type === t;
async function regDevice(c: Client, token: string, deviceId: string, branchId: string, embeddedRenderer = false): Promise<string | undefined> {
  c.send({ type: "REGISTER", role: "device", authToken: token, deviceId, branchId, isMobile: false, embeddedRenderer,
    registrationIntent: { schemaVersion: 1, runtimeMode: "branch_playback", devicePurpose: "branch_desktop_station" } });
  await c.waitFor(isType("REGISTERED"));
  return (await c.waitFor(isType("SET_DEVICE_MODE")) as { mode?: string }).mode;
}
const readJson = (f: string) => JSON.parse(readFileSync(path.join(dir, f), "utf-8"));

async function main(): Promise<void> {
  await partA();
  await import("./index.js").catch(() => null);
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) { try { const c = await mkClient(); c.close(); ready = true; } catch { await sleep(100); } }
  assert("WS server booted", ready);
  if (!ready) return finish();

  const d = readJson("branch-master-designations.json");
  const l = readJson("master-lease.json");
  assert("boot: persisted designation re-keyed to canonical (same Lenovo id), legacy key gone", d.designations[CAN] === LENOVO && !(LEG in d.designations));
  assert("boot: persisted lease re-keyed to canonical, legacy key gone",
    l.masterByBranch[CAN] === LENOVO && l.primaryMasterByBranch[CAN] === LENOVO && !(LEG in l.masterByBranch) && !(LEG in l.primaryMasterByBranch));
  assert("boot: conflicting workspace left untouched (fail safe)", d.designations[`ws:${W2}:default`] === "dsk-w2" && d.designations[`ws:${W2}:canon-w2`] === "dsk-w2b");
  assert("boot: alias map remains persisted", readJson("branch-aliases.json").aliases[WS]?.default === CANON);

  const claims = { workspaceId: WS, authorizedBranches: [CANON, "default"], designatedMasterByBranch: { [CANON]: LENOVO } };
  const main = await mkClient();
  const mm = await regDevice(main, mint("u1", { ...claims, stationDeviceId: LENOVO, stationBranchId: CANON }), LENOVO, "default");
  assert("beta.10 MAIN sends raw 'default' → MASTER (trusted station, canonical room)", mm === "MASTER");
  const rnd = await mkClient();
  const rm = await regDevice(rnd, mint("u1", claims), "rnd-ba8f", "default", true);
  const rndMode = rnd.latest(isType("SET_DEVICE_MODE")) as { masterDeviceId?: string } | undefined;
  assert("embedded renderer 'default' → CONTROL with masterDeviceId = Lenovo (same canonical room)", rm === "CONTROL" && rndMode?.masterDeviceId === LENOVO);
  const second = await mkClient();
  const sm = await regDevice(second, mint("u1", { ...claims, stationDeviceId: "dsk-second" }), "dsk-second", "default");
  assert("second desktop cannot become MASTER (no duplicate MASTER)", sm === "CONTROL");
  assert("MAIN never demoted", !main.got((m) => m.type === "SET_DEVICE_MODE" && (m as { mode?: string }).mode === "CONTROL"));

  const ctl = await mkClient();
  ctl.send({ type: "REGISTER", role: "controller", authToken: mint("u1", claims), branchId: "default" });
  await ctl.waitFor(isType("REGISTERED"));
  const list = await ctl.waitFor((m) => m.type === "DEVICE_LIST" && (m as { masterDeviceId?: string }).masterDeviceId === LENOVO).catch(() => null);
  assert("controller 'default' lands in canonical room: DEVICE_LIST master = Lenovo", !!list);
  ctl.send({ type: "COMMAND", command: "PLAY", payload: {} });
  const cmd = await main.waitFor(isType("COMMAND")).catch(() => null);
  assert("controller COMMAND reaches MAIN in canonical room", !!cmd);

  const l2 = readJson("master-lease.json");
  assert("live lease: canonical room → Lenovo; nothing on legacy room", l2.masterByBranch[CAN] === LENOVO && !(LEG in l2.masterByBranch) && !(LEG in (l2.primaryMasterByBranch ?? {})));

  // Fail-safe workspace: routing stays on its raw room.
  const w2 = await mkClient();
  const w2m = await regDevice(w2, mint("u2", { workspaceId: W2, authorizedBranches: ["default"], stationDeviceId: "dsk-w2" }), "dsk-w2", "default");
  assert("conflicted workspace: designated station still MASTER in its raw (legacy) room", w2m === "MASTER");

  // Alias endpoint guard.
  const post = (body: unknown) => fetch(`http://127.0.0.1:${PORT}/internal/branch-alias`, { method: "POST", headers: { "Content-Type": "application/json", "X-SyncBiz-Secret": TEST_SECRET }, body: JSON.stringify(body) }).then((r) => r.status);
  assert("active alias change rejected (409)", (await post({ workspaceId: WS, legacyKey: "default", canonicalBranchId: "different-canon" })) === 409);
  assert("active alias removal rejected (409)", (await post({ workspaceId: WS, legacyKey: "default", canonicalBranchId: null })) === 409);
  assert("same-value alias re-sync idempotent (200)", (await post({ workspaceId: WS, legacyKey: "default", canonicalBranchId: CANON })) === 200);

  // Internal designation sync with the canonical id from the app (DB is canonical after 2A-2) keeps the same room.
  const ds = await fetch(`http://127.0.0.1:${PORT}/internal/branch-master-designation`, { method: "POST", headers: { "Content-Type": "application/json", "X-SyncBiz-Secret": TEST_SECRET }, body: JSON.stringify({ workspaceId: WS, branchId: "default", durableDeviceId: LENOVO }) }).then((r) => r.status);
  await sleep(200);
  const d2 = readJson("branch-master-designations.json");
  assert("internal designation sync with raw 'default' resolves to canonical room (no legacy key recreated)", ds === 200 && d2.designations[CAN] === LENOVO && !(LEG in d2.designations));
  assert("MAIN still MASTER after same-device designation sync", !main.got((m) => m.type === "SET_DEVICE_MODE" && (m as { mode?: string }).mode === "CONTROL"));

  for (const c of [main, rnd, second, ctl, w2]) c.close();
  finish();
}
function finish(): void {
  try { rmSync(vol, { recursive: true, force: true }); } catch { /* ignore */ }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}
void main();
