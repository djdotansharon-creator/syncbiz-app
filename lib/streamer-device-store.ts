/**
 * Persistent branch streamer device pairing (Prisma).
 */

import { prisma } from "@/lib/prisma";
import {
  DEFAULT_STREAMER_BRANCH_ID,
  PAIRING_CODE_TTL_MS,
  STREAMER_DEVICE_PURPOSE,
  generateDeviceToken,
  generatePairingCode,
  hashDeviceToken,
  normalizeDeviceId,
  normalizePairingCode,
  verifyDeviceToken,
} from "@/lib/streamer-device-auth";

export type BranchStreamerDeviceRecord = {
  id: string;
  deviceId: string;
  workspaceId: string;
  branchId: string;
  devicePurpose: string;
  branchUserId: string;
  pairedByUserId: string | null;
  label: string | null;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
};

export async function beginStreamerPairing(deviceIdRaw: unknown): Promise<{
  code: string;
  expiresAt: string;
  deviceId: string;
}> {
  const deviceId = normalizeDeviceId(deviceIdRaw);
  if (!deviceId) throw new Error("Invalid deviceId");

  const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS);
  await prisma.streamerPairingCode.deleteMany({
    where: { deviceId, consumedAt: null },
  });

  let code = generatePairingCode();
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await prisma.streamerPairingCode.create({
        data: { code, deviceId, expiresAt },
      });
      return { code, expiresAt: expiresAt.toISOString(), deviceId };
    } catch {
      code = generatePairingCode();
    }
  }
  throw new Error("Could not create pairing code");
}

export async function getStreamerPairingStatus(deviceIdRaw: unknown): Promise<{
  status: "pending" | "paired" | "expired" | "revoked";
  deviceToken?: string;
  branchId?: string;
  workspaceId?: string;
  code?: string;
  expiresAt?: string;
}> {
  const deviceId = normalizeDeviceId(deviceIdRaw);
  if (!deviceId) return { status: "expired" };

  const existing = await prisma.branchStreamerDevice.findUnique({ where: { deviceId } });
  if (existing?.revokedAt) return { status: "revoked" };

  const activePairing = await prisma.streamerPairingCode.findFirst({
    where: { deviceId },
    orderBy: { createdAt: "desc" },
  });

  if (activePairing?.consumedAt && activePairing.pendingToken && !activePairing.tokenDeliveredAt) {
    await prisma.streamerPairingCode.update({
      where: { id: activePairing.id },
      data: { tokenDeliveredAt: new Date(), pendingToken: null },
    });
    return {
      status: "paired",
      deviceToken: activePairing.pendingToken,
      branchId: activePairing.branchId ?? DEFAULT_STREAMER_BRANCH_ID,
      workspaceId: activePairing.workspaceId ?? undefined,
    };
  }

  if (existing && !existing.revokedAt) {
    return {
      status: "paired",
      branchId: existing.branchId,
      workspaceId: existing.workspaceId,
    };
  }

  if (!activePairing || activePairing.consumedAt) {
    return { status: "expired" };
  }
  if (activePairing.expiresAt.getTime() < Date.now()) {
    return { status: "expired" };
  }

  return {
    status: "pending",
    code: activePairing.code,
    expiresAt: activePairing.expiresAt.toISOString(),
  };
}

export async function claimStreamerPairing(input: {
  codeRaw: unknown;
  branchId?: string;
  label?: string;
  workspaceId: string;
  branchUserId: string;
  pairedByUserId: string;
}): Promise<{ deviceId: string; branchId: string }> {
  const code = normalizePairingCode(input.codeRaw);
  if (!code) throw new Error("Invalid pairing code");

  const branchId = (input.branchId?.trim() || DEFAULT_STREAMER_BRANCH_ID).slice(0, 64);
  const pairing = await prisma.streamerPairingCode.findUnique({ where: { code } });
  if (!pairing || pairing.consumedAt) throw new Error("Pairing code not found");
  if (pairing.expiresAt.getTime() < Date.now()) throw new Error("Pairing code expired");

  const rawToken = generateDeviceToken();
  const tokenHash = hashDeviceToken(rawToken);

  await prisma.$transaction(async (tx) => {
    await tx.branchStreamerDevice.upsert({
      where: { deviceId: pairing.deviceId },
      create: {
        deviceId: pairing.deviceId,
        tokenHash,
        workspaceId: input.workspaceId,
        branchId,
        devicePurpose: STREAMER_DEVICE_PURPOSE,
        branchUserId: input.branchUserId,
        pairedByUserId: input.pairedByUserId,
        label: input.label?.trim() || null,
        revokedAt: null,
      },
      update: {
        tokenHash,
        workspaceId: input.workspaceId,
        branchId,
        devicePurpose: STREAMER_DEVICE_PURPOSE,
        branchUserId: input.branchUserId,
        pairedByUserId: input.pairedByUserId,
        label: input.label?.trim() || null,
        revokedAt: null,
        lastSeenAt: null,
      },
    });

    await tx.streamerPairingCode.update({
      where: { id: pairing.id },
      data: {
        consumedAt: new Date(),
        workspaceId: input.workspaceId,
        branchId,
        branchUserId: input.branchUserId,
        pendingToken: rawToken,
      },
    });
  });

  return { deviceId: pairing.deviceId, branchId };
}

export async function resolveStreamerDeviceByToken(
  token: string,
): Promise<(BranchStreamerDeviceRecord & { tokenHash: string }) | null> {
  if (!token?.trim()) return null;
  const tokenHash = hashDeviceToken(token);
  const row = await prisma.branchStreamerDevice.findUnique({ where: { tokenHash } });
  if (!row || row.revokedAt) return null;
  if (!verifyDeviceToken(token, row.tokenHash)) return null;
  return row;
}

export async function touchStreamerDeviceLastSeen(deviceId: string): Promise<void> {
  await prisma.branchStreamerDevice.updateMany({
    where: { deviceId, revokedAt: null },
    data: { lastSeenAt: new Date() },
  });
}

export async function listBranchStreamerDevices(workspaceId: string): Promise<BranchStreamerDeviceRecord[]> {
  return prisma.branchStreamerDevice.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      deviceId: true,
      workspaceId: true,
      branchId: true,
      devicePurpose: true,
      branchUserId: true,
      pairedByUserId: true,
      label: true,
      lastSeenAt: true,
      revokedAt: true,
      createdAt: true,
    },
  });
}

export async function revokeBranchStreamerDevice(
  workspaceId: string,
  deviceIdRaw: unknown,
): Promise<boolean> {
  const deviceId = normalizeDeviceId(deviceIdRaw);
  if (!deviceId) return false;
  const result = await prisma.branchStreamerDevice.updateMany({
    where: { workspaceId, deviceId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count > 0;
}
