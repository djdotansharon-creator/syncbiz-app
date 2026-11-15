/**
 * CONTROL ROOM — which people are "under" one branch (owner 2026-11-15). Pure (no React, no fetch) so the screen and the test share ONE rule.
 *   assigned    — members (not owner / manager) the business gave THIS branch (UserBranchAssignment, read through /api/admin/users)
 *   everyBranch — owners and managers (and anyone whose access type is OWNER): they reach every branch, so they are listed apart, never as "assigned"
 * Someone who is neither (a member with no branches, or with other branches only) is in neither list. Order: people who can sign in first, a paused / disabled
 * person last, then by name.
 */

export type BranchPersonLevel = "owner" | "manager" | "member";
export type BranchPersonStatus = "active" | "paused" | "disabled";

export type BranchPersonBase = { email: string; name: string; level: BranchPersonLevel; status: BranchPersonStatus };
export type BranchAccountBase = { email: string; accessType: "OWNER" | "BRANCH_USER"; branchIds: string[] };

export function splitBranchPeople<P extends BranchPersonBase>(people: readonly P[], accounts: readonly BranchAccountBase[], branchId: string): { assigned: P[]; everyBranch: P[] } {
  const byEmail = new Map(accounts.map((a) => [a.email.trim().toLowerCase(), a]));
  const order = (a: P, b: P) => Number(a.status !== "active") - Number(b.status !== "active") || a.name.localeCompare(b.name);
  const assigned: P[] = [];
  const everyBranch: P[] = [];
  for (const p of people) {
    const acc = byEmail.get(p.email.trim().toLowerCase());
    if (p.level !== "member" || acc?.accessType === "OWNER") everyBranch.push(p);
    else if (acc?.accessType === "BRANCH_USER" && acc.branchIds.includes(branchId)) assigned.push(p);
  }
  return { assigned: assigned.sort(order), everyBranch: everyBranch.sort(order) };
}
