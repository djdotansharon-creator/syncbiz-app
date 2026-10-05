/**
 * Last-known-TRUSTED permanent-designation cache (approach b — offline authority).
 *
 * The ONLY writer is the WS client, and ONLY after an online, server-verified event:
 *   SET_DEVICE_MODE { mode:"MASTER", designated:true }.
 * It is cleared on any CONTROL / designated:false (explicit revocation). It is NEVER derived from decoded
 * desktop_access token claims — the authority is the signed server event, persisted locally so the designated
 * station can prove its role OFFLINE (local playback only) when the WS can't connect.
 *
 * Stored in `C:\ProgramData\VONO\state\designation.json` (shared machine authority dir), bound to the durable
 * deviceId. Pure fs helpers; never throw.
 */
import { existsSync, readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { vonoDesignationPath } from "./vono-paths";

const SCHEMA_VERSION = 1;

export type DesignationRecord = {
  schemaVersion: number;
  /** Workspace the designation belongs to (keying only; may be "" if unknown at write time). */
  workspaceId: string;
  branchId: string;
  /** The durable deviceId the server designated as the permanent MASTER for (workspaceId, branchId). */
  durableDeviceId: string;
  designatedAt: number;
};

/** Read the cached designation, or null if absent/unreadable/corrupt (fail-safe → treat as absent). */
export function readDesignationRecord(): DesignationRecord | null {
  try {
    const p = vonoDesignationPath();
    if (!existsSync(p)) return null;
    const d = JSON.parse(readFileSync(p, "utf-8")) as Partial<DesignationRecord>;
    if (typeof d.durableDeviceId !== "string" || !d.durableDeviceId.trim()) return null;
    if (typeof d.branchId !== "string" || !d.branchId.trim()) return null;
    return {
      schemaVersion: typeof d.schemaVersion === "number" ? d.schemaVersion : SCHEMA_VERSION,
      workspaceId: typeof d.workspaceId === "string" ? d.workspaceId : "",
      branchId: d.branchId.trim(),
      durableDeviceId: d.durableDeviceId.trim(),
      designatedAt: typeof d.designatedAt === "number" ? d.designatedAt : 0,
    };
  } catch {
    return null;
  }
}

/** Atomically persist the designation. Returns true on success; never throws; never leaves a partial file. */
export function writeDesignationRecord(rec: Omit<DesignationRecord, "schemaVersion">): boolean {
  const p = vonoDesignationPath(); // ensures the state dir exists
  const tmp = `${p}.tmp-${process.pid}-${Date.now()}`;
  try {
    const body: DesignationRecord = { schemaVersion: SCHEMA_VERSION, ...rec };
    writeFileSync(tmp, JSON.stringify(body, null, 2), "utf-8");
    renameSync(tmp, p);
    return true;
  } catch {
    try { rmSync(tmp, { force: true }); } catch { /* ignore */ }
    return false;
  }
}

/** Remove the cached designation (explicit revocation). Returns true if removed or already absent. */
export function clearDesignationRecord(): boolean {
  try {
    const p = vonoDesignationPath();
    if (existsSync(p)) rmSync(p, { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * PURE decision: does the persisted record prove THIS station is the designated permanent MASTER (offline)?
 * Anchored on the durable deviceId (written only on the trusted server event), scoped by branch (+ workspace
 * when both sides know it). This is the sole offline-authority check.
 */
export function isDesignatedStationOffline(
  rec: DesignationRecord | null,
  current: { durableDeviceId: string; branchId: string; workspaceId?: string },
): boolean {
  if (!rec) return false;
  const dev = (current.durableDeviceId ?? "").trim();
  const branch = (current.branchId ?? "").trim();
  if (!dev || !branch) return false;
  if (rec.durableDeviceId !== dev) return false;
  if (rec.branchId !== branch) return false;
  // Workspace is compared only when BOTH sides have a non-empty value (keying, not the trust anchor).
  const cw = (current.workspaceId ?? "").trim();
  if (rec.workspaceId && cw && rec.workspaceId !== cw) return false;
  return true;
}
