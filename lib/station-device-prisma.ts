/**
 * Phase 0.2A — Prisma-backed StationDevice repo (the only DB-touching part of station-device registration).
 * Kept separate from the pure algorithm in `lib/station-device-store.ts` so that core can be tested without a DB.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
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

/** Register against the real Prisma-backed repo. */
export function registerStationDeviceWithPrisma(input: RegisterStationDeviceInput): Promise<RegisterResult> {
  return registerStationDevice(prismaStationDeviceRepo, input);
}
