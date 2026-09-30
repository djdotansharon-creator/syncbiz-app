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

/**
 * Lease-format version. PR-0 switched the runtime key from `userId:branchId` (v1/unversioned) to the
 * workspace-scoped room key `ws:<workspaceId>:<branch>` / `legacy:<userId>:<branch>` (see branch-room.ts).
 * Old keys CANNOT be safely reinterpreted as workspace keys, so a file whose version !== this is IGNORED on
 * load (runtime election starts fresh — safe because permanent designation is not active yet). The old file is
 * left on disk untouched (never deleted) and is overwritten with the new format on the next save.
 */
export const LEASE_FORMAT_VERSION = 2;

/** Key format (v2): the runtime room key from branch-room.ts (`ws:<workspaceId>:<branch>` or `legacy:...`). */
export type LeaseSnapshot = {
  version?: number;
  masterByBranch: Record<string, string>;
  masterDisconnectedAt: Record<string, number>;
  /** Designated primary MASTER per room. Only this device can be MASTER. */
  primaryMasterByBranch: Record<string, string>;
};

function emptySnapshot(): LeaseSnapshot {
  return { version: LEASE_FORMAT_VERSION, masterByBranch: {}, masterDisconnectedAt: {}, primaryMasterByBranch: {} };
}

function ensureDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * Load persisted lease state. A file without version === LEASE_FORMAT_VERSION is a legacy (userId-scoped)
 * lease whose keys are NOT valid workspace room keys, so it is ignored (start fresh). Never throws.
 */
export function loadLease(): LeaseSnapshot {
  try {
    if (!existsSync(LEASE_FILE)) return emptySnapshot();
    const raw = readFileSync(LEASE_FILE, "utf-8");
    const data = JSON.parse(raw) as Partial<LeaseSnapshot>;
    if (data.version !== LEASE_FORMAT_VERSION) {
      console.warn(
        `[SyncBiz WS] Ignoring legacy master-lease format (found version=${data.version ?? "none"}, need ${LEASE_FORMAT_VERSION}) — starting fresh.`,
      );
      return emptySnapshot();
    }
    return {
      version: LEASE_FORMAT_VERSION,
      masterByBranch: typeof data.masterByBranch === "object" && data.masterByBranch ? data.masterByBranch : {},
      masterDisconnectedAt:
        typeof data.masterDisconnectedAt === "object" && data.masterDisconnectedAt ? data.masterDisconnectedAt : {},
      primaryMasterByBranch:
        typeof data.primaryMasterByBranch === "object" && data.primaryMasterByBranch ? data.primaryMasterByBranch : {},
    };
  } catch {
    return emptySnapshot();
  }
}

/** Persist lease state to disk (always stamped with the current format version). */
export function saveLease(snapshot: LeaseSnapshot): void {
  try {
    ensureDir();
    // `version` LAST so a caller's snapshot.version can never override the required current format version.
    writeFileSync(LEASE_FILE, JSON.stringify({ ...snapshot, version: LEASE_FORMAT_VERSION }, null, 2), "utf-8");
  } catch (err) {
    console.warn("[SyncBiz WS] Failed to persist master lease:", err);
  }
}
