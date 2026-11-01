/**
 * Approved Remote + the legacy "default" alias — real process-level test (owner 2026-11-01). The cloud log showed one approved Remote refused 4004 "Branch not authorized" on every attempt: its ticket listed only the
 * real id of its branch, while every browser REGISTERs "default". This boots the actual WS server and shows both sides: the OLD ticket shape (real id only) is refused — the bug; the NEW shape the ticket route now
 * mints (real id + 'default', see lib/enrollment-branch-claim.ts) registers, is held to CONTROL (an approved Remote never plays) and cannot reach a branch it was not approved for.
 * Run: npx tsx server/verify-enrollment-default-alias.ts
 */
import { createHmac } from "node:crypto";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";

const TEST_SECRET = "test-ws-secret-default-alias-0123456789ab";
const PORT = 47000 + Math.floor(Math.random() * 2000);
const leaseDir = mkdtempSync(path.join(os.tmpdir(), "vono-alias-"));
process.env.SYNCBIZ_WS_SECRET = TEST_SECRET;
process.env.WS_SECRET = TEST_SECRET;
process.env.PORT = String(PORT);
process.env.RAILWAY_VOLUME_MOUNT_PATH = leaseDir;
process.env.NODE_ENV = "test";
const URL = `ws://127.0.0.1:${PORT}`;
const MAIN = "70227520-ce14-40b5-8a71-d8483b746db3";
const OTHER = "99999999-aaaa-bbbb-cccc-000000000000";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function mint(branches: string[], enrollmentRole = "REMOTE"): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = { purpose: "ws_register", userId: "u-alias", iat: now, exp: now + 60, workspaceId: "ws-alias", authorizedBranches: branches, enrollmentRole };
  const b64 = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  return `${b64}.${createHmac("sha256", TEST_SECRET).update(b64).digest("base64url")}`;
}

/** REGISTER a device for `branch`; resolve with the close code (or -1 while still open) and the mode the server assigned */
function register(token: string, branch: string, deviceId: string): Promise<{ code: number; mode: string | null; registered: boolean }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(URL);
    let mode: string | null = null, registered = false;
    ws.on("open", () => ws.send(JSON.stringify({ type: "REGISTER", role: "device", authToken: token, deviceId, branchId: branch, isMobile: false, registrationIntent: { schemaVersion: 1, runtimeMode: "branch_playback", devicePurpose: "branch_web_station" } })));
    ws.on("message", (d) => { try { const m = JSON.parse(d.toString()) as { type?: string; mode?: string }; if (m.type === "REGISTERED") registered = true; if (m.type === "SET_DEVICE_MODE") mode = String(m.mode); } catch { /* ignore */ } });
    ws.on("close", (code) => resolve({ code, mode, registered }));
    ws.on("error", () => resolve({ code: -2, mode, registered }));
    setTimeout(() => { const open = ws.readyState === WebSocket.OPEN; if (open) { ws.close(); } }, 1000);
  });
}

async function main(): Promise<void> {
  await import("./index.js");
  let ready = false;
  for (let i = 0; i < 50 && !ready; i++) {
    try { await new Promise<void>((res, rej) => { const w = new WebSocket(URL); w.on("open", () => { w.close(); res(); }); w.on("error", rej); }); ready = true; } catch { await sleep(100); }
  }
  assert("WS server booted", ready);
  if (!ready) return finish();

  const old = await register(mint([MAIN]), "default", "alias-old");
  assert("A1 the OLD ticket shape (the branch's real id only) is refused when the browser registers 'default' — exactly what the cloud log showed (4004)", old.code === 4004 && !old.registered, `code ${old.code}`);

  const fixed = await register(mint([MAIN, "default"]), "default", "alias-new");
  assert("A2 the NEW ticket shape (real id + 'default') registers on 'default' and is held to CONTROL — an approved Remote never plays", fixed.registered && fixed.mode === "CONTROL" && fixed.code !== 4004 && fixed.code !== 4005, `mode ${fixed.mode}, code ${fixed.code}`);

  const wrongBranch = await register(mint([MAIN, "default"]), OTHER, "alias-other");
  assert("A3 the alias opens nothing else: the same ticket is still refused on a branch it was not approved for", wrongBranch.code === 4004 && !wrongBranch.registered, `code ${wrongBranch.code}`);

  const notDefault = await register(mint([OTHER]), "default", "alias-notdefault");
  assert("A4 a device approved ONLY for another branch (no alias in its ticket) is still refused on 'default' — the main branch is not opened to it", notDefault.code === 4004 && !notDefault.registered, `code ${notDefault.code}`);
  finish();
}

function finish(): void {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error("TEST ERROR", e); process.exit(1); });
