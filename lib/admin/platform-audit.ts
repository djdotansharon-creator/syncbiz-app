/**
 * Platform-scope audit log helpers.
 *
 * Wraps `prisma.platformAuditLog.create` with a typed action union and a
 * one-place IP extractor so every `/admin/platform` write site logs
 * consistently. Workspace-scoped admin actions (Access Control, etc.) use
 * the separate workspace-scoped `AuditLog` table — do not mix the two.
 *
 * V1 contract: every write to `WorkspaceEntitlement` driven by a
 * SUPER_ADMIN must call this helper inside the same transaction so the
 * state change and the audit row commit atomically.
 */

import "server-only";

import type { Prisma } from "@prisma/client";

/**
 * Closed set of V1 platform admin actions. Adding a new action means
 * adding a string here so unrelated code can't write opaque values.
 */
export type PlatformAuditAction =
  | "workspace.suspend"
  | "workspace.unsuspend"
  | "entitlement.extend_trial";

export type PlatformAuditInput = {
  action: PlatformAuditAction;
  actorUserId: string;
  targetWorkspaceId: string;
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string | null;
};

/**
 * Pull a single client IP from the standard proxy headers. Order matches
 * what most reverse proxies set (Vercel/Railway/Cloudflare/etc.).
 * Returns `null` if nothing usable is present — never throws.
 */
export function extractClientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real?.trim()) return real.trim();
  return null;
}

/**
 * Insert one PlatformAuditLog row. Accepts either the global Prisma client
 * or a transaction client (`tx`) — pass `tx` when you want the audit row
 * to commit atomically with a state change in the same transaction.
 */
export async function writePlatformAuditLog(
  client: Prisma.TransactionClient | typeof import("@/lib/prisma").prisma,
  input: PlatformAuditInput,
): Promise<void> {
  await client.platformAuditLog.create({
    data: {
      action: input.action,
      actorUserId: input.actorUserId,
      targetWorkspaceId: input.targetWorkspaceId,
      metadata: input.metadata ?? undefined,
      ipAddress: input.ipAddress ?? null,
    },
  });
}
