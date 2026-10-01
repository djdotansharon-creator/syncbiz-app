/**
 * Pilot PERMANENT MASTER — authoritative persistence of branch-master designations for the DB-less WS server.
 *
 * The DB (BranchMasterDesignation) is the source of truth; the app syncs each change to the WS server via an
 * authenticated internal endpoint, which writes here. On startup the WS server loads this file, so a designation
 * survives WS/server restart WITHOUT depending on a fresh client token.
 *
 * Authoritative state is a TRISTATE per room (`ws:<workspaceId>:<branch>`):
 *   1. never configured  → absent from both maps  → a token claim MAY bootstrap it
 *   2. designated to X    → in `designations`      → only X (trusted) is MASTER
 *   3. explicitly cleared → in `cleared` tombstone → NO designation, legacy election, but a stale token claim
 *                                                    may NOT revive the deleted designation
 * Keys are workspace-scoped and stable across restart, so (unlike the master-lease) there is no legacy-key
 * problem; format version starts at 1.
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

export type DesignationState = {
  /** roomKey → designated durable deviceId (state 2). */
  designations: Record<string, string>;
  /** roomKeys explicitly cleared by an admin (state 3 tombstone). */
  cleared: string[];
};

type DesignationSnapshot = { version?: number; designations?: Record<string, string>; cleared?: string[] };

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

/** Load the authoritative designation state (designations + cleared tombstones). Never throws. */
export function loadDesignations(): DesignationState {
  try {
    if (!existsSync(FILE)) return { designations: {}, cleared: [] };
    const data = JSON.parse(readFileSync(FILE, "utf-8")) as DesignationSnapshot;
    if (data.version !== DESIGNATION_FORMAT_VERSION) return { designations: {}, cleared: [] };
    return {
      designations: typeof data.designations === "object" && data.designations ? data.designations : {},
      cleared: Array.isArray(data.cleared) ? data.cleared.filter((r): r is string => typeof r === "string") : [],
    };
  } catch {
    return { designations: {}, cleared: [] };
  }
}

/** Persist the authoritative designation state. Returns TRUE only when the write succeeded. */
export function saveDesignations(state: DesignationState): boolean {
  try {
    ensureDir();
    writeFileSync(
      FILE,
      JSON.stringify({ version: DESIGNATION_FORMAT_VERSION, designations: state.designations, cleared: state.cleared }, null, 2),
      "utf-8",
    );
    return true;
  } catch (err) {
    console.warn("[SyncBiz WS] Failed to persist branch-master designations:", err);
    return false;
  }
}
