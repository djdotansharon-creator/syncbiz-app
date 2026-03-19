/**
 * File-based persistence for MASTER lease state.
 * Survives server restarts so the designated primary retains MASTER ownership.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "data");
const LEASE_FILE = join(DATA_DIR, "master-lease.json");

/** Key format: userId:branchId */
export type LeaseSnapshot = {
  masterByBranch: Record<string, string>;
  masterDisconnectedAt: Record<string, number>;
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
    if (!existsSync(LEASE_FILE)) return { masterByBranch: {}, masterDisconnectedAt: {} };
    const raw = readFileSync(LEASE_FILE, "utf-8");
    const data = JSON.parse(raw) as LeaseSnapshot & { masterByUserId?: Record<string, string> };
    let masterByBranch = typeof data.masterByBranch === "object" ? data.masterByBranch : {};
    let masterDisconnectedAt = typeof data.masterDisconnectedAt === "object" ? data.masterDisconnectedAt : {};
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
    return { masterByBranch, masterDisconnectedAt };
  } catch {
    return { masterByBranch: {}, masterDisconnectedAt: {} };
  }
}

/** Persist lease state to disk. Only writes masterByBranch and masterDisconnectedAt. */
export function saveLease(snapshot: LeaseSnapshot): void {
  try {
    ensureDir();
    writeFileSync(LEASE_FILE, JSON.stringify(snapshot, null, 2), "utf-8");
  } catch (err) {
    console.warn("[SyncBiz WS] Failed to persist master lease:", err);
  }
}
