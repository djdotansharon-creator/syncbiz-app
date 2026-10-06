/**
 * Phase 0.2A — Prisma-backed StationDevice repo (the only DB-touching part of station-device registration).
 * Kept separate from the pure algorithm in `lib/station-device-store.ts` so that core can be tested without a DB.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCanonicalLegacyBranchId, legacyBranchEquivalent } from "@/lib/branch-resolver";
import {
  DurableDeviceConflictError,
  registerStationDevice,
  type RegisterResult,
  type RegisterStationDeviceInput,
  type StationDeviceRepo,
} from "@/lib/station-device-store";

/** create() maps a P2002 unique violation on durableDeviceId to DurableDeviceConflictError. */
export const prismaStationDeviceRepo: StationDeviceRepo = {
  async create(input) {
    try {
      await prisma.stationDevice.create({ data: input });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new DurableDeviceConflictError();
      }
      throw e;
    }
  },
  async findByDurableId(durableDeviceId) {
    return prisma.stationDevice.findUnique({
      where: { durableDeviceId },
      select: { workspaceId: true, branchId: true },
    });
  },
  async refresh(durableDeviceId, match, patch) {
    // Guarded by the full match so a concurrent change can't be clobbered; lastSeenAt bumps via @updatedAt.
    await prisma.stationDevice.updateMany({
      where: { durableDeviceId, workspaceId: match.workspaceId, branchId: match.branchId },
      data: { platform: patch.platform, appVersion: patch.appVersion },
    });
  },
};

/**
 * Register against the real Prisma-backed repo. Gate 2A-1: a legacy "default" request and a row stored under the
 * workspace's canonical alias (or vice versa) are the SAME binding — so neither side yields branch_conflict and the
 * stored row is never moved. Any other branch mismatch still conflicts.
 */
export async function registerStationDeviceWithPrisma(input: RegisterStationDeviceInput): Promise<RegisterResult> {
  const canonical = await getCanonicalLegacyBranchId(input.workspaceId);
  return registerStationDevice(prismaStationDeviceRepo, input, {
    isSameBranch: (stored, requested) => legacyBranchEquivalent(stored, requested, canonical),
  });
}
