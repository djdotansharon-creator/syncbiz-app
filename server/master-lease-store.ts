/**
 * File-based persistence for MASTER lease state.
 * Survives server restarts so the designated primary retains MASTER ownership.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const railwayVolumePath =
  typeof process.env.RAILWAY_VOLUME_MOUNT_PATH === "string" && process.env.RAILWAY_VOLUME_MOUNT_PATH.trim()
    ? process.env.RAILWAY_VOLUME_MOUNT_PATH.trim().replace(/\/$/, "")
    : "";
const DATA_DIR = railwayVolumePath ? join(railwayVolumePath, "ws-lease") : join(__dirname, "data");
const LEASE_FILE = join(DATA_DIR, "master-lease.json");

/** Key format: userId:branchId */
export type LeaseSnapshot = {
  masterByBranch: Record<string, string>;
  masterDisconnectedAt: Record<string, number>;
  /** Designated primary MASTER per branch. Only this device can be MASTER. */
  primaryMasterByBranch: Record<string, string>;
  /** @deprecated Migrated to masterByBranch. Kept for load compat. */
  masterByUserId?: Record<string, string>;
};

function ensureDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

/** Load persisted lease state. Migrates old masterByUserId to masterByBranch (userId -> userId:default). */
export function loadLease(): LeaseSnapshot {
  try {
    if (!existsSync(LEASE_FILE)) return { masterByBranch: {}, masterDisconnectedAt: {}, primaryMasterByBranch: {} };
    const raw = readFileSync(LEASE_FILE, "utf-8");
    const data = JSON.parse(raw) as LeaseSnapshot & { masterByUserId?: Record<string, string> };
    let masterByBranch = typeof data.masterByBranch === "object" ? data.masterByBranch : {};
    let masterDisconnectedAt = typeof data.masterDisconnectedAt === "object" ? data.masterDisconnectedAt : {};
    let primaryMasterByBranch = typeof data.primaryMasterByBranch === "object" ? data.primaryMasterByBranch : {};
    if (data.masterByUserId && Object.keys(masterByBranch).length === 0) {
      for (const [userId, deviceId] of Object.entries(data.masterByUserId)) {
        masterByBranch[`${userId}:default`] = deviceId;
      }
      const oldDisconnected = (data as { masterDisconnectedAt?: Record<string, number> }).masterDisconnectedAt;
      if (oldDisconnected) {
        for (const [userId, ts] of Object.entries(oldDisconnected)) {
          masterDisconnectedAt[`${userId}:default`] = ts;
        }
      }
    }
    if (Object.keys(primaryMasterByBranch).length === 0 && Object.keys(masterByBranch).length > 0) {
      for (const [k, v] of Object.entries(masterByBranch)) {
        primaryMasterByBranch[k] = v;
      }
    }
    return { masterByBranch, masterDisconnectedAt, primaryMasterByBranch };
  } catch {
    return { masterByBranch: {}, masterDisconnectedAt: {}, primaryMasterByBranch: {} };
  }
}

/** Persist lease state to disk. */
export function saveLease(snapshot: LeaseSnapshot): void {
  try {
    ensureDir();
    writeFileSync(LEASE_FILE, JSON.stringify(snapshot, null, 2), "utf-8");
  } catch (err) {
    console.warn("[SyncBiz WS] Failed to persist master lease:", err);
  }
}
