/**
 * Shared helpers for media resource branch scoping.
 * Used by sources, playlists, and radio to resolve branch ownership and apply consistent access checks.
 *
 * Legacy fallback: Records without branchId are treated as "default" branch.
 * OWNER can access all. BRANCH_USER needs "default" in assigned branches to access legacy records.
 */

const DEFAULT_BRANCH_ID = "default";

/** Resource with optional branchId (legacy records may lack it). */
export type HasBranchId = { branchId?: string | null };

/**
 * Resolve branch ownership for a media resource.
 * Legacy unscoped records (no branchId) default to "default" branch.
 */
export function resolveMediaBranchId(item: HasBranchId): string {
  const bid = item?.branchId;
  if (typeof bid === "string" && bid.trim().length > 0) {
    return bid.trim();
  }
  return DEFAULT_BRANCH_ID;
}
