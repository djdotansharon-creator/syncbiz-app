/**
 * Tenant-scoped audit log reader for Access Control.
 *
 * GET /api/admin/audit
 *  - Requires `requireAdmin` (`TENANT_OWNER` or `TENANT_ADMIN`) — the same
 *    gate as the rest of `/api/admin/users/*`.
 *  - Returns the most recent rows from `AuditLog` for the acting admin's
 *    workspace, joined with actor + target user info.
 *
 * Querystring filters (all optional, server-side validated):
 *  - `action=<TenantAuditAction>` — exact match against the closed enum.
 *  - `targetUserId=<uuid>` — restrict to a single target.
 *  - `limit=<n>` — clamped to [1, 200]. Default 100.
 *
 * Pagination is intentionally simple. Pilot volume is single-digit per
 * week; if/when it grows, swap for cursor-based paging by `createdAt,id`.
 */

import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { requireAdmin } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { TENANT_AUDIT_ACTIONS } from "@/lib/admin/tenant-audit";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;

export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!admin.tenantId?.trim()) {
    return NextResponse.json({ error: "Admin tenant context missing" }, { status: 400 });
  }

  const ws = await prisma.workspace.findFirst({
    where: { OR: [{ id: admin.tenantId.trim() }, { slug: admin.tenantId.trim() }] },
    select: { id: true },
  });
  if (!ws) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const url = new URL(req.url);
  const actionParam = url.searchParams.get("action");
  const targetUserIdParam = url.searchParams.get("targetUserId");
  const limitParam = url.searchParams.get("limit");

  const where: Prisma.AuditLogWhereInput = { workspaceId: ws.id };
  if (actionParam && (TENANT_AUDIT_ACTIONS as readonly string[]).includes(actionParam)) {
    where.action = actionParam;
  }
  if (targetUserIdParam && targetUserIdParam.trim().length > 0) {
    where.entityId = targetUserIdParam.trim();
  }

  let limit = DEFAULT_LIMIT;
  if (limitParam) {
    const parsed = Number.parseInt(limitParam, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      limit = Math.min(MAX_LIMIT, parsed);
    }
  }

  const events = await prisma.auditLog.findMany({
    where,
    include: {
      user: { select: { id: true, email: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  // Resolve target user emails in a single round-trip rather than including
  // a relation we don't have on AuditLog (entityId is a free-form string,
  // not a typed FK in the schema).
  const targetIds = Array.from(
    new Set(events.map((ev) => ev.entityId).filter((s): s is string => typeof s === "string" && s.length > 0)),
  );
  const targets =
    targetIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: targetIds } },
          select: { id: true, email: true, name: true },
        })
      : [];
  const targetById = new Map(targets.map((u) => [u.id, u]));

  return NextResponse.json(
    events.map((ev) => ({
      id: ev.id,
      action: ev.action,
      entity: ev.entity,
      createdAt: ev.createdAt.toISOString(),
      ipAddress: ev.ipAddress,
      metadata: ev.metadata,
      actor: ev.user
        ? { id: ev.user.id, email: ev.user.email, name: ev.user.name }
        : null,
      target:
        ev.entityId && targetById.has(ev.entityId)
          ? targetById.get(ev.entityId)
          : ev.entityId
            ? { id: ev.entityId, email: null, name: null }
            : null,
    })),
    { status: 200 },
  );
}
