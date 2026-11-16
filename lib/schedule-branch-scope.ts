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
