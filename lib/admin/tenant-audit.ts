/**
 * Workspace-scoped audit log helpers.
 *
 * Wraps `prisma.auditLog.create` with a typed action union and a
 * one-place IP extractor so every Access Control / tenant-admin write site
 * logs consistently. Distinct from `PlatformAuditLog` (super-admin actions
 * across the entire platform — see `lib/admin/platform-audit.ts`); the two
 * tables are intentionally separate so tenant owners cannot read platform
 * activity and platform admins can audit globally without filtering by
 * workspace.
 *
 * V1 contract: every state-changing route under `/api/admin/users/*` (and
 * the platform `remove-member` drill-down that targets a workspace
 * membership) must call this helper inside the same transaction, or
 * immediately after the state change when no transaction wraps the write.
 */

import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Closed set of V1 tenant-admin actions. Adding a new action means adding
 * a string here so unrelated code can't write opaque values.
 *
 * Naming convention: `<entity>.<verb>`. The reader UI groups by the prefix
 * when filtering, so keep the entity stable.
 */
export type TenantAuditAction =
  | "member.create"
  | "member.invite"
  | "member.update"
  | "member.password_set"
  | "member.pause"
  | "member.resume"
  | "member.remove"
  | "member.global_disable"
  | "member.platform_remove";

export const TENANT_AUDIT_ACTIONS: readonly TenantAuditAction[] = [
  "member.create",
  "member.invite",
  "member.update",
  "member.password_set",
  "member.pause",
  "member.resume",
  "member.remove",
  "member.global_disable",
  "member.platform_remove",
];

/**
 * Entity tag for `AuditLog.entity`. Today every tenant action is a member
 * mutation, but keeping this typed lets us add `branch`, `playlist`, etc.
 * later without a schema change.
 */
export type TenantAuditEntity = "workspace_member";

export type TenantAuditInput = {
  action: TenantAuditAction;
  /** Acting user. Required by the schema (`onDelete: Restrict`). */
  actorUserId: string;
  workspaceId: string;
  /** Target user id (membership target). */
  targetUserId: string;
  /** Free-form details: target email, role changes, branch diffs, etc. */
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string | null;
  /** Defaults to `"workspace_member"`. */
  entity?: TenantAuditEntity;
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
 * Insert one tenant-scoped `AuditLog` row. Accepts either the global Prisma
 * client or a transaction client (`tx`) — pass `tx` when you want the audit
 * row to commit atomically with a state change in the same transaction.
 *
 * Failures are logged but never thrown: audit logging must not break user
 * actions. Critical state changes that *require* atomic audit (e.g. payment-
 * adjacent ones if ever added) should pass `tx` so the surrounding
 * transaction rolls back if the insert fails.
 */
export async function writeTenantAuditLog(
  client: Prisma.TransactionClient | typeof prisma,
  input: TenantAuditInput,
): Promise<void> {
  // Discriminate transactional vs. global client by `$transaction` (only
  // present on the global PrismaClient). Inside a transaction we must
  // re-throw so the wrapping transaction rolls back; outside we swallow so
  // an audit failure does not break the user-visible state change.
  const isTransactional = !("$transaction" in client);
  try {
    await client.auditLog.create({
      data: {
        action: input.action,
        entity: input.entity ?? "workspace_member",
        entityId: input.targetUserId,
        userId: input.actorUserId,
        workspaceId: input.workspaceId,
        ipAddress: input.ipAddress ?? null,
        metadata: input.metadata ?? undefined,
      },
    });
  } catch (e) {
    if (isTransactional) throw e;
    console.error("[tenant-audit] write failed", {
      action: input.action,
      workspaceId: input.workspaceId,
      targetUserId: input.targetUserId,
      err: e instanceof Error ? e.message : String(e),
    });
  }
}
