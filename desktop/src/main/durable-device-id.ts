/**
 * Phase 0.1 — DURABLE MACHINE DEVICE IDENTITY.
 *
 * The authoritative deviceId for this physical machine lives in `C:\ProgramData\VONO\state\device-id.json`
 * (see vono-paths.ts). It is the identity the branch MASTER designation will later key on, so it must NOT
 * change across renderer localStorage clears, Electron userData loss, app restarts, or a normal reinstall.
 *
 * Resolution precedence (MAIN owns it; the renderer localStorage id is only a MIRROR, set from here):
 *   A. ProgramData device-id.json holds a valid id  → USE IT (authoritative).
 *   B. else the caller's existing config deviceId is valid → MIGRATE that SAME value into ProgramData
 *      (the desktop's operative WS/heartbeat id is `config.deviceId`; preserving it keeps WS/lease identity).
 *   C. else generate exactly ONE new id → persist to ProgramData.
 *
 * Safety: a valid existing id is NEVER replaced. A corrupt/invalid device-id.json is treated as absent and,
 * when a known-valid config id exists, is REPAIRED with that id (never silently replaced by a fresh random).
 * Writes are atomic (tmp + rename) so a failed write can never leave a partial/corrupt identity file.
 */
import { existsSync, readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { vonoDeviceIdPath } from "./vono-paths";

const SCHEMA_VERSION = 1;

/** A plausible deviceId: non-empty, bounded, no control chars. Matches both `dsk-<uuid>` and legacy ids. */
export function isValidDeviceId(id: unknown): id is string {
  if (typeof id !== "string") return false;
  const s = id.trim();
  return s.length >= 8 && s.length <= 200 && !/[\u0000-\u001f]/.test(s);
}

function newDeviceId(): string {
  return `dsk-${randomUUID()}`;
}

/** Read the ProgramData device id, or null if absent/unreadable/corrupt/invalid (fail-safe → treat as absent). */
export function readProgramDataDeviceId(): string | null {
  try {
    const p = vonoDeviceIdPath();
    if (!existsSync(p)) return null;
    const data = JSON.parse(readFileSync(p, "utf-8")) as { deviceId?: unknown };
    return isValidDeviceId(data.deviceId) ? data.deviceId.trim() : null;
  } catch {
    return null; // unreadable / corrupt JSON → treat as absent (never throws)
  }
}

/** Atomically persist the device id. Returns true on success; never throws; never leaves a partial file. */
export function writeProgramDataDeviceId(id: string): boolean {
  const p = vonoDeviceIdPath(); // also ensures the state dir exists
  const tmp = `${p}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(tmp, JSON.stringify({ schemaVersion: SCHEMA_VERSION, deviceId: id, updatedAt: Date.now() }, null, 2), "utf-8");
    renameSync(tmp, p); // atomic replace — the real file is never partially written
    return true;
  } catch {
    try { rmSync(tmp, { force: true }); } catch { /* ignore */ }
    return false;
  }
}

export type DeviceIdResolution = { id: string; source: "programdata" | "config-migrated" | "generated" };

/**
 * Resolve the durable machine deviceId. `existingConfigId` is the desktop's current operative id
 * (runtime config), used as the migration source when ProgramData has none. Never replaces a valid id.
 */
export function resolveDurableDeviceId(existingConfigId: string | null | undefined): DeviceIdResolution {
  const pd = readProgramDataDeviceId();
  if (pd) return { id: pd, source: "programdata" }; // A — authoritative

  const cfg = isValidDeviceId(existingConfigId) ? existingConfigId.trim() : null;
  if (cfg) {
    writeProgramDataDeviceId(cfg); // B — migrate the SAME existing id (best-effort; identity stands even if the write fails)
    return { id: cfg, source: "config-migrated" };
  }

  const gen = newDeviceId(); // C — first time on this machine
  writeProgramDataDeviceId(gen);
  return { id: gen, source: "generated" };
}
