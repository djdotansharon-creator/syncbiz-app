/**
 * WS refusal diagnostics — real process-level test (owner 2026-11-01: "why is father's browser refused?"). The server now writes ONE read-only line when it refuses a REGISTER
 * (`[SyncBiz WS][reject] …`) saying which device asked for which branch and what the signed claim allowed. This test proves the lines are written, carry only ids / a length (never the token),
 * and that NOTHING else changed: the close codes are still 4004 / 4005 and a good REGISTER still works. Boots the actual WS server on an ephemeral port; no DB, no network.
 * Run: npx tsx server/verify-reject-log.ts
 */
import { createHmac } from "node:crypto";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";

const TEST_SECRET = "test-ws-secret-reject-log-0123456789abcdef";
const PORT = 45000 + Math.floor(Math.random() * 2000);
const leaseDir = mkdtempSync(path.join(os.tmpdir(), "vono-rejlog-"));
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

// capture every console.warn line the server writes (still printed)
const lines: string[] = [];
const origWarn = console.warn.bind(console);
console.warn = (...a: unknown[]) => {
  lines.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
  origWarn(...a);
};

function mintToken(userId: string, workspaceId: string, branches: string[], enrollmentRole?: string): { token: string; payloadPart: string; sigPart: string } {
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = { purpose: "ws_register", userId, iat: now, exp: now + 60, workspaceId, authorizedBranches: branches };
  if (enrollmentRole) payload.enrollmentRole = enrollmentRole;
  const b64 = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  const sig = createHmac("sha256", TEST_SECRET).update(b64).digest("base64url");
  return { token: `${b64}.${sig}`, payloadPart: b64, sigPart: sig };
}

/** open a socket, send REGISTER, and report the close code + whether a SET_DEVICE_MODE / REGISTERED answer arrived */
function register(msg: Record<string, unknown>): Promise<{ code: number; answered: boolean }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(URL);
    let answered = false;
    ws.on("open", () => ws.send(JSON.stringify(msg)));
    ws.on("message", (d) => { try { const m = JSON.parse(d.toString()) as { type?: string }; if (m.type === "REGISTERED" || m.type === "SET_DEVICE_MODE") answered = true; } catch { /* ignore */ } });
    ws.on("close", (code) => resolve({ code, answered }));
    ws.on("error", () => resolve({ code: -1, answered }));
    setTimeout(() => { if (ws.readyState === WebSocket.OPEN) { ws.close(); } }, 1200);
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

  // R1: a valid token that does NOT allow the requested branch → still closed 4004, and the line says who / what / why
  {
    const t = mintToken("u-r1", "ws-r1", ["branch-allowed-1", "branch-allowed-2"], "REMOTE");
    const before = lines.length;
    const r = await register({ type: "REGISTER", role: "device", authToken: t.token, deviceId: "dev-r1", branchId: "branch-asked-for", isMobile: false });
    await sleep(100);
    const mine = lines.slice(before).filter((l) => l.includes("[SyncBiz WS][reject] branch_not_authorized"));
    const line = mine[0] ?? "";
    assert("R1 the refusal is unchanged: closed with 4004 and no SET_DEVICE_MODE / REGISTERED", r.code === 4004 && !r.answered, `code ${r.code}`);
    assert("R1 exactly one reject line, naming the device, the branch it asked for, the user, the workspace and the role", mine.length === 1 && line.includes("dev-r1") && line.includes("branch-asked-for") && line.includes("u-r1") && line.includes("ws-r1") && line.includes("REMOTE"));
    assert("R1 it lists what the signed claim allowed (count and ids)", line.includes("branch-allowed-1") && line.includes("branch-allowed-2") && /"allowedBranchCount":2/.test(line));
    assert("R1 the token (payload or signature part) never appears in any line the server wrote", !lines.some((l) => l.includes(t.payloadPart) || l.includes(t.sigPart)));
  }

  // R2: a token that does not verify → still closed 4005, and the line carries the device, the asked branch and a LENGTH — not the token
  {
    const bad = "garbage-token-value-" + "x".repeat(30);
    const before = lines.length;
    const r = await register({ type: "REGISTER", role: "device", authToken: bad, deviceId: "dev-r2", branchId: "branch-r2", isMobile: false });
    await sleep(100);
    const mine = lines.slice(before).filter((l) => l.includes("[SyncBiz WS][reject] invalid_token"));
    const line = mine[0] ?? "";
    assert("R2 the refusal is unchanged: closed with 4005", r.code === 4005 && !r.answered, `code ${r.code}`);
    assert("R2 one reject line with the device, the branch it asked for and the token LENGTH", mine.length === 1 && line.includes("dev-r2") && line.includes("branch-r2") && line.includes(`"tokenLength":${bad.length}`));
    assert("R2 the token text itself is not in any line", !lines.some((l) => l.includes(bad)));
  }

  // R3: an invalid REGISTER body (no token) → still 4004, with the reason only
  {
    const before = lines.length;
    const r = await register({ type: "REGISTER", role: "device", deviceId: "dev-r3", branchId: "b" });
    await sleep(100);
    const mine = lines.slice(before).filter((l) => l.includes("[SyncBiz WS][reject] invalid_register"));
    assert("R3 a REGISTER without a token: still 4004, and the reason line says 'Authentication required'", r.code === 4004 && mine.length === 1 && mine[0].includes("Authentication required"), `code ${r.code}`);
  }

  // R4: a good REGISTER is untouched — it gets its answer, stays open, and writes NO reject line
  {
    const t = mintToken("u-r4", "ws-r4", ["branch-ok"]);
    const before = lines.length;
    const r = await register({ type: "REGISTER", role: "device", authToken: t.token, deviceId: "dev-r4", branchId: "branch-ok", isMobile: false, registrationIntent: { schemaVersion: 1, runtimeMode: "branch_playback", devicePurpose: "branch_web_station" } });
    const rejects = lines.slice(before).filter((l) => l.includes("[SyncBiz WS][reject]"));
    assert("R4 an authorized REGISTER still works (answered, not closed by the server) and writes no reject line", r.answered && r.code !== 4004 && r.code !== 4005 && rejects.length === 0, `code ${r.code}`);
  }

  // R5: the same room accepts the default branch with a null claim exactly as before (legacy tokens) — no reject line for it
  {
    const payload = { purpose: "ws_register", userId: "u-r5", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60, workspaceId: "ws-r5" }; // no authorizedBranches claim
    const b64 = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
    const tok = `${b64}.${createHmac("sha256", TEST_SECRET).update(b64).digest("base64url")}`;
    const before = lines.length;
    const r = await register({ type: "REGISTER", role: "device", authToken: tok, deviceId: "dev-r5", branchId: "default", isMobile: false });
    const rejects = lines.slice(before).filter((l) => l.includes("[SyncBiz WS][reject]"));
    assert("R5 a legacy token (no branch claim) on the default branch is still accepted — no reject line", r.answered && rejects.length === 0, `code ${r.code}`);
  }
  finish();
}

function finish(): void {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error("TEST ERROR", e); process.exit(1); });
