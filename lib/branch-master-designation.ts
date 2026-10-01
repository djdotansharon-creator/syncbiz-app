/**
 * Pilot permanent MASTER — Prisma-backed BranchMasterDesignation store (the only DB-touching part).
 *
 * The designation is the ONE permanent MASTER device per (workspaceId, branchId). It is the source of truth
 * for the WS permanent-master election; the DB-less WS server never reads this directly — the token-mint routes
 * read it here and embed a signed `designatedMasterByBranch` claim, so a designation survives WS/app/server
 * restarts. Only an authorized admin writes it (see the admin route); it is never changed automatically.
 */
import { prisma } from "@/lib/prisma";

export type BranchMasterDesignation = {
  workspaceId: string;
  branchId: string;
  durableDeviceId: string;
  designatedBy: string;
  designatedAt: Date;
};

/** The designation for one (workspaceId, branchId), or null if the branch has no permanent MASTER. */
export async function getBranchMasterDesignation(
  workspaceId: string,
  branchId: string,
): Promise<BranchMasterDesignation | null> {
  const row = await prisma.branchMasterDesignation.findUnique({
    where: { workspaceId_branchId: { workspaceId, branchId } },
    select: { workspaceId: true, branchId: true, durableDeviceId: true, designatedBy: true, designatedAt: true },
  });
  return row ?? null;
}

/**
 * Map { branchId → durableDeviceId } of permanent-MASTER designations for the given branches in a workspace.
 * Used by the token-mint routes to build the signed `designatedMasterByBranch` claim. Branches with no
 * designation are simply absent from the map (never a global/all-branch value).
 */
export async function getDesignatedMastersForBranches(
  workspaceId: string,
  branchIds: string[],
): Promise<Record<string, string>> {
  if (!workspaceId || branchIds.length === 0) return {};
  const rows = await prisma.branchMasterDesignation.findMany({
    where: { workspaceId, branchId: { in: branchIds } },
    select: { branchId: true, durableDeviceId: true },
  });
  const out: Record<string, string> = {};
  for (const r of rows) out[r.branchId] = r.durableDeviceId;
  return out;
}

/**
 * Create/replace the permanent-MASTER designation for (workspaceId, branchId). The caller MUST have already
 * verified `durableDeviceId` is an active StationDevice bound to the SAME (workspaceId, branchId) and that the
 * actor is an authorized admin. Keyed by (workspaceId, branchId) — replacing an existing designation is how an
 * admin reassigns a broken device.
 */
export async function setBranchMasterDesignation(input: {
  workspaceId: string;
  branchId: string;
  durableDeviceId: string;
  designatedBy: string;
}): Promise<BranchMasterDesignation> {
  const row = await prisma.branchMasterDesignation.upsert({
    where: { workspaceId_branchId: { workspaceId: input.workspaceId, branchId: input.branchId } },
    create: {
      workspaceId: input.workspaceId,
      branchId: input.branchId,
      durableDeviceId: input.durableDeviceId,
      designatedBy: input.designatedBy,
    },
    update: { durableDeviceId: input.durableDeviceId, designatedBy: input.designatedBy },
    select: { workspaceId: true, branchId: true, durableDeviceId: true, designatedBy: true, designatedAt: true },
  });
  return row;
}

/** Remove the designation for (workspaceId, branchId) — admin reset. */
export async function clearBranchMasterDesignation(workspaceId: string, branchId: string): Promise<void> {
  await prisma.branchMasterDesignation.deleteMany({ where: { workspaceId, branchId } });
}
