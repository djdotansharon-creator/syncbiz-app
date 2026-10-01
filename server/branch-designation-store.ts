/**
 * Pilot PERMANENT MASTER — authoritative persistence of branch-master designations for the DB-less WS server.
 *
 * The DB (BranchMasterDesignation) is the source of truth; the app syncs each change to the WS server via an
 * authenticated internal endpoint, which writes here. On startup the WS server loads this file, so a designation
 * survives WS/server restart WITHOUT depending on a fresh client token. Keyed by the runtime room key
 * (`ws:<workspaceId>:<branch>`) — workspace-scoped and stable across restart (never userId-dependent), so unlike
 * the master-lease there is no legacy-key problem; format version starts at 1.
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
const FILE = join(DATA_DIR, "branch-master-designations.json");

export const DESIGNATION_FORMAT_VERSION = 1;

type DesignationSnapshot = { version?: number; designations: Record<string, string> };

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

/** Load the authoritative { roomKey → durableDeviceId } designation map. Never throws. */
export function loadDesignations(): Record<string, string> {
  try {
    if (!existsSync(FILE)) return {};
    const data = JSON.parse(readFileSync(FILE, "utf-8")) as Partial<DesignationSnapshot>;
    if (data.version !== DESIGNATION_FORMAT_VERSION) return {};
    return typeof data.designations === "object" && data.designations ? data.designations : {};
  } catch {
    return {};
  }
}

/** Persist the authoritative designation map. */
export function saveDesignations(designations: Record<string, string>): void {
  try {
    ensureDir();
    writeFileSync(FILE, JSON.stringify({ version: DESIGNATION_FORMAT_VERSION, designations }, null, 2), "utf-8");
  } catch (err) {
    console.warn("[SyncBiz WS] Failed to persist branch-master designations:", err);
  }
}
