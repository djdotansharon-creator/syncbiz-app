/**
 * Which schedules a window runs — PURE (no I/O).
 *
 * Owner 2026-11-15: "when I set the schedule of one player it affects all the other players". ROOT CAUSE (PROVEN BY TEST): `ScheduleAutoPlayer` runs in EVERY open window of the
 * account and used to fetch ALL schedules and start the block that began last, whatever branch the block belonged to — so a block of branch B started on branch A's player
 * (and a quiet / closing block of one branch stopped every player). A window now runs only the schedules of the branch it plays for / controls.
 *
 * Fail-open on purpose (the accepted single-branch pilot must behave EXACTLY as before): a schedule whose branch is not a real branch of this business — an orphan, or the legacy
 * key "default" in a business that has no canonical branch for it — is still run, as it always was. Only a block that clearly belongs to a DIFFERENT real branch is dropped.
 */
const LEGACY_KEY = "default";

/** the legacy key "default" is the business's canonical branch when it has one (same-business alias only); anything else is kept as is */
function canon(id: string | null | undefined, canonical: string | null): string {
  const x = (id ?? "").trim() || LEGACY_KEY;
  return x === LEGACY_KEY && canonical ? canonical : x;
}

export function schedulesForBranch<T extends { branchId?: string | null }>(
  all: T[],
  wantedBranch: string,
  ctx: { canonicalDefaultBranchId: string | null; knownBranchIds: ReadonlySet<string> },
): T[] {
  const wanted = canon(wantedBranch, ctx.canonicalDefaultBranchId);
  return all.filter((s) => {
    const mine = canon(s.branchId, ctx.canonicalDefaultBranchId);
    return mine === wanted || !ctx.knownBranchIds.has(mine);
  });
}

/**
 * One line that says WHICH branch's schedule a window follows and how many blocks that is — written to the log when it changes (2026-11-18 audit, F2). Since 2026-11-16 a window runs only its own
 * branch's blocks (`schedulesForBranch`); a block stored under another branch silently never starts here, and nothing said so. `otherBranches` = how many of this business's blocks the server left out
 * because they belong to another branch (null = an older server that does not say). PURE.
 */
export function scheduleScopeNote(i: { branch: string; blocks: number; enabled: boolean; otherBranches: number | null }): string | null {
  if (i.otherBranches === null) return null;
  const head = `this station follows branch "${i.branch}": ${i.blocks} block(s), schedule switch ${i.enabled ? "ON" : "OFF"}`;
  if (i.otherBranches <= 0) return head;
  const warn = i.blocks === 0 && i.enabled ? "NOTHING WILL START FROM THE SCHEDULE here — " : "";
  return `${warn}${head}; ${i.otherBranches} other block(s) of this business belong to other branches and do not run here`;
}
