/**
 * Phase 0.1 regression — ProgramData is the IMMUTABLE runtime device-identity authority.
 *
 * A runtime/manual config change (SAVE_CONFIG with deviceId, or a hand-edited config file) must NOT be able to
 * drift the MAIN identity away from C:\ProgramData\VONO\state\device-id.json. This exercises the exact pure
 * functions the SAVE_CONFIG and WS_CONNECT handlers use (device-identity-reconcile.ts) against real temp
 * ProgramData + temp userData, and asserts the whole chain resolves to the durable id A.
 *
 * Run: npx tsx desktop/scripts/verify-runtime-identity-authority.ts
 */
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { reconcileDeviceIdentity, stripDeviceIdFromPatch } from "../src/main/device-identity-reconcile";
import { writeProgramDataDeviceId, readProgramDataDeviceId } from "../src/main/durable-device-id";
import { loadRuntimeConfig, saveRuntimeConfig, patchRuntimeConfig, defaultRuntimeConfig } from "../src/main/runtime-config-service";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}

const A = "dsk-A-durable-programdata";
const B_SAVE = "dsk-B-via-saveconfig";
const B_MANUAL = "dsk-B-manual-edit";

const roots: string[] = [];
function tmp(prefix: string): string { const d = mkdtempSync(path.join(os.tmpdir(), prefix)); roots.push(d); return d; }

// Establish ProgramData authority = A, and a userData whose config also starts at A.
const pdRoot = tmp("vono-auth-pd-");
process.env.ProgramData = pdRoot;
writeProgramDataDeviceId(A);
const userData = tmp("vono-auth-ud-");
saveRuntimeConfig(userData, { ...defaultRuntimeConfig(), deviceId: A, branchId: "default" });
assert("setup: ProgramData authority id = A", readProgramDataDeviceId() === A);

// ── SAVE_CONFIG attempt with deviceId = B (plus a legit non-identity field) ─────────────────────────────────
{
  const patch = { deviceId: B_SAVE, wsUrl: "ws://legit-change:3001" } as { deviceId?: string; wsUrl?: string };
  const safePatch = stripDeviceIdFromPatch(patch);
  assert("SAVE_CONFIG strips deviceId from the patch", !("deviceId" in safePatch));
  const cur = loadRuntimeConfig(userData);
  const patched = patchRuntimeConfig(userData, cur, safePatch);
  const next = reconcileDeviceIdentity(userData, patched);

  assert("SAVE_CONFIG returned config deviceId === A (not B)", next.deviceId === A, `got ${next.deviceId}`);
  assert("SAVE_CONFIG persisted config deviceId === A", loadRuntimeConfig(userData).deviceId === A);
  assert("SAVE_CONFIG: DeviceWsManager would REGISTER with A (config.deviceId)", next.deviceId === A);
  assert("SAVE_CONFIG: heartbeat would seed A (config.deviceId)", next.deviceId === A);
  assert("SAVE_CONFIG: device-id.json remains A", readProgramDataDeviceId() === A);
  assert("SAVE_CONFIG: legit non-identity field still applied", next.wsUrl === "ws://legit-change:3001");
}

// ── WS_CONNECT after the raw config file is manually tampered to B ───────────────────────────────────────────
{
  const raw = loadRuntimeConfig(userData);
  saveRuntimeConfig(userData, { ...raw, deviceId: B_MANUAL }); // hand-edit the config file
  assert("precondition: raw config now holds B", loadRuntimeConfig(userData).deviceId === B_MANUAL);

  // WS_CONNECT uses the reconciled effective config (never raw) before REGISTER.
  const effective = reconcileDeviceIdentity(userData, loadRuntimeConfig(userData));
  assert("WS_CONNECT reconciles the tampered config back to A before REGISTER", effective.deviceId === A, `got ${effective.deviceId}`);
  assert("WS_CONNECT: correction persisted to config (self-heal)", loadRuntimeConfig(userData).deviceId === A);
  assert("WS_CONNECT: device-id.json still A", readProgramDataDeviceId() === A);
}

// ── reconcile never replaces a valid ProgramData id (idempotent) ────────────────────────────────────────────
{
  const c = reconcileDeviceIdentity(userData, loadRuntimeConfig(userData));
  assert("reconcile is idempotent when already A", c.deviceId === A && readProgramDataDeviceId() === A);
}

for (const r of roots) { try { rmSync(r, { recursive: true, force: true }); } catch { /* ignore */ } }

console.log(`\n${pass} passed, ${fail} failed`);
