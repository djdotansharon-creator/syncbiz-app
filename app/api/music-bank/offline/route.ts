import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromCookies, hasTenantAdminRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { liveBankIdsForWorkspace } from "@/lib/music-bank/bank-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * PUT /api/music-bank/offline — the catalog's OFFLINE switch for one private bank (owner 2026-11-11, Music Bank Phase 2
 * stage D). Body: { bankId, offline: boolean }. For the signed-in person's own business, business owners / admins only,
 * and only for a bank that is open to that business right now. On → its stations download the songs quietly, encrypted;
 * off → they delete their copies (the station's next sync; the offline manifest lists only switched-on banks).
 */
export async function PUT(req: NextRequest) {
  const user = await getCurrentUserFromCookies();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  if (!(await hasTenantAdminRole(user.id, user.tenantId ?? null))) return NextResponse.json({ error: "Only the business owner or an admin can change Offline." }, { status: 403 });
  const workspaceId = user.tenantId ?? null;
  if (!workspaceId) return NextResponse.json({ error: "No business selected." }, { status: 400 });

  let body: { bankId?: unknown; offline?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.bankId !== "string" || typeof body.offline !== "boolean") return NextResponse.json({ error: "bankId and offline are required" }, { status: 400 });
  const open = await liveBankIdsForWorkspace(workspaceId, "catalog");
  if (!open.includes(body.bankId)) return NextResponse.json({ error: "This bank is not open to your business." }, { status: 404 });

  await prisma.musicBankGrant.update({ where: { workspaceId_bankId: { workspaceId, bankId: body.bankId } }, data: { offlineEnabled: body.offline } });
  return NextResponse.json({ ok: true, bankId: body.bankId, offline: body.offline });
}
