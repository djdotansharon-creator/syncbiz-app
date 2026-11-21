/**
 * The rows (lanes) of the Studio's day view and the branch a new block is stamped with. PURE. (2026-11-22)
 *
 * Field test 2026-11-21: on the Lenovo (branch Lenovo-Pailot) the Studio showed ONE row — the branches that already had blocks — so there was no row to schedule THIS computer's own
 * branch on, and a dropped playlist was stamped with the playlist's own branch ("default"), where the Lenovo never looks. Now this window's own branch always has a row, and a playlist dropped
 * on a row is stamped with THAT row's branch (the server decides whether that playlist may play there: lib/schedule-branch-use.ts).
 */

/** every branch that has blocks, plus this window's own branch (so there is always a row to schedule it on), sorted by name */
export function laneBranchIds(i: {
  blockBranches: string[];
  stationBranch: string | null | undefined;
  /** the business's real branches (the window's own branch is added only when it is one of them, or the legacy "default") */
  knownBranchIds: string[];
  nameOf: (id: string) => string;
}): string[] {
  const set = new Set(i.blockBranches.map((b) => (b ?? "").trim() || "default"));
  const own = (i.stationBranch ?? "").trim();
  if (own && (own === "default" || i.knownBranchIds.includes(own))) set.add(own);
  return Array.from(set).sort((a, b) => i.nameOf(a).localeCompare(i.nameOf(b)));
}

/** the branch a NEW block is stamped with */
export function blockBranchFor(i: { targetType: string; laneBranch?: string; itemBranch: string; quietBranch: string }): string {
  if (i.targetType === "SILENCE" || i.targetType === "BANK") return i.laneBranch ?? i.quietBranch; // a quiet / bank block belongs to the row it was added in
  if (i.targetType === "PLAYLIST") return i.laneBranch ?? i.itemBranch; // 2026-11-22: a playlist dropped on a row belongs to THAT row's branch
  return i.itemBranch; // a song / a radio station: unchanged (its own branch)
}
