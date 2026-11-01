/**
 * The branches an APPROVED device's connection ticket may carry (server side only — it imports the branch resolver).
 *
 * Why this exists (owner 2026-11-01, PROVEN BY the cloud WS log): a browser approved as a Remote for ONE branch was refused on every connection attempt (close 4004 "Branch not authorized", every few seconds, for hours) and
 * so never connected — it fell back to playing on its own. The ticket's list was `restrictBranches(authorized, approved)` = just the approved branch's id, but every browser still REGISTERs "default" (the legacy name of the
 * workspace's main branch — lib/branch-resolver.ts), and "default" is not in a list that only names that same branch by its real id. "default" and the workspace's canonical branch ARE the same branch (`legacyBranchEquivalents`),
 * so approving the one approves the other: this keeps the alias in the narrowed list when — and only when — its branch is approved. It never adds a branch that was not approved.
 */

import { restrictBranches } from "@/lib/device-enrollment";
import { legacyBranchEquivalents } from "@/lib/branch-resolver";

/** `authorized` = what the user may reach; `approved` = what the manager approved for the device (empty = no extra narrowing); `canonicalDefault` = the workspace's real id for "default" (null when it has none). */
export function narrowBranchClaim(authorized: readonly string[], approved: readonly string[], canonicalDefault: string | null): string[] {
  return restrictBranches(authorized, approved.flatMap((id) => legacyBranchEquivalents(id, canonicalDefault)));
}
