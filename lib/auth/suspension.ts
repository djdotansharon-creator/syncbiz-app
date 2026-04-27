/**
 * Server-only suspension enforcement for V1 SaaS Week 3.
 *
 * Single chokepoint for "is this user's workspace currently suspended,
 * and should we redirect them to /suspended?". The whole feature is
 * gated behind `SYNCBIZ_ENFORCE_SUSPENSION === "1"` so it ships dark
 * by default and can be flipped on per-environment without code changes.
 *
 * Design notes:
 * - We re-resolve the platform `role` for each call (cheap — one indexed
 *   `User.findUnique`) so SUPER_ADMIN bypass survives even if a stale
 *   `User` snapshot is passed in. The platform owner must NEVER be
 *   redirected to /suspended; otherwise they can't reach /admin/platform
 *   to lift the suspension.
 * - We deliberately do NOT enforce on API routes here — Week 3 scope is
 *   "the suspended/contact-support page shown to all workspace members
 *   when they navigate to the workspace" (V1 plan). API gating is a
 *   later week. Saved-session API calls will still succeed; UI flows
 *   are the only thing this helper blocks.
 * - The helper returns metadata (workspace name, suspendedAt) so the
 *   /suspended page can render a meaningful message without doing its
 *   own DB lookup.
 */

import "server-only";

import { prisma } from "@/lib/prisma";
import type { User } from "@/lib/user-types";

const ENFORCEMENT_ENV = "SYNCBIZ_ENFORCE_SUSPENSION";

export type ActiveSuspension = {
  workspaceId: string;
  workspaceName: string;
  suspendedAt: Date | null;
  /**
   * Internal-only — do NOT render this in the user-facing /suspended page.
   * Useful for logging/diagnostics on the server.
   */
  internalReason: string | null;
};

/**
 * `true` iff `SYNCBIZ_ENFORCE_SUSPENSION` is exactly the string "1".
 *
 * We accept only "1" (not "true", not "yes") to keep the contract with
 * deployment configs unambiguous and to match the existing pattern used
 * by `SYNCBIZ_OWNER_EMAILS` and similar feature toggles.
 */
export function isSuspensionEnforcementEnabled(): boolean {
  return process.env[ENFORCEMENT_ENV] === "1";
}

/**
 * Resolve whether the given user's workspace is currently suspended in a
 * way that should block UI access. Returns `null` (no enforcement) if any
 * of these is true:
 *
 *   - The feature flag is not "1".
 *   - The user is `SUPER_ADMIN` (platform owner — must always reach /admin).
 *   - The user has no `tenantId` (defensive — should not happen for an
 *     authenticated app session, but if it does we don't want to redirect).
 *   - The workspace has no `WorkspaceEntitlement` row yet (Week 1 backfill
 *     created entitlements for all existing workspaces, but a fresh
 *     migration on a foreign DB might lack them — in that case we fail
 *     open rather than locking everyone out).
 *   - The entitlement status is anything other than "SUSPENDED".
 *
 * Returns the suspension metadata if and only if every one of those
 * checks comes back negative.
 */
export async function getActiveSuspensionForUser(
  user: Pick<User, "id" | "tenantId">,
): Promise<ActiveSuspension | null> {
  if (!isSuspensionEnforcementEnabled()) return null;
  if (!user.tenantId?.trim()) return null;

  // SUPER_ADMIN bypass — re-read role from DB so a stale `user` object
  // can't accidentally hand a SUPER_ADMIN a /suspended page. The query is
  // a single indexed lookup; the cost is negligible vs. the safety win.
  const platformRow = await prisma.user.findUnique({
    where: { id: user.id },
    select: { role: true },
  });
  if (platformRow?.role === "SUPER_ADMIN") return null;

  const workspace = await prisma.workspace.findUnique({
    where: { id: user.tenantId },
    select: {
      id: true,
      name: true,
      entitlement: {
        select: {
          status: true,
          suspendedAt: true,
          suspendedReason: true,
        },
      },
    },
  });
  if (!workspace) return null;
  if (!workspace.entitlement) return null;
  if (workspace.entitlement.status !== "SUSPENDED") return null;

  return {
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    suspendedAt: workspace.entitlement.suspendedAt,
    internalReason: workspace.entitlement.suspendedReason,
  };
}
