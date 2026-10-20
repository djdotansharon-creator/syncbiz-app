/**
 * Station activation — Step B1 (owner-approved 2026-10-11). A computer that runs VONO becomes the MAIN station of ONE
 * branch by typing that branch's Station ID + its one-time activation code (created by the owner in the Control Room).
 *
 * Rules (owner, hard):
 *  - The code is the authorization: valid 60 min, single use, hash only, max 5 wrong tries, a new code revokes the old.
 *  - The station is bound ONLY to its own branch (StationDevice row + permanent MASTER designation of that branch).
 *  - It never replaces a station in ANOTHER branch: a computer that is already the designated MAIN station of another
 *    branch is refused (protects the Lenovo); an "install" code never replaces an existing main station of its own
 *    branch — only a "replace" code does (explicit owner action).
 *  - Same organization only (Station ID prefix = this workspace's network code).
 * B1 still runs inside a signed-in session (temporary, owner-approved); B2 gives the station its own credential.
 */
import { prisma } from "./prisma";
import { ACTIVATION_MAX_FAILED_ATTEMPTS, activationCodeMatches, normalizeBranchNumber, normalizeStationIdPrefix, stationIdFor } from "./branch-activation";
import { BranchInputError } from "./branch-management";

export type StationActivationResult = {
  branchId: string;
  branchName: string;
  stationId: string;
  /** true when this computer replaced another main station of the SAME branch (a "replace" code) */
  replaced: boolean;
  /** true when the computer already was this branch's main station (nothing changed) */
  alreadyActive: boolean;
};

export function isPlausibleDurableDeviceId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(id.trim());
}

/** "AROMA-192" → { prefix: "AROMA", number: "192" } (split at the LAST dash). */
export function parseStationId(raw: unknown): { prefix: string; number: string } | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toUpperCase();
  const i = v.lastIndexOf("-");
  if (i <= 0) return null;
  const prefix = normalizeStationIdPrefix(v.slice(0, i));
  const number = normalizeBranchNumber(v.slice(i + 1));
  return prefix && number ? { prefix, number } : null;
}

/** Is this computer the designated main station of a branch in this workspace? (read-only; for the activation screen) */
export async function getStationActivationState(workspaceId: string, durableDeviceId: string) {
  const d = await prisma.branchMasterDesignation.findFirst({ where: { workspaceId, durableDeviceId }, select: { branchId: true } });
  if (!d) return { designated: false as const };
  const branch = await prisma.branch.findFirst({
    where: { workspaceId, OR: [{ id: d.branchId }, { legacyKey: d.branchId }] },
    select: { name: true, locationCode: true },
  });
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { stationIdPrefix: true } });
  return { designated: true as const, branchName: branch?.name ?? null, stationId: stationIdFor(ws?.stationIdPrefix, branch?.locationCode) };
}

