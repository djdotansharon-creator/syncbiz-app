/**
 * Derives effective API content scope from auth + surface (pathname + mobile role).
 * Keeps branch station flows on `branch` and OWNER mobile personal player on `owner_personal`.
 */

import type { AccessType } from "@/lib/user-types";
import type { ApiContentScope } from "@/lib/content-scope-filters";

export type MobileSurfaceRole = "controller" | "player";

/**
 * Unified sources + playlist list scope for /mobile.
 * - Controller → branch (remote sends to station; library is branch).
 * - Player + OWNER → owner personal bank.
 * - Player + BRANCH_USER → branch (same catalog as today).
 */
export function resolveMobileUnifiedScope(
  accessType: AccessType,
  mobileRole: MobileSurfaceRole
): ApiContentScope {
  if (mobileRole === "controller") return "branch";
  if (accessType === "OWNER") return "owner_personal";
  return "branch";
}
