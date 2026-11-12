import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromCookies, hasTenantAdminRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { isOfflineEntitled, offlineInfoForStation } from "@/lib/music-bank/offline-manifest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The catalog's OFFLINE switch — PER COMPUTER, PER BANK (owner 2026-11-12: "only the bank I click downloads; each computer
 * on its own — switching Offline on must not make every branch of the chain do the same").
 *
 * The computer is the station the VONO app runs on (its durable id, read from the desktop bridge); it must be a registered
 * StationDevice of the signed-in person's business. A browser has no computer → it only sees the switches (all off).
 *
 *  GET ?deviceId=… → { canToggle, deviceKnown, banks: { [bankId]: { enabled, bytes } } } for every bank this business may
 *                    keep offline right now (private banks with a live grant + the Royalty-Free demo packs).
 *  PUT { bankId, offline, deviceId } → on: that computer downloads the bank quietly, encrypted; off: it deletes its copies
 *                    (its next sync). Business owners / admins only; only an entitled bank.
 */
async function ownStation(workspaceId: string, deviceId: string | null): Promise<boolean> {
  if (!deviceId) return false;
  const s = await prisma.stationDevice.findUnique({ where: { durableDeviceId: deviceId }, select: { workspaceId: true } });
  return !!s && s.workspaceId === workspaceId;
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUserFromCookies();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const workspaceId = user.tenantId ?? null;
  if (!workspaceId) return NextResponse.json({ canToggle: false, deviceKnown: false, banks: {} }, { headers: { "Cache-Control": "no-store" } });
  const raw = req.nextUrl.searchParams.get("deviceId")?.trim() || null;
  const deviceKnown = await ownStation(workspaceId, raw);
  const [banks, admin] = await Promise.all([
    offlineInfoForStation(workspaceId, deviceKnown ? raw : null),
    hasTenantAdminRole(user.id, workspaceId),
  ]);
  return NextResponse.json({ canToggle: admin && deviceKnown, deviceKnown, banks }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(req: NextRequest) {
  const user = await getCurrentUserFromCookies();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  if (!(await hasTenantAdminRole(user.id, user.tenantId ?? null))) return NextResponse.json({ error: "Only the business owner or an admin can change Offline." }, { status: 403 });
  const workspaceId = user.tenantId ?? null;
  if (!workspaceId) return NextResponse.json({ error: "No business selected." }, { status: 400 });

  let body: { bankId?: unknown; offline?: unknown; deviceId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.bankId !== "string" || typeof body.offline !== "boolean" || typeof body.deviceId !== "string" || !body.deviceId.trim()) {
    return NextResponse.json({ error: "bankId, offline and deviceId are required" }, { status: 400 });
  }
  const deviceId = body.deviceId.trim();
  if (!(await ownStation(workspaceId, deviceId))) return NextResponse.json({ error: "This computer is not registered to your business." }, { status: 404 });
  if (!(await isOfflineEntitled(workspaceId, body.bankId))) return NextResponse.json({ error: "This bank is not open to your business." }, { status: 404 });

  if (body.offline) {
    await prisma.stationOfflineBank.upsert({
      where: { durableDeviceId_bankId: { durableDeviceId: deviceId, bankId: body.bankId } },
      create: { workspaceId, durableDeviceId: deviceId, bankId: body.bankId, createdByUserId: user.id },
      update: {},
    });
  } else {
    await prisma.stationOfflineBank.deleteMany({ where: { durableDeviceId: deviceId, bankId: body.bankId } });
  }
  return NextResponse.json({ ok: true, bankId: body.bankId, offline: body.offline });
}
