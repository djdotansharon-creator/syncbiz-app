/**
 * CONTROL ROOM F3a — Location classification foundation (SHADOW). Focused verification.
 *
 * Part A (always): pure resolveFilter / matchLocation semantics, evaluator REGION + GROUP, "a Tag is never a permission
 *   dimension", unknown dimensions fail closed, static schema / migration pins.
 * Part B (only with F3A_VERIFY_DATABASE_URL = THROWAWAY LOCAL Postgres migrated up to F2a ONLY, and F3A_PRE_CLIENT =
 *   path to a Prisma client generated from the pre-F3 schema): seeds F1/F2a data with the PRE-F3 client, applies the
 *   F3a migration, then proves ids unchanged, F1 invariants, F2a matrix, DB constraints (unique codes, cross-workspace
 *   memberships rejected, canonical codes, locationCode NULL uniqueness, CHECK with REGION / GROUP and no TAG), the
 *   DB-backed loader + filter + evaluator, and the locationCode backfill.
 * Run: npx tsx scripts/verify-control-room-f3a.ts
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { HierarchyIndex, ScopeEvalInputs, ScopeRow } from "@/lib/authz-scope";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const ROOT = path.join(__dirname, "..");
const read = (...p: string[]) => readFileSync(path.join(ROOT, ...p), "utf-8").replace(/\r\n/g, "\n");
const DBURL = process.env.F3A_VERIFY_DATABASE_URL ?? "";
if (DBURL) {
  const host = new URL(DBURL).hostname;
  if (host !== "localhost" && host !== "127.0.0.1") { console.error("F3A_VERIFY_DATABASE_URL must be a LOCAL throwaway DB"); process.exit(2); }
  process.env.DATABASE_URL = DBURL;
}

(async () => {
  const F = await import("../lib/location-filter");
  const S = await import("../lib/authz-scope");

  // ── Part A — pure ─────────────────────────────────────────────────────────────────────────────────────────
  // Golf (GF, default) / Golf & Co (GC); regions CENTER, NORTH, OLD(archived); groups MALLS, OUTLET, GONE(archived);
  // tags FLAGSHIP, TEST, DEAD(archived).
  const h: HierarchyIndex = {
    workspaceId: "W", defaultBrandId: "GF", canonicalLegacyBranchId: "L1",
    locations: [
      { id: "L1", brandId: "GC", status: "active", regionId: "CENTER", groupIds: ["MALLS"], tagIds: ["FLAGSHIP"] },
      { id: "L2", brandId: "GC", status: "active", regionId: "CENTER", groupIds: ["OUTLET"], tagIds: [] },
      { id: "L3", brandId: "GC", status: "active", regionId: "NORTH", groupIds: ["MALLS", "OUTLET"], tagIds: ["FLAGSHIP", "TEST"] },
      { id: "L4", brandId: null, status: "active", regionId: "CENTER", groupIds: ["MALLS"], tagIds: [] },
      { id: "L5", brandId: "GC", status: "active", regionId: null, groupIds: [], tagIds: [] },
      { id: "L6", brandId: "GC", status: "active", regionId: "OLD", groupIds: ["GONE"], tagIds: ["DEAD"] },
    ],
    zones: [
      { id: "Z1", branchId: "L1", zoneTypeCode: "MAIN", isDefault: true, status: "active" },
      { id: "Z1S", branchId: "L1", zoneTypeCode: "SPA", isDefault: false, status: "active" },
      { id: "Z3", branchId: "L3", zoneTypeCode: "MAIN", isDefault: true, status: "active" },
      { id: "Z4", branchId: "L4", zoneTypeCode: "MAIN", isDefault: true, status: "active" },
    ],
    regions: [{ id: "CENTER", status: "active" }, { id: "NORTH", status: "active" }, { id: "OLD", status: "archived" }],
    groups: [{ id: "MALLS", status: "active" }, { id: "OUTLET", status: "active" }, { id: "GONE", status: "archived" }],
    tags: [{ id: "FLAGSHIP", status: "active" }, { id: "TEST", status: "active" }, { id: "DEAD", status: "archived" }],
  };
  const L = (e: Parameters<typeof F.resolveFilter>[0]) => F.resolveFilter(e, h).locationIds.join(",");
  assert("P8 Brand + Region intersection (Golf & Co + Center)", L({ brandIds: ["GC"], regionIds: ["CENTER"] }) === "L1,L2");
  assert("P9 Brand + Region + Group intersection (Golf & Co + Center + Malls)", L({ brandIds: ["GC"], regionIds: ["CENTER"], groupIds: ["MALLS"] }) === "L1");
  assert("P10 Group OR semantics (Malls OR Outlet)", L({ groupIds: ["MALLS", "OUTLET"] }) === "L1,L2,L3,L4");
  assert("P11 Tag filtering (FLAGSHIP) + Tag ∧ Region", L({ tagIds: ["FLAGSHIP"] }) === "L1,L3" && L({ tagIds: ["FLAGSHIP"], regionIds: ["NORTH"] }) === "L3");
  assert("P13 archived Region never matches", L({ regionIds: ["OLD"] }) === "" && L({ regionIds: ["OLD", "NORTH"] }) === "L3");
  assert("P14 archived Group never matches", L({ groupIds: ["GONE"] }) === "");
  assert("P15 archived Tag never appears in filters", L({ tagIds: ["DEAD"] }) === "");
  assert("P16 Location without a Region never matches a Region constraint", !L({ regionIds: ["CENTER", "NORTH", "OLD"] }).split(",").includes("L5"));
  assert("P-a NULL brandId → default Brand (Golf)", L({ brandIds: ["GF"] }) === "L4");
  assert("P-b empty expression = all active locations; union of expressions", L({}) === "L1,L2,L3,L4,L5,L6" && L([{ regionIds: ["NORTH"] }, { brandIds: ["GF"] }]) === "L3,L4");
  const spa = F.resolveFilter({ zoneTypes: ["SPA"] }, h);
  assert("P-c zone types: All SPA zones → location + zone", spa.locationIds.join() === "L1" && spa.zoneIds.join() === "Z1S");

  // evaluator REGION + GROUP, and Tags never part of authz
  const row = (id: string, preset: ScopeRow["preset"], t: [string, string][], all = false): ScopeRow => ({ id, preset, allLocations: all, status: "active", targets: t.map(([d, v]) => ({ dimension: d as never, value: v })) });
  const inp = (rows: ScopeRow[], hh: HierarchyIndex = h): ScopeEvalInputs => ({ workspaceId: "W", membership: { role: "CONTROLLER", status: "ACTIVE" }, rows, hierarchy: hh });
  const ev = (i: ScopeEvalInputs, b: string) => S.evaluateScope(i, "playback.control", [{ kind: "LOCATION", branchId: b }]).decision;
  const rm = inp([row("r", "HQ_CONTROL", [["BRAND", "GC"], ["REGION", "CENTER"], ["GROUP", "MALLS"]])]);
  assert("P-d scope Brand ∧ Region ∧ Group without enumerating locations", ev(rm, "L1") === "ALLOW" && ["L2", "L3", "L4", "L5"].every((b) => ev(rm, b) === "DENY"));
  const archivedRegionScope = inp([row("r", "HQ_CONTROL", [["REGION", "OLD"]])]);
  assert("P-e archived Region / Group scope values never grant", ev(archivedRegionScope, "L6") === "DENY" && ev(inp([row("r", "HQ_CONTROL", [["GROUP", "GONE"]])]), "L6") === "DENY");
  assert("P12a TAG is not a permission dimension", !(S.LOCATION_DIMENSIONS as readonly string[]).includes("TAG") && !(S.KNOWN_SCOPE_DIMENSIONS as readonly string[]).includes("TAG"));
  assert("P12b a scope row carrying a TAG target fails closed (never widens)", ev(inp([row("r", "ADMIN", [["TAG", "FLAGSHIP"]])]), "L1") === "DENY" && ev(inp([row("r", "ADMIN", [["BRAND", "GC"], ["TAG", "FLAGSHIP"]])]), "L2") === "DENY");
  // changing tags never changes any access decision
  const retagged: HierarchyIndex = { ...h, locations: h.locations.map((l) => ({ ...l, tagIds: l.id === "L2" ? ["FLAGSHIP", "TEST", "VIP"] : [] })), tags: [...h.tags!, { id: "VIP", status: "active" }] };
  const rowsAll = [row("a", "HQ_CONTROL", [["BRAND", "GC"]]), row("b", "BRANCH_MANAGER", [["REGION", "CENTER"]]), row("c", "VIEW_ONLY", [["GROUP", "OUTLET"]])];
  const decisions = (hh: HierarchyIndex) => h.locations.map((l) => S.evaluateScope(inp(rowsAll, hh), "playback.control", [{ kind: "LOCATION", branchId: l.id }]).decision).join();
  assert("P12c re-tagging every location changes NO permission decision", decisions(h) === decisions(retagged));

  // static pins
  const schema = read("prisma", "schema.prisma");
  const mst = schema.slice(schema.indexOf("model MemberScopeTarget {"), schema.indexOf("\n}", schema.indexOf("model MemberScopeTarget {")));
  assert("T1 MemberScopeTarget has regionId + groupId and NO tag column", /regionId\s+String\?/.test(mst) && /groupId\s+String\?/.test(mst) && !/^\s*\w*tag\w*\s+\w/im.test(mst.split("\n").filter((l) => !l.trim().startsWith("///")).join("\n")));
  const mig = read("prisma", "migrations", "20261007200000_control_room_f3a_location_classification", "migration.sql");
  assert("T2 migration additive (no DROP except the CHECK replacement, no NOT NULL on existing columns)",
    (mig.match(/\bDROP\b/g) ?? []).length === 1 && /DROP CONSTRAINT "MemberScopeTarget_one_value_matches_dimension"/.test(mig) && !/SET NOT NULL|ALTER COLUMN|RENAME|DELETE FROM/i.test(mig));
  assert("T3 new CHECK covers 6 dimensions, no TAG", /num_nonnulls\("brandId", "branchId", "zoneId", "zoneTypeCode", "regionId", "groupId"\) = 1/.test(mig) && /'REGION' AND "regionId"/.test(mig) && /'GROUP' AND "groupId"/.test(mig) && !/'TAG'/.test(mig));
  assert("T4 Branch new fields nullable; existing code / city / country / timezone untouched", /regionId\s+String\?/.test(schema) && /locationCode\s+String\?/.test(schema) && /addressLine1\s+String\?/.test(schema) && /postalCode\s+String\?/.test(schema) && /stateProvince\s+String\?/.test(schema) && /code\s+String\s+@default\(""\)/.test(schema));
  let importers: string[] = [];
  try { importers = execSync(`git grep -l --untracked "location-filter" -- app components server desktop middleware.ts lib`, { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim().split("\n").filter(Boolean); } catch { importers = []; }
  assert("T5 filter resolver offline: imported only by lib/authz-scope.ts (itself offline)", JSON.stringify(importers) === JSON.stringify(["lib/authz-scope.ts"]), importers.join(","));

  if (!DBURL) {
    console.log("SKIP  Part B (needs F3A_VERIFY_DATABASE_URL migrated to F2a + F3A_PRE_CLIENT)");
    console.log(`\n${pass} passed, ${fail} failed`);
    return;
  }

  // ── Part B — throwaway Postgres: seed PRE-F3, migrate, verify ──────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaClient: PreClient } = require(process.env.F3A_PRE_CLIENT as string);
  const pre = new PreClient({ datasourceUrl: DBURL });
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const f1 = require("./control-room/f1-foundation.cjs");
  const C2 = await import("./control-room/f2-scope-core");
  const t = Date.now();
  const u = (n: string) => pre.user.create({ data: { email: `f3a-${n}-${t}@test.local`, name: n } });
  const owner = await u("owner");
  const ws = await pre.workspace.create({ data: { name: "TEST WS", slug: `f3a-${t}`, ownerId: owner.id } });
  const ws2 = await pre.workspace.create({ data: { name: "Other WS", slug: `f3a-o-${t}`, ownerId: owner.id } });
  const canon = await pre.branch.create({ data: { workspaceId: ws.id, name: "Canonical", code: "T001", legacyKey: "default" } });
  await pre.branch.create({ data: { workspaceId: ws.id, name: "Stub", code: "DEFAULT" } });
  await pre.branch.create({ data: { workspaceId: ws.id, name: "Main Store", code: "MAIN-STORE" } });
  await pre.branch.create({ data: { workspaceId: ws.id, name: "Main Store", code: "MAIN-STORE" } });
  const other = await pre.branch.create({ data: { workspaceId: ws2.id, name: "Other", code: "T001" } });
  await pre.stationDevice.create({ data: { durableDeviceId: `dsk-f3a-${t}`, workspaceId: ws.id, branchId: canon.id, platform: "win32", appVersion: "x" } });
  await pre.branchMasterDesignation.create({ data: { workspaceId: ws.id, branchId: canon.id, durableDeviceId: `dsk-f3a-${t}`, designatedBy: owner.id } });
  await pre.workspaceMember.create({ data: { workspaceId: ws.id, userId: owner.id, role: "WORKSPACE_ADMIN" } });
  const ctl = await u("ctl");
  await pre.workspaceMember.create({ data: { workspaceId: ws.id, userId: ctl.id, role: "CONTROLLER" } });
  await pre.userBranchAssignment.create({ data: { workspaceId: ws.id, userId: ctl.id, branchId: "default", role: "BRANCH_MANAGER" } });
  await f1.runBackfill(pre, { dryRun: false });
  await C2.syncScopes(pre, { dryRun: false });
  const fp0 = await C2.fingerprintF2(pre);
  const scopes0 = JSON.stringify(await pre.memberScope.findMany({ select: { id: true, preset: true, allLocations: true, source: true, sourceRef: true }, orderBy: { id: "asc" } }));
  await pre.$disconnect();

  execSync("npx prisma migrate deploy", { cwd: ROOT, env: { ...process.env, DATABASE_URL: DBURL }, stdio: "ignore" });
  const { prisma } = await import("../lib/prisma");
  const K = await import("./control-room/f3-classification-core");

  const fp1 = await C2.fingerprintF2(prisma);
  const scopes1 = JSON.stringify(await prisma.memberScope.findMany({ select: { id: true, preset: true, allLocations: true, source: true, sourceRef: true }, orderBy: { id: "asc" } }));
  assert("B19 existing ids / bindings / content / F1 rows / scope rows unchanged by the F3a migration", JSON.stringify(fp0) === JSON.stringify(fp1) && scopes0 === scopes1, JSON.stringify(Object.keys(fp0).filter((k) => fp0[k].hash !== fp1[k].hash)));
  assert("B18 F1 invariants unchanged", (await f1.runChecks(prisma)).ok);
  const mx = await C2.runMatrix(prisma);
  assert("B17 F2a matrix unchanged (0 unexpected) + scope check ok", mx.unexpected === 0 && (await C2.checkScopes(prisma)).ok, JSON.stringify(mx.expected));
  assert("B-a no default Region / Group / Tag created by the migration", (await prisma.region.count()) + (await prisma.locationGroup.count()) + (await prisma.locationTag.count()) === 0);

  // classification rows
  const CENTER = await prisma.region.create({ data: { workspaceId: ws.id, code: "CENTER", name: "Center" } });
  const NORTH = await prisma.region.create({ data: { workspaceId: ws.id, code: "NORTH", name: "North" } });
  const MALLS = await prisma.locationGroup.create({ data: { workspaceId: ws.id, code: "MALLS", name: "Malls" } });
  const OUTLET = await prisma.locationGroup.create({ data: { workspaceId: ws.id, code: "OUTLET", name: "Outlet" } });
  const FLAG = await prisma.locationTag.create({ data: { workspaceId: ws.id, code: "FLAGSHIP", name: "Flagship" } });
  const VIP = await prisma.locationTag.create({ data: { workspaceId: ws.id, code: "VIP", name: "VIP" } });
  const B2 = await prisma.region.create({ data: { workspaceId: ws2.id, code: "CENTER", name: "Center (other org)" } });
  await prisma.branch.update({ where: { id: canon.id }, data: { regionId: CENTER.id } });
  assert("B1 a Location has ONE Region (single column)", (await prisma.branch.findUnique({ where: { id: canon.id } }))?.regionId === CENTER.id);
  await prisma.locationGroupMember.createMany({ data: [{ groupId: MALLS.id, branchId: canon.id, workspaceId: ws.id }, { groupId: OUTLET.id, branchId: canon.id, workspaceId: ws.id }] });
  assert("B2 a Location can be in many Groups", (await prisma.locationGroupMember.count({ where: { branchId: canon.id } })) === 2);
  await prisma.locationTagAssignment.createMany({ data: [{ tagId: FLAG.id, branchId: canon.id, workspaceId: ws.id }, { tagId: VIP.id, branchId: canon.id, workspaceId: ws.id }] });
  assert("B3 a Location can have many Tags", (await prisma.locationTagAssignment.count({ where: { branchId: canon.id } })) === 2);
  const dup = async (fn: () => Promise<unknown>) => { try { await fn(); return "ok"; } catch (e) { return (e as { code?: string }).code ?? "err"; } };
  assert("B4 Region code unique per Organization (same code in another org OK)", (await dup(() => prisma.region.create({ data: { workspaceId: ws.id, code: "CENTER", name: "x" } }))) === "P2002" && !!B2.id);
  assert("B5 Group code unique per Organization", (await dup(() => prisma.locationGroup.create({ data: { workspaceId: ws.id, code: "MALLS", name: "x" } }))) === "P2002");
  assert("B6 Tag code unique per Organization", (await dup(() => prisma.locationTag.create({ data: { workspaceId: ws.id, code: "VIP", name: "x" } }))) === "P2002");
  const x1 = await dup(() => prisma.locationGroupMember.create({ data: { groupId: MALLS.id, branchId: other.id, workspaceId: ws.id } }));
  const x2 = await dup(() => prisma.locationGroupMember.create({ data: { groupId: MALLS.id, branchId: other.id, workspaceId: ws2.id } }));
  const x3 = await dup(() => prisma.locationTagAssignment.create({ data: { tagId: FLAG.id, branchId: other.id, workspaceId: ws2.id } }));
  assert("B7 cross-workspace group / tag membership rejected by the DB (composite FKs)", x1 !== "ok" && x2 !== "ok" && x3 !== "ok", `${x1}/${x2}/${x3}`);
  assert("B7b non-canonical classification codes rejected by the DB", (await dup(() => prisma.region.create({ data: { workspaceId: ws.id, code: "center", name: "x" } }))) !== "ok");
  // locationCode NULL uniqueness
  const b0 = await prisma.branch.findMany({ where: { workspaceId: ws.id, locationCode: null } });
  assert("B20a many Locations may have locationCode NULL", b0.length === 4);
  await prisma.branch.update({ where: { id: canon.id }, data: { locationCode: "T001" } });
  const sameInOther = await dup(() => prisma.branch.update({ where: { id: other.id }, data: { locationCode: "T001" } }));
  const dupInWs = await dup(() => prisma.branch.update({ where: { id: b0.find((b) => b.id !== canon.id)!.id }, data: { locationCode: "T001" } }));
  assert("B20b locationCode unique per Organization; same code in another Organization allowed", sameInOther === "ok" && dupInWs === "P2002", `${sameInOther}/${dupInWs}`);
  await prisma.branch.updateMany({ where: { locationCode: { not: null } }, data: { locationCode: null } });

  // CHECK constraint with REGION / GROUP, no TAG
  const sc = await prisma.memberScope.findFirstOrThrow({ where: { source: "migrated:assignment" } });
  const okRegion = await dup(() => prisma.memberScopeTarget.create({ data: { scopeId: sc.id, workspaceId: ws.id, dimension: "REGION", regionId: CENTER.id } }));
  const badTag = await dup(() => prisma.$executeRawUnsafe(`insert into "MemberScopeTarget"(id,"scopeId","workspaceId","dimension","zoneTypeCode") values ('t1','${sc.id}','${ws.id}','TAG','FLAGSHIP')`));
  const badMix = await dup(() => prisma.memberScopeTarget.create({ data: { scopeId: sc.id, workspaceId: ws.id, dimension: "GROUP", regionId: CENTER.id } }));
  assert("B-b CHECK accepts REGION / GROUP values, rejects TAG and mismatched columns", okRegion === "ok" && badTag !== "ok" && badMix !== "ok", `${okRegion}/${badTag}/${badMix}`);
  await prisma.memberScopeTarget.deleteMany({ where: { scopeId: sc.id, dimension: "REGION" } });

  // DB-backed loader + filter + evaluator
  const hi = await S.loadHierarchy(prisma as never, ws.id);
  const canonLoc = hi.locations.find((l) => l.id === canon.id)!;
  assert("B-c loader reads region / groups / tags", canonLoc.regionId === CENTER.id && canonLoc.groupIds?.length === 2 && canonLoc.tagIds?.length === 2 && hi.regions?.length === 2 && hi.tags?.length === 2);
  assert("B-d filter: Center + Malls + Flagship → canonical only", F.resolveFilter({ regionIds: [CENTER.id], groupIds: [MALLS.id], tagIds: [FLAG.id] }, hi).locationIds.join() === canon.id);
  await prisma.region.update({ where: { id: CENTER.id }, data: { status: "archived", archivedAt: new Date() } });
  const hi2 = await S.loadHierarchy(prisma as never, ws.id);
  assert("B-e archived Region (DB) never matches", F.resolveFilter({ regionIds: [CENTER.id] }, hi2).locationIds.length === 0);
  await prisma.region.update({ where: { id: CENTER.id }, data: { status: "active", archivedAt: null } });
  let delRegion = "ok"; try { await prisma.region.delete({ where: { id: CENTER.id } }); } catch { delRegion = "refused"; }
  assert("B-f a Region still referenced by a Location cannot be hard-deleted (NO ACTION, deferred)", delRegion === "refused");
  void NORTH;

  // locationCode backfill (never run on TEST yet)
  const dry = await K.backfillLocationCode(prisma, { dryRun: true });
  const ap = await K.backfillLocationCode(prisma, { dryRun: false });
  const ap2 = await K.backfillLocationCode(prisma, { dryRun: false });
  const canonAfter = await prisma.branch.findUnique({ where: { id: canon.id } });
  assert("B-g backfill: T001 copied (canonical + the other org's T001); DEFAULT and duplicated MAIN-STORE skipped; second run NO-OP",
    dry.set === 2 && ap.set === 2 && canonAfter?.locationCode === "T001" && ap.skipped["generic-or-empty"] === 1 && ap.skipped["code-not-unique-in-workspace"] === 2 && ap2.noop === true, JSON.stringify(ap));
  const ck = await K.checkClassification(prisma);
  assert("B-h classification check passes (no TAG column / rows, memberships inside workspace, canonical codes)", ck.ok, ck.violations.join(" | "));
  assert("B-i F2a scope check still ok after F3 data", (await C2.checkScopes(prisma)).ok && (await C2.runMatrix(prisma)).unexpected === 0);

  await prisma.$disconnect();
  console.log(`\n${pass} passed, ${fail} failed`);
})().catch((e) => { console.error(e); process.exit(1); });
