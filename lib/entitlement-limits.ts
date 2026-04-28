/**
 * Optional enforcement of WorkspaceEntitlement pilot limits (`maxUsers`, `maxBranches`,
 * `maxDevices`, `maxPlaylists`) when `SYNCBIZ_ENFORCE_LIMITS === "1"`.
 *
 * If the env is unset or not "1", all exports no-op (preserve legacy behavior).
 * If a workspace has no `WorkspaceEntitlement` row yet, enforcement is skipped (fail open),
 * identical in spirit to `lib/auth/suspension.ts` for unmigrated tenants.
 */

import "server-only";

import { prisma } from "@/lib/prisma";

const ENV_KEY = "SYNCBIZ_ENFORCE_LIMITS";

export class EntitlementLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EntitlementLimitError";
  }
}

export function isLimitsEnforcementEnabled(): boolean {
  return process.env[ENV_KEY] === "1";
}

type EntNums = Pick<
  import("@prisma/client").WorkspaceEntitlement,
  "maxUsers" | "maxBranches" | "maxDevices" | "maxPlaylists"
>;

async function loadLimits(workspaceId: string): Promise<EntNums | null> {
  if (!isLimitsEnforcementEnabled()) return null;
  return prisma.workspaceEntitlement.findUnique({
    where: { workspaceId },
    select: {
      maxUsers: true,
      maxBranches: true,
      maxDevices: true,
      maxPlaylists: true,
    },
  });
}

/** Adding one new `WorkspaceMember` (invite / Access Control POST create user path). */
export async function enforceCanAddWorkspaceMember(workspaceId: string): Promise<void> {
  const ent = await loadLimits(workspaceId);
  if (!ent) return;
  const n = await prisma.workspaceMember.count({ where: { workspaceId } });
  if (n >= ent.maxUsers) {
    throw new EntitlementLimitError("User limit reached for this workspace");
  }
}

/** After signup: ensure current member rows do not exceed `maxUsers` (e.g. maxUsers forced to 0). */
export async function assertWorkspaceMembershipWithinEntitlement(workspaceId: string): Promise<void> {
  const ent = await loadLimits(workspaceId);
  if (!ent) return;
  const n = await prisma.workspaceMember.count({ where: { workspaceId } });
  if (n > ent.maxUsers) {
    throw new EntitlementLimitError("User limit reached for this workspace");
  }
}

export async function enforceCanAddBranch(workspaceId: string): Promise<void> {
  const ent = await loadLimits(workspaceId);
  if (!ent) return;
  const n = await prisma.branch.count({ where: { workspaceId } });
  if (n >= ent.maxBranches) {
    throw new EntitlementLimitError("Branch limit reached for this workspace");
  }
}

export async function enforceCanAddDevice(workspaceId: string): Promise<void> {
  const ent = await loadLimits(workspaceId);
  if (!ent) return;
  const n = await prisma.device.count({ where: { workspaceId } });
  if (n >= ent.maxDevices) {
    throw new EntitlementLimitError("Device limit reached for this workspace");
  }
}

export async function enforceCanAddPlaylist(workspaceId: string): Promise<void> {
  const ent = await loadLimits(workspaceId);
  if (!ent) return;
  const n = await prisma.playlist.count({ where: { workspaceId } });
  if (n >= ent.maxPlaylists) {
    throw new EntitlementLimitError("Playlist limit reached for this workspace");
  }
}
