import { NextResponse } from "next/server";
import { getSuperAdminOrNull } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { PRIVATE_BANKS } from "@/lib/music-bank/private-banks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/admin/platform/music-banks — Platform → Accounts (owner 2026-11-10/11). SUPER_ADMIN only.
 * Every account (workspace) with its chains (brands), branches, counts, last device activity and its private-bank grants,
 * plus the bank list.
 */
export async function GET() {
  const admin = await getSuperAdminOrNull();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const [workspaces, deviceCounts] = await Promise.all([
    prisma.workspace.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        slug: true,
        createdAt: true,
        owner: { select: { email: true } },
        entitlement: { select: { status: true, planCode: true, trialEndsAt: true } },
        _count: { select: { members: true, branches: true } },
        brands: { where: { archivedAt: null }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { id: true, name: true, isDefault: true, color: true } },
        branches: { orderBy: { createdAt: "asc" }, select: { id: true, name: true, brandId: true } },
        musicBankGrants: { select: { bankId: true, expiresAt: true, createdAt: true } },
      },
    }),
    prisma.device.groupBy({ by: ["workspaceId"], _count: { _all: true }, _max: { lastSeenAt: true } }),
  ]);
  const devices = new Map(deviceCounts.map((r) => [r.workspaceId, r._count._all]));
  const lastSeen = new Map(deviceCounts.map((r) => [r.workspaceId, r._max.lastSeenAt?.toISOString() ?? null]));

  return NextResponse.json(
    {
      banks: PRIVATE_BANKS.map((b) => ({
        id: b.id,
        name: b.name,
        description: b.description,
        trackCount: b.tracks.length,
        durationSeconds: Math.round(b.tracks.reduce((s, t) => s + (t.durationSeconds ?? 0), 0)),
      })),
      businesses: workspaces.map((w) => ({
        id: w.id,
        name: w.name,
        slug: w.slug,
        ownerEmail: w.owner?.email ?? null,
        createdAt: w.createdAt.toISOString(),
        status: w.entitlement?.status ?? null,
        plan: w.entitlement?.planCode ?? null,
        trialEndsAt: w.entitlement?.trialEndsAt?.toISOString() ?? null,
        users: w._count.members,
        branchCount: w._count.branches,
        devices: devices.get(w.id) ?? 0,
        lastActiveAt: lastSeen.get(w.id) ?? null,
        chains: w.brands.map((b) => ({ id: b.id, name: b.name, isDefault: b.isDefault, color: b.color })),
        branches: w.branches.map((b) => ({ id: b.id, name: b.name, chainId: b.brandId })),
        grants: w.musicBankGrants.map((g) => ({ bankId: g.bankId, expiresAt: g.expiresAt?.toISOString() ?? null, since: g.createdAt.toISOString() })),
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
