/**
 * Phase 0.2A — pure anti-drift gate for desktop_access token scope (no next/prisma imports, unit-testable).
 *
 * For multi-workspace users, the desktop_access token is minted for ONE workspace, but resolving the user by id
 * can silently fall back to their primary workspace. This gate returns the user ONLY when the token carried a
 * workspaceId AND the resolved user's active workspace equals it — i.e. the user is a validated member of the
 * token's workspace and no silent fallback occurred. Otherwise null (→ 401), never a different workspace.
 */
import type { User } from "@/lib/user-types";

export function enforceTokenWorkspaceScope(
  claims: { workspaceId: string | null } | null,
  user: User | null,
): User | null {
  if (!claims || !claims.workspaceId) return null; // desktop_access for this flow MUST carry a workspace scope
  if (!user) return null;
  if (user.tenantId !== claims.workspaceId) return null; // silent fallback / non-member → reject (no drift)
  return user;
}
