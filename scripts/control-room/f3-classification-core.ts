/**
 * CONTROL ROOM F3a — location classification check + optional locationCode backfill (TEST-only tooling core; OFFLINE).
 *
 * check: canonical codes, at most one region per location from the SAME workspace, memberships / assignments inside
 *        their workspace (also DB-enforced by composite FKs), locationCode uniqueness (DB-enforced), no TAG anywhere in
 *        MemberScopeTarget, REGION / GROUP scope values inside their workspace.
 * backfillLocationCode: copy Branch.code → locationCode ONLY when locationCode is NULL and code is non-empty, not a
 *        generic legacy value (DEFAULT / BRANCH) and unique inside its workspace. Never creates regions / groups / tags.
 *        Idempotent (a second run is a no-op). NOT to be run on TEST until the deploy freeze is lifted.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export const CANONICAL_CODE = /^[A-Z][A-Z0-9_]{0,39}$/;
const GENERIC_CODES = new Set(["", "DEFAULT", "BRANCH"]);

export async function checkClassification(db: Db): Promise<{ ok: boolean; violations: string[]; facts: Record<string, number> }> {
  const v: string[] = [];
  const [branches, regions, groups, tags, gm, ta] = await Promise.all([
    db.branch.findMany({ select: { id: true, workspaceId: true, regionId: true, locationCode: true } }),
    db.region.findMany({ select: { id: true, workspaceId: true, code: true } }),
    db.locationGroup.findMany({ select: { id: true, workspaceId: true, code: true } }),
    db.locationTag.findMany({ select: { id: true, workspaceId: true, code: true } }),
    db.locationGroupMember.findMany({ select: { groupId: true, branchId: true, workspaceId: true } }),
    db.locationTagAssignment.findMany({ select: { tagId: true, branchId: true, workspaceId: true } }),
  ]);
  const ws = (rows: { id: string; workspaceId: string }[]) => new Map(rows.map((r) => [r.id, r.workspaceId]));
  const bW = ws(branches), rW = ws(regions), gW = ws(groups), tW = ws(tags);
  for (const x of [...regions, ...groups, ...tags]) if (!CANONICAL_CODE.test(x.code)) v.push(`non-canonical code ${x.code}`);
  for (const b of branches) if (b.regionId && rW.get(b.regionId) !== b.workspaceId) v.push(`branch ${b.id}: region of another workspace`);
  for (const m of gm) if (gW.get(m.groupId) !== m.workspaceId || bW.get(m.branchId) !== m.workspaceId) v.push(`group membership ${m.groupId}/${m.branchId}: crosses workspaces`);
  for (const a of ta) if (tW.get(a.tagId) !== a.workspaceId || bW.get(a.branchId) !== a.workspaceId) v.push(`tag assignment ${a.tagId}/${a.branchId}: crosses workspaces`);
  const seen = new Set<string>();
  for (const b of branches) if (b.locationCode) { const k = `${b.workspaceId}|${b.locationCode}`; if (seen.has(k)) v.push(`duplicate locationCode ${b.locationCode}`); seen.add(k); }
  const tagCols: { n: number }[] = await db.$queryRawUnsafe(`select count(*)::int as n from information_schema.columns where table_name = 'MemberScopeTarget' and column_name ilike '%tag%'`);
  if (Number(tagCols[0]?.n ?? 0) !== 0) v.push("MemberScopeTarget has a tag column (a Tag must never be a permission dimension)");
  const tagDims: { n: number }[] = await db.$queryRawUnsafe(`select count(*)::int as n from "MemberScopeTarget" where "dimension" = 'TAG'`);
  if (Number(tagDims[0]?.n ?? 0) !== 0) v.push("MemberScopeTarget rows with dimension TAG");
  const st: { workspaceId: string; regionId: string | null; groupId: string | null }[] = await db.memberScopeTarget.findMany({ where: { OR: [{ regionId: { not: null } }, { groupId: { not: null } }] }, select: { workspaceId: true, regionId: true, groupId: true } });
  for (const t of st) {
    if (t.regionId && rW.get(t.regionId) !== t.workspaceId) v.push("REGION scope value outside its workspace");
    if (t.groupId && gW.get(t.groupId) !== t.workspaceId) v.push("GROUP scope value outside its workspace");
  }
  return {
    ok: v.length === 0,
    violations: v,
    facts: { branches: branches.length, regions: regions.length, groups: groups.length, tags: tags.length, groupMembers: gm.length, tagAssignments: ta.length, withRegion: branches.filter((b: { regionId: string | null }) => b.regionId).length, withLocationCode: branches.filter((b: { locationCode: string | null }) => b.locationCode).length },
  };
}

export async function backfillLocationCode(db: Db, { dryRun }: { dryRun: boolean }): Promise<{ dryRun: boolean; set: number; skipped: Record<string, number>; noop: boolean }> {
  const rows: { id: string; workspaceId: string; code: string; locationCode: string | null }[] = await db.branch.findMany({ select: { id: true, workspaceId: true, code: true, locationCode: true }, orderBy: { id: "asc" } });
  const skipped: Record<string, number> = {};
  const skip = (k: string) => { skipped[k] = (skipped[k] ?? 0) + 1; };
  const count = new Map<string, number>();
  for (const r of rows) { const k = `${r.workspaceId}|${(r.code ?? "").trim()}`; count.set(k, (count.get(k) ?? 0) + 1); }
  const taken = new Set(rows.filter((r) => r.locationCode).map((r) => `${r.workspaceId}|${r.locationCode}`));
  let set = 0;
  for (const r of rows) {
    if (r.locationCode) { skip("already-set"); continue; }
    const code = (r.code ?? "").trim();
    if (GENERIC_CODES.has(code.toUpperCase())) { skip("generic-or-empty"); continue; }
    if ((count.get(`${r.workspaceId}|${code}`) ?? 0) > 1) { skip("code-not-unique-in-workspace"); continue; }
    if (taken.has(`${r.workspaceId}|${code}`)) { skip("locationCode-already-used"); continue; }
    set++;
    taken.add(`${r.workspaceId}|${code}`);
    if (!dryRun) await db.branch.update({ where: { id: r.id }, data: { locationCode: code } });
  }
  return { dryRun, set, skipped, noop: set === 0 };
}