export async function redeemStationActivation(input: {
  workspaceId: string;
  userId: string;
  stationId: unknown;
  code: unknown;
  durableDeviceId: unknown;
  appVersion?: unknown;
}): Promise<StationActivationResult & { designationBranchId: string; durableDeviceId: string }> {
  const { workspaceId, userId } = input;
  if (!isPlausibleDurableDeviceId(input.durableDeviceId)) throw new BranchInputError("This computer has no station identity. Restart VONO and try again.");
  const durableDeviceId = input.durableDeviceId.trim();
  const sid = parseStationId(input.stationId);
  if (!sid) throw new BranchInputError("Enter the Station ID exactly as shown in the Control Room (e.g. AROMA-192).");
  const code = typeof input.code === "string" ? input.code.trim() : "";
  if (!/^\d{6}$/.test(code)) throw new BranchInputError("The activation code has 6 digits.");

  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { stationIdPrefix: true } });
  if (!ws?.stationIdPrefix || ws.stationIdPrefix !== sid.prefix) throw new BranchInputError("This Station ID does not belong to your network.", 404);
  const branch = await prisma.branch.findFirst({ where: { workspaceId, locationCode: sid.number }, select: { id: true, name: true, legacyKey: true } });
  if (!branch) throw new BranchInputError("No branch has this Station ID.", 404);
  const stationId = `${sid.prefix}-${sid.number}`;

  const row = await prisma.branchActivationCode.findFirst({
    where: { workspaceId, branchId: branch.id, usedAt: null, revokedAt: null },
    orderBy: { createdAt: "desc" },
  });
  const now = new Date();
  if (!row || row.expiresAt <= now) throw new BranchInputError("There is no valid activation code for this station. Create a new code in the Control Room.", 410);
  if (row.failedAttempts >= ACTIVATION_MAX_FAILED_ATTEMPTS) throw new BranchInputError("Too many wrong codes. Create a new code in the Control Room.", 429);
  if (!activationCodeMatches(branch.id, code, row.codeHash)) {
    await prisma.branchActivationCode.update({ where: { id: row.id }, data: { failedAttempts: { increment: 1 } } });
    const left = ACTIVATION_MAX_FAILED_ATTEMPTS - row.failedAttempts - 1;
    throw new BranchInputError(left > 0 ? `Wrong activation code (${left} tries left).` : "Wrong activation code. Create a new code in the Control Room.", 403);
  }

  // Never take a computer away from another branch (the Lenovo / any designated main station elsewhere).
  const branchKeys = [branch.id, ...(branch.legacyKey ? [branch.legacyKey] : [])];
  const mine = await prisma.branchMasterDesignation.findMany({ where: { durableDeviceId }, select: { workspaceId: true, branchId: true } });
  if (mine.some((d) => d.workspaceId !== workspaceId || !branchKeys.includes(d.branchId))) {
    throw new BranchInputError("This computer is already the main station of another branch. It cannot be moved with an activation code.", 409);
  }
  const device = await prisma.stationDevice.findUnique({ where: { durableDeviceId }, select: { id: true, workspaceId: true, branchId: true } });
  if (device && device.workspaceId !== workspaceId) throw new BranchInputError("This computer is registered to another organization.", 409);

  const existing = await prisma.branchMasterDesignation.findFirst({ where: { workspaceId, branchId: { in: branchKeys } } });
  const alreadyActive = existing?.durableDeviceId === durableDeviceId;
  if (existing && !alreadyActive && row.purpose !== "replace") {
    throw new BranchInputError("This branch already has a main station. To replace it, create a new code (Replace main station) in the Control Room.", 409);
  }
  const designationBranchId = existing?.branchId ?? branch.id;
  const appVersion = typeof input.appVersion === "string" && input.appVersion.trim() ? input.appVersion.trim().slice(0, 40) : "unknown";

  await prisma.$transaction(async (tx) => {
    // single use, race-safe: only one redemption can flip usedAt
    const used = await tx.branchActivationCode.updateMany({
      where: { id: row.id, usedAt: null, revokedAt: null },
      data: { usedAt: now, usedByDurableDeviceId: durableDeviceId },
    });
    if (used.count !== 1) throw new BranchInputError("This activation code was already used. Create a new code in the Control Room.", 409);
    if (!device) {
      await tx.stationDevice.create({ data: { durableDeviceId, workspaceId, branchId: branch.id, platform: "desktop", appVersion } });
    } else if (!branchKeys.includes(device.branchId)) {
      // a NON-designated computer registered elsewhere (e.g. first sign-in under the legacy "default") moves here
      await tx.stationDevice.update({ where: { id: device.id }, data: { branchId: branch.id, zoneId: null } });
    }
    if (!existing) {
      await tx.branchMasterDesignation.create({ data: { workspaceId, branchId: designationBranchId, durableDeviceId, designatedBy: userId } });
    } else if (!alreadyActive) {
      await tx.branchMasterDesignation.update({ where: { id: existing.id }, data: { durableDeviceId, designatedBy: userId } });
    }
  });

  return { branchId: branch.id, branchName: branch.name, stationId, replaced: !!existing && !alreadyActive, alreadyActive, designationBranchId, durableDeviceId };
}
