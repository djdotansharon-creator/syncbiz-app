/**
 * THE STUDIO SHOWS THE SCHEDULE OF THIS COMPUTER'S BRANCH, AND ONLY THAT. PURE. (2026-11-22)
 *
 * Field test 2026-11-21: on the Lenovo (branch Lenovo-Pailot) the Studio showed the blocks of EVERY branch — a "Default" row full of blocks that do not run on the Lenovo — and a block
 * made from a playlist of another branch was stamped with that branch, so it never ran there either. Owner 2026-11-22: "the schedule is the computer's (branch's) own — one column
 * per day, no Default row; managing a whole network belongs in the Control Room (not built yet)".
 *
 * So the Studio loads exactly what THIS window's branch runs — the engine's own rule (lib/schedule-branch-scope.ts `schedulesForBranch`: this branch's blocks, the legacy "default" alias,
 * and orphans) — and a new block is stamped with this branch. `?branches=all` in the address brings the old all-branches view back (a support escape hatch, not a feature).
 */
import { schedulesForBranch } from "./schedule-branch-scope";

export type StudioScopeInput<T extends { branchId?: string | null }> = {
  all: T[];
  /** this window's own branch; null = not known yet (the desktop's answer is pending) */
  ownBranch: string | null;
  canonicalDefaultBranchId: string | null;
  knownBranchIds: string[];
  /** `?branches=all` */
  showAllBranches: boolean;
};

/** the blocks the Studio shows; `scoped` says whether the view is limited to this branch */
export function studioItems<T extends { branchId?: string | null }>(i: StudioScopeInput<T>): { items: T[]; scoped: boolean } {
  if (i.showAllBranches) return { items: i.all, scoped: false };
  if (i.ownBranch === null) return { items: [], scoped: true }; // the desktop has not said which branch this computer is: nothing is drawn for a moment, never another branch's blocks
  return {
    items: schedulesForBranch(i.all, i.ownBranch, { canonicalDefaultBranchId: i.canonicalDefaultBranchId, knownBranchIds: new Set(i.knownBranchIds) }),
    scoped: true,
  };
}

/** the branch a NEW block is stamped with */
export function blockBranchFor(i: { targetType: string; laneBranch?: string; scopeBranch?: string; itemBranch: string; quietBranch: string }): string {
  if (i.targetType === "SILENCE" || i.targetType === "BANK") return i.laneBranch ?? i.scopeBranch ?? i.quietBranch; // a quiet / bank block belongs to the row it was added in, else this branch
  if (i.targetType === "PLAYLIST") return i.laneBranch ?? i.scopeBranch ?? i.itemBranch; // a playlist dropped on a row, else this computer's branch (the server says whether it may play there)
  return i.scopeBranch ?? i.itemBranch; // a song / a radio station: this computer's branch (the server refuses another branch's, saying so) — all-branches view: its own, as before
}
