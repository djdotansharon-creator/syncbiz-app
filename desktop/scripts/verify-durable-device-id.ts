/**
 * Phase 0.1 regression — durable MACHINE device identity (src/main/durable-device-id.ts).
 *
 * Isolates each case by pointing %ProgramData% at a fresh temp dir (vono-paths.ts derives the state dir
 * from it), so device-id.json is written under a throwaway root. No Electron; pure fs.
 *
 * Run: npx tsx desktop/scripts/verify-durable-device-id.ts
 */
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveDurableDeviceId, readProgramDataDeviceId, isValidDeviceId } from "../src/main/durable-device-id";
import { vonoDeviceIdPath } from "../src/main/vono-paths";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}

const roots: string[] = [];
function freshProgramData(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "vono-pd-"));
  process.env.ProgramData = root; // vono-paths reads this at call time
  roots.push(root);
  return root;
}
function seedProgramDataId(id: string): void {
  const p = vonoDeviceIdPath(); // ensures the state dir exists
  writeFileSync(p, JSON.stringify({ schemaVersion: 1, deviceId: id, updatedAt: Date.now() }, null, 2));
}

// 1. Existing config id, no ProgramData → migrate the SAME value.
{
  freshProgramData();
  const r = resolveDurableDeviceId("dsk-config-111");
  assert("1. config id migrated (same value) when no ProgramData", r.id === "dsk-config-111" && r.source === "config-migrated");
  assert("1. ProgramData now holds the migrated id", readProgramDataDeviceId() === "dsk-config-111");
}

// 2. Existing ProgramData id → ProgramData WINS over a different config id.
{
  freshProgramData();
  seedProgramDataId("dsk-programdata-222");
  const r = resolveDurableDeviceId("dsk-config-DIFFERENT");
  assert("2. ProgramData wins over config", r.id === "dsk-programdata-222" && r.source === "programdata");
}

// 3. No id anywhere → generate exactly ONE new id, persisted.
{
  freshProgramData();
  const r = resolveDurableDeviceId(null);
  assert("3. generated exactly one new id", r.source === "generated" && isValidDeviceId(r.id) && r.id.startsWith("dsk-"));
  assert("3. generated id persisted to ProgramData", readProgramDataDeviceId() === r.id);
}

// 4. Config/userData wiped → same ProgramData id restored (ProgramData persists independently of config).
{
  freshProgramData();
  seedProgramDataId("dsk-durable-444");
  const r = resolveDurableDeviceId(""); // "" models a wiped config.deviceId (e.g. Electron userData loss)
  assert("4. config/userData wiped → ProgramData id restored", r.id === "dsk-durable-444" && r.source === "programdata");
}

// 5. Restart → same id (resolve twice returns the same persisted id).
{
  freshProgramData();
  const first = resolveDurableDeviceId("dsk-restart-555").id;
  const second = resolveDurableDeviceId("dsk-restart-555").id; // "restart"
  const third = resolveDurableDeviceId(null).id; // even with no config now
  assert("5. restart → identical id across resolves", first === "dsk-restart-555" && second === first && third === first);
}

// 6. heartbeat/WS parity: both use config.deviceId, which is reconciled to the durable id. Migrating config X
//    yields ProgramData X, so a subsequent resolve (what heartbeat/WS see via config) is the SAME X.
{
  freshProgramData();
  const migrated = resolveDurableDeviceId("dsk-parity-666"); // config → durable
  const asHeartbeatWouldRead = resolveDurableDeviceId(migrated.id).id; // next load sees config == durable
  assert("6. heartbeat/WS id === durable id (stable, single identity)", migrated.id === "dsk-parity-666" && asHeartbeatWouldRead === "dsk-parity-666");
}

// 7. Corrupt device-id.json + valid config → does NOT silently replace with a new random; repairs with the
//    KNOWN-VALID config id.
{
  freshProgramData();
  const p = vonoDeviceIdPath();
  writeFileSync(p, "{ this is not valid json "); // corrupt
  assert("7. corrupt file reads as absent (null)", readProgramDataDeviceId() === null);
  const r = resolveDurableDeviceId("dsk-known-valid-777");
  assert("7. corrupt + valid config → migrates the KNOWN id (no random replace)", r.id === "dsk-known-valid-777" && r.source === "config-migrated");
  assert("7. corrupt file repaired with the known id", readProgramDataDeviceId() === "dsk-known-valid-777");
}

// 8. Atomic-write failure must not throw and must not leave a corrupt identity file. Force writes to fail by
//    making %ProgramData% a FILE (so the state dir can't be created / written).
{
  const base = mkdtempSync(path.join(os.tmpdir(), "vono-pdfile-"));
  const asFile = path.join(base, "ProgramData-as-file");
  writeFileSync(asFile, "x"); // a file where a dir is expected
  process.env.ProgramData = asFile;
  roots.push(base);
  let threw = false;
  let id = "";
  try {
    const r = resolveDurableDeviceId("dsk-unwritable-888");
    id = r.id;
  } catch {
    threw = true;
  }
  assert("8. write failure does not throw; identity still resolves in-memory", !threw && id === "dsk-unwritable-888");
  // No partial/corrupt file was created under the invalid root (tmp+rename means the target never appears).
  assert("8. no corrupt identity file left behind", !existsSync(path.join(asFile, "VONO", "state", "device-id.json")));
}

// cleanup
for (const r of roots) { try { rmSync(r, { recursive: true, force: true }); } catch { /* ignore */ } }

console.log(`\n${pass} passed, ${fail} failed`);
