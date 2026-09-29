/**
 * Phase 0.1 regression — the heartbeat carries the durable MAIN deviceId from the FIRST write, independent of
 * renderer load / WS connect / playback.
 *
 * Before this fix startHeartbeat() began with deviceId=null/branchId=null and identity was populated only later
 * via updateFromMpv() (fed by broadcast()). So if the renderer never loaded / UI was offline / WS never started,
 * heartbeat.json could be alive but hold deviceId:null — breaking the Phase 0.1 invariant and the later
 * verified-backfill procedure. Now startHeartbeat() is seeded with the durable MAIN identity up front, and a
 * later snapshot may REFRESH branch but must never regress the durable deviceId to null.
 *
 * Run: npx tsx desktop/scripts/verify-heartbeat-startup-identity.ts
 */
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { startHeartbeat, stopHeartbeat, updateFromMpv } from "../src/main/heartbeat-writer";
import { vonoHeartbeatPath } from "../src/main/vono-paths";
import type { MvpStatusSnapshot } from "../src/shared/mvp-types";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
function readHb(): { deviceId: string | null; branchId: string | null; app?: { alive?: boolean } } {
  return JSON.parse(readFileSync(vonoHeartbeatPath(), "utf-8"));
}
function snap(over: Partial<MvpStatusSnapshot>): MvpStatusSnapshot {
  return {
    mockPlaybackStatus: "idle",
    mpvPosition: 0,
    mpvDuration: 0,
    mpvEngineReady: false,
    mpvLastError: null,
    mpvAttemptId: 0,
    deviceId: "",
    branchId: "",
    ...over,
  } as MvpStatusSnapshot;
}

const DURABLE = "dsk-heartbeat-STATION-001";

async function main(): Promise<void> {
  const pdRoot = mkdtempSync(path.join(os.tmpdir(), "vono-hb-"));
  process.env.ProgramData = pdRoot;

  try {
    // 1. Startup identity — the FIRST heartbeat already carries the durable MAIN deviceId (writeNow is sync).
    startHeartbeat({
      appVersion: "9.9.9", pid: 4242, execPath: "C:\\vono\\VONO.exe",
      deviceId: DURABLE, branchId: "default",
    });
    const hb1 = readHb();
    assert("1. first heartbeat deviceId === durable MAIN id", hb1.deviceId === DURABLE, `got ${hb1.deviceId}`);
    assert("1. first heartbeat branchId seeded from config", hb1.branchId === "default");
    assert("1. first heartbeat identity is NOT null", hb1.deviceId !== null);
    assert("1. app reported alive", hb1.app?.alive === true);

    // 2. Renderer/UI/WS never starts — no updateFromMpv() is ever called → heartbeat still holds the durable id.
    assert("2. durable id present without any renderer/WS/playback activity", readHb().deviceId === DURABLE);

    // 3a. A later real snapshot (carrying the same durable id) may refresh branch; deviceId stays durable.
    updateFromMpv(snap({ mockPlaybackStatus: "playing", mpvAttemptId: 1, mpvEngineReady: true, deviceId: DURABLE, branchId: "branch-XYZ" }));
    await sleep(1200); // exceed the 1000ms coalesce so the transition write lands
    const hb3a = readHb();
    assert("3a. after snapshot, deviceId remains the durable MAIN id", hb3a.deviceId === DURABLE, `got ${hb3a.deviceId}`);
    assert("3a. branch may refresh from the snapshot", hb3a.branchId === "branch-XYZ");

    // 3b. An EMPTY-identity snapshot must NOT regress the durable deviceId to null.
    updateFromMpv(snap({ mockPlaybackStatus: "idle", mpvAttemptId: 2, deviceId: "", branchId: "" }));
    await sleep(1200);
    const hb3b = readHb();
    assert("3b. empty snapshot does NOT wipe the durable deviceId to null", hb3b.deviceId === DURABLE, `got ${hb3b.deviceId}`);
  } finally {
    stopHeartbeat();
    try { rmSync(pdRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
}

void main();
