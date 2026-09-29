/**
 * Phase 0.2A — cloud registration/mapping for the durable MAIN (station) device identity (PURE core).
 *
 * The durable id is the value Phase 0.1 persists at C:\ProgramData\VONO\state\device-id.json. It is stored
 * byte-for-byte; we validate it against the SAME identity contract Phase 0.1 uses and never rewrite it.
 *
 * This module has NO database import so the race-safe algorithm and the validator can be unit-tested with an
 * in-memory repo. The Prisma-backed repo lives in `lib/station-device-prisma.ts`.
 *
 * Cross-tenant / branch-move safety is enforced at the WRITE boundary: registration goes through a
 * unique-constraint-safe algorithm so two concurrent registrations can never create or rebind two rows for the
 * same durableDeviceId. A registered device NEVER silently moves workspace or branch — branch reassignment is a
 * future explicit admin operation.
 */

/**
 * Phase 0.1 durable-id contract (mirror of desktop `isValidDeviceId`): a string, trimmed, length 8..200, no
 * ASCII control characters. NOT normalized/rewritten and NOT required to start with `dsk-` (legacy MAIN ids
 * preserved byte-for-byte by Phase 0.1 are valid).
 */
export function isValidDurableDeviceId(id: unknown): id is string {
  if (typeof id !== "string") return false;
  const s = id.trim();
  return s.length >= 8 && s.length <= 200 && !/[\u0000-\u001f]/.test(s);
}

export type RegisterStationDeviceInput = {
  durableDeviceId: string;
  workspaceId: string;
  branchId: string;
  platform: string;
  appVersion: string;
};

export type RegisterOutcome = "created" | "refreshed" | "branch_conflict" | "workspace_conflict";
export type RegisterResult = { outcome: RegisterOutcome };

/** Thrown by a repo's create() when durableDeviceId already exists (unique constraint). */
export class DurableDeviceConflictError extends Error {
  constructor() {
    super("durableDeviceId already registered");
    this.name = "DurableDeviceConflictError";
  }
}

/** Minimal persistence seam so the race-safe algorithm can be unit-tested without a database. */
export interface StationDeviceRepo {
  /** Insert a new row. MUST throw DurableDeviceConflictError if durableDeviceId already exists (atomic). */
  create(input: RegisterStationDeviceInput): Promise<void>;
  /** Look up the current binding for a durableDeviceId, or null. */
  findByDurableId(durableDeviceId: string): Promise<{ workspaceId: string; branchId: string } | null>;
  /** Refresh volatile fields ONLY for a row still matching (durableDeviceId, workspaceId, branchId). */
  refresh(
    durableDeviceId: string,
    match: { workspaceId: string; branchId: string },
    patch: { platform: string; appVersion: string },
  ): Promise<void>;
}

/**
 * Race-safe registration. Safety derives from repo.create() honoring the unique constraint on
 * durableDeviceId: concurrent first-registrations collide, exactly one wins ("created"), the loser falls
 * through to the existing-row evaluation. No find→check→create window can create or rebind two rows.
 */
export async function registerStationDevice(
  repo: StationDeviceRepo,
  input: RegisterStationDeviceInput,
): Promise<RegisterResult> {
  const durableDeviceId = input.durableDeviceId.trim();
  const { workspaceId, branchId, platform, appVersion } = input;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await repo.create({ durableDeviceId, workspaceId, branchId, platform, appVersion });
      return { outcome: "created" };
    } catch (e) {
      if (!(e instanceof DurableDeviceConflictError)) throw e;
    }
    const existing = await repo.findByDurableId(durableDeviceId);
    if (!existing) continue; // deleted between create-fail and read (rare) → retry create
    if (existing.workspaceId !== workspaceId) return { outcome: "workspace_conflict" }; // no mutation
    if (existing.branchId !== branchId) return { outcome: "branch_conflict" }; // no mutation, no auto-move
    await repo.refresh(durableDeviceId, { workspaceId, branchId }, { platform, appVersion });
    return { outcome: "refreshed" };
  }
  throw new Error("registerStationDevice: unresolved registration race");
}
