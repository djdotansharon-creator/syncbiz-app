/**
 * CONTROL ROOM F2a — MemberScope foundation (SHADOW / OFFLINE). Focused verification.
 *
 * Part A (always): pure evaluateScope semantics + deriveScopesFromLegacy translation + Gate 3A preset parity + static
 *   "nothing imports the evaluator / no runtime file changed" pins.
 * Part B (only with F2A_VERIFY_DATABASE_URL = a THROWAWAY LOCAL Postgres with all migrations applied): synthetic
 *   subjects (admin, manager, controller ×2 assignments, viewer, no assignment, "*", suspended, orphan assignment) →
 *   sync dry-run / apply / second apply NO-OP / check / OFFLINE MATRIX (Gate 3A vs evaluator: 0 unexpected) /
 *   fingerprint unchanged / CHECK constraint / NO ACTION FKs / admin-source Brand + Zone-type rows via the loader.
 * Run: npx tsx scripts/verify-control-room-f2a.ts      (Part B: F2A_VERIFY_DATABASE_URL=<local tmp db> …)
 */
import { execSync } from "node:child_process";
import path from "node:path";
import type { Capability } from "@/lib/authz";
import type { EvalTarget, HierarchyIndex, ScopeEvalInputs, ScopeRow } from "@/lib/authz-scope";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const ROOT = path.join(__dirname, "..");
const DBURL = process.env.F2A_VERIFY_DATABASE_URL ?? "";
if (DBURL) {
  const host = new URL(DBURL).hostname;
  if (host !== "localhost" && host !== "127.0.0.1") { console.error("F2A_VERIFY_DATABASE_URL must be a LOCAL throwaway DB"); process.exit(2); }
  process.env.DATABASE_URL = DBURL;
}

(async () => {
  const S = await import("../lib/authz-scope");
  const A = await import("../lib/authz");

  // ── Part A — pure semantics ───────────────────────────────────────────────────────────────────────────────
  const h: HierarchyIndex = {
    workspaceId: "W", defaultBrandId: "BA", canonicalLegacyBranchId: "L1",
    locations: [{ id: "L1", brandId: "BA", status: "active" }, { id: "L2", brandId: null, status: "active" }, { id: "L3", brandId: "BB", status: "active" }],
    zones: [
      { id: "Z1", branchId: "L1", zoneTypeCode: "MAIN", isDefault: true, status: "active" },
      { id: "Z1P", branchId: "L1", zoneTypeCode: "POOL", isDefault: false, status: "active" },
      { id: "Z2", branchId: "L2", zoneTypeCode: "MAIN", isDefault: true, status: "active" },
      { id: "Z3", branchId: "L3", zoneTypeCode: "MAIN", isDefault: true, status: "active" },
      { id: "Z3S", branchId: "L3", zoneTypeCode: "SPA", isDefault: false, status: "active" },
      { id: "ZX", branchId: "L3", zoneTypeCode: "SPA", isDefault: false, status: "archived" },
    ],
  };
  const row = (id: string, preset: ScopeRow["preset"], targets: [string, string][] = [], allLocations = false, status = "active"): ScopeRow =>
    ({ id, preset, allLocations, status, targets: targets.map(([d, v]) => ({ dimension: d as ScopeRow["targets"][number]["dimension"], value: v })) });
  const inp = (rows: ScopeRow[], member: { role: string; status: string } | null = { role: "CONTROLLER", status: "ACTIVE" }, hh: HierarchyIndex = h): ScopeEvalInputs =>
    ({ workspaceId: hh.workspaceId, membership: member, rows, hierarchy: hh });
  const L = (b: string): EvalTarget => ({ kind: "LOCATION", branchId: b });
  const Z = (z: string): EvalTarget => ({ kind: "ZONE", zoneId: z });
  const ev = (i: ScopeEvalInputs, c: Capability, t: EvalTarget[]) => S.evaluateScope(i, c, t).decision;
  const PC: Capability = "playback.control";

  assert("A1 empty row (allLocations=false, no targets) MATCHES NOTHING (fail closed)",
    ev(inp([row("r", "ADMIN")]), PC, [L("L1")]) === "DENY" && ev(inp([row("r", "ADMIN")]), PC, [Z("Z1")]) === "DENY" && ev(inp([row("r", "ADMIN")]), "users.manage", []) === "DENY");
  const brandBB = inp([row("r", "HQ_CONTROL", [["BRAND", "BB"]])]);
  assert("A2 Brand scope: own brand's location + zone allowed, other brand denied", ev(brandBB, PC, [L("L3")]) === "ALLOW" && ev(brandBB, PC, [Z("Z3S")]) === "ALLOW" && ev(brandBB, PC, [L("L1")]) === "DENY");
  const brandOr = inp([row("r", "HQ_CONTROL", [["BRAND", "BA"], ["BRAND", "BB"]])]);
  assert("A3 OR within a dimension (Brand A OR Brand B)", ev(brandOr, PC, [L("L1")]) === "ALLOW" && ev(brandOr, PC, [L("L3")]) === "ALLOW");
  const andNo = inp([row("r", "HQ_CONTROL", [["BRAND", "BB"], ["LOCATION", "L1"]])]);
  const andYes = inp([row("r", "HQ_CONTROL", [["BRAND", "BA"], ["LOCATION", "L1"]])]);
  assert("A4 AND across dimensions (Brand ∧ Location)", ev(andNo, PC, [L("L1")]) === "DENY" && ev(andNo, PC, [L("L3")]) === "DENY" && ev(andYes, PC, [L("L1")]) === "ALLOW" && ev(andYes, PC, [L("L2")]) === "DENY");
  assert("A5 NULL Branch.brandId → default Brand (F1 compatibility)", ev(inp([row("r", "HQ_CONTROL", [["BRAND", "BA"]])]), PC, [L("L2")]) === "ALLOW" && ev(inp([row("r", "HQ_CONTROL", [["BRAND", "BB"]])]), PC, [L("L2")]) === "DENY");
  const loc2 = inp([row("r", "BRANCH_MANAGER", [["LOCATION", "L2"]])]);
  assert("A6 Location scope: that location (and its zones) only; never workspace-level", ev(loc2, PC, [L("L2")]) === "ALLOW" && ev(loc2, PC, [Z("Z2")]) === "ALLOW" && ev(loc2, PC, [L("L1")]) === "DENY" && ev(loc2, PC, []) === "DENY");
  const zoneOp = inp([row("r", "BRANCH_MANAGER", [["ZONE", "Z1P"]])]);
  assert("A7 Zone scope: that zone only; a zone-limited row never covers the whole location", ev(zoneOp, PC, [Z("Z1P")]) === "ALLOW" && ev(zoneOp, PC, [Z("Z1")]) === "DENY" && ev(zoneOp, PC, [L("L1")]) === "DENY");
  const spa = inp([row("r", "HQ_CONTROL", [["ZONE_TYPE", "SPA"]])]);
  const poolInBA = inp([row("r", "HQ_CONTROL", [["BRAND", "BA"], ["ZONE_TYPE", "POOL"]])]);
  assert("A8 Zone type: all SPA zones (archived excluded); Brand ∧ ZoneType", ev(spa, PC, [Z("Z3S")]) === "ALLOW" && ev(spa, PC, [Z("ZX")]) === "DENY" && ev(spa, PC, [Z("Z1P")]) === "DENY" && ev(poolInBA, PC, [Z("Z1P")]) === "ALLOW" && ev(poolInBA, PC, [Z("Z3S")]) === "DENY");
  const uni = inp([row("a", "BRANCH_MANAGER", [["LOCATION", "L1"]]), row("b", "BRANCH_MANAGER", [["LOCATION", "L3"]])]);
  const uniD = S.evaluateScope(uni, PC, [L("L1"), L("L3")]);
  assert("A9 UNION across rows (multi-target covered by different rows)", uniD.decision === "ALLOW" && uniD.rowIds.join(",") === "a,b" && ev(uni, PC, [L("L1"), L("L2")]) === "DENY");
  const iso = inp([row("a", "VIEW_ONLY", [["LOCATION", "L1"]]), row("b", "BRANCH_MANAGER", [["LOCATION", "L2"]]), row("c", "VIEW_ONLY", [], true)]);
  assert("A10 capability isolation: row A's scope never borrows row B's capability",
    ev(iso, PC, [L("L1")]) === "DENY" && ev(iso, PC, [L("L2")]) === "ALLOW" && ev(iso, "monitoring.view", [L("L3")]) === "ALLOW" && ev(iso, PC, [L("L3")]) === "DENY" && ev(iso, "users.manage", []) === "DENY");
  const noCanon: HierarchyIndex = { ...h, canonicalLegacyBranchId: null };
  assert("A11 legacy \"default\" alias → canonical location; unresolvable without a canonical branch",
    ev(inp([row("r", "BRANCH_MANAGER", [["LOCATION", "L1"]])]), PC, [L("default")]) === "ALLOW" &&
    ev(inp([row("r", "ADMIN", [], true)], { role: "WORKSPACE_ADMIN", status: "ACTIVE" }, noCanon), PC, [L("default")]) === "DENY");
  assert("A12 suspended / no membership / no workspace → DENY (rows ignored)",
    ev(inp([row("r", "ADMIN", [], true)], { role: "WORKSPACE_ADMIN", status: "SUSPENDED" }), PC, [L("L1")]) === "DENY" &&
    ev(inp([row("r", "ADMIN", [], true)], null), PC, [L("L1")]) === "DENY" &&
    S.evaluateScope({ workspaceId: null, membership: null, rows: [], hierarchy: null }, PC, []).decision === "DENY");
  const adminAll = inp([row("r", "ADMIN", [], true)]);
  const hqAll = inp([row("r", "HQ_CONTROL", [], true)]);
  assert("A13 workspace-level action needs allLocations AND the capability", ev(adminAll, "users.manage", []) === "ALLOW" && ev(hqAll, "users.manage", []) === "DENY" && ev(hqAll, "content.manage", []) === "ALLOW");
  assert("A14 location / zone of another workspace → DENY", ev(adminAll, PC, [L("FOREIGN")]) === "DENY" && ev(adminAll, PC, [Z("FOREIGN")]) === "DENY");
  assert("A15 an invalid / inactive row is ignored (never widens)", ev(inp([row("r", "ADMIN", [], true, "invalid")]), PC, [L("L1")]) === "DENY");

  // ── derivation ────────────────────────────────────────────────────────────────────────────────────────────
  const ctx: { canonicalLegacyBranchId: string | null; workspaceBranchIds: string[] } = { canonicalLegacyBranchId: "L1", workspaceBranchIds: ["L1", "L2", "L3"] };
  const d = (role: string, as: [string, string, string][], c = ctx) => S.deriveScopesFromLegacy({ role }, as.map(([id, b, r]) => ({ id, branchId: b, role: r })), c);
  const keys = (x: ReturnType<typeof d>) => x.rows.map((r) => `${r.source}:${S.scopeKey(r)}`).join(" ; ");
  assert("A16 SUPER_ADMIN / WORKSPACE_ADMIN → ADMIN + allLocations (assignments superseded)",
    keys(d("WORKSPACE_ADMIN", [["u1", "L1", "BRANCH_MANAGER"]])) === "migrated:role:ADMIN|ALL|" && d("SUPER_ADMIN", []).rows[0].preset === "ADMIN" && d("WORKSPACE_ADMIN", [["u1", "L1", "X"]]).notes[0].note === "superseded-by-role");
  assert("A17 MANAGER → HQ_CONTROL + allLocations (legacy-vs-Gate3A difference NOT fixed)", keys(d("MANAGER", [])) === "migrated:role:HQ_CONTROL|ALL|");
  const c2 = d("CONTROLLER", [["a1", "default", "BRANCH_MANAGER"], ["a2", "L3", "VIEW_ONLY"]]);
  assert("A18 CONTROLLER: one row per assignment, own preset; \"default\" → canonical",
    keys(c2) === "migrated:assignment:BRANCH_MANAGER|-|LOCATION=L1 ; migrated:assignment:VIEW_ONLY|-|LOCATION=L3" && c2.rows.map((r) => r.sourceRef).join(",") === "a1,a2");
  assert("A19 VIEWER → VIEW_ONLY regardless of assignment role", keys(d("VIEWER", [["v1", "L2", "BRANCH_MANAGER"]])) === "migrated:assignment:VIEW_ONLY|-|LOCATION=L2");
  assert("A20 no assignment → explicit migrated implicit-default row on the canonical branch",
    keys(d("CONTROLLER", [])) === "migrated:implicit-default:BRANCH_MANAGER|-|LOCATION=L1" && keys(d("VIEWER", [])) === "migrated:implicit-default:VIEW_ONLY|-|LOCATION=L1");
  assert("A21 no assignment + no canonical branch → no row (never invented) + classified note",
    d("CONTROLLER", [], { ...ctx, canonicalLegacyBranchId: null }).rows.length === 0 && d("CONTROLLER", [], { ...ctx, canonicalLegacyBranchId: null }).notes[0].note === "implicit-default-unresolvable");
  const st = d("CONTROLLER", [["s1", "*", "BRANCH_CONTROLLER"]]);
  assert("A22 legacy \"*\" → allLocations, classified", keys(st) === "migrated:assignment:BRANCH_MANAGER|ALL|" && st.notes[0].note === "star-assignment");
  assert("A23 assignment to a branch outside the workspace → skipped + classified", d("CONTROLLER", [["f1", "FOREIGN", "BRANCH_MANAGER"]]).rows.length === 0);
  const parity = ["BRANCH_MANAGER", "BRANCH_CONTROLLER", "VIEW_ONLY", "VIEWER", "REGIONAL_MANAGER", "HQ_CONTROL", "weird", ""].every((r) =>
    A.resolveGrants({ workspaceId: "W", membership: { role: "CONTROLLER", status: "ACTIVE" }, assignments: [{ branchId: "L1", role: r }], canonicalLegacyBranchId: null, workspaceBranchIds: ["L1"] })[0].preset === S.legacyAssignmentPreset(r));
  assert("A24 assignment-role → preset mapping identical to Gate 3A", parity);
  assert("A25 preset capability table is Gate 3A's (no capability redesign)", S.SCOPE_PRESETS.every((p) => A.PRESET_CAPABILITIES[p] instanceof Set) && S.ALL_CAPABILITIES.length === 9);

  // ── static scope pins ─────────────────────────────────────────────────────────────────────────────────────
  let importers: string[] = [];
  try {
    importers = execSync(`git grep -l --untracked "authz-scope" -- app lib components server desktop middleware.ts`, { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim().split("\n").filter(Boolean);
  } catch { importers = []; } // git grep exits 1 when nothing matches = no importer
  assert("A26 NOTHING in app / lib / server / desktop imports the evaluator (offline only)", importers.length === 0, importers.join(","));
  const changed = execSync(`git diff --name-only HEAD -- lib app components server desktop middleware.ts`, { cwd: ROOT }).toString().trim().split("\n").filter(Boolean);
  assert("A27 no existing runtime file changed (authz.ts / shadowAuthorize / tokens / WS / playback untouched)", changed.length === 0, changed.join(","));

  if (!DBURL) {
    console.log("SKIP  Part B (set F2A_VERIFY_DATABASE_URL to a throwaway local DB with all migrations applied)");
    console.log(`\n${pass} passed, ${fail} failed`);
    return;
  }

  // ── Part B — real throwaway local Postgres ─────────────────────────────────────────────────────────────────
  const { prisma } = await import("../lib/prisma");
  const C = await import("./control-room/f2-scope-core");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const f1 = require("./control-room/f1-foundation.cjs");
  const t = Date.now();
  const mkUser = (n: string) => prisma.user.create({ data: { email: `f2a-${n}-${t}@test.local`, name: n } });
  const owner = await mkUser("owner");
  const ws = await prisma.workspace.create({ data: { name: "TEST WS", slug: `f2a-${t}`, ownerId: owner.id } });
  const L1 = await prisma.branch.create({ data: { workspaceId: ws.id, name: "Canonical", code: "T001", legacyKey: "default" } });
  const L2 = await prisma.branch.create({ data: { workspaceId: ws.id, name: "Second", code: "T002" } });
  const L3 = await prisma.branch.create({ data: { workspaceId: ws.id, name: "Brand B site", code: "T003" } });
  await prisma.stationDevice.create({ data: { durableDeviceId: `dsk-f2a-${t}`, workspaceId: ws.id, branchId: L1.id, platform: "win32", appVersion: "x" } });
  await f1.runBackfill(prisma, { dryRun: false }); // F1: default brand + default zones
  const BB = await prisma.brand.create({ data: { workspaceId: ws.id, name: "Brand B", code: "BB" } });
  await prisma.branch.update({ where: { id: L3.id }, data: { brandId: BB.id } });
  const spaZone = await prisma.zone.create({ data: { workspaceId: ws.id, branchId: L3.id, name: "Spa", code: "SPA", zoneTypeCode: "SPA" } });
  const member = async (n: string, role: string, status = "ACTIVE") => {
    const u = await mkUser(n);
    await prisma.workspaceMember.create({ data: { workspaceId: ws.id, userId: u.id, role: role as never, status: status as never } });
    return u;
  };
  const uba = (userId: string, branchId: string, role: string) => prisma.userBranchAssignment.create({ data: { workspaceId: ws.id, userId, branchId, role } });
  await prisma.workspaceMember.create({ data: { workspaceId: ws.id, userId: owner.id, role: "WORKSPACE_ADMIN" } });
  await uba(owner.id, "default", "BRANCH_MANAGER");
  await member("manager", "MANAGER");
  const ctl = await member("ctl", "CONTROLLER"); await uba(ctl.id, "default", "BRANCH_MANAGER"); await uba(ctl.id, L3.id, "VIEW_ONLY");
  const viewer = await member("viewer", "VIEWER"); await uba(viewer.id, L2.id, "BRANCH_CONTROLLER");
  await member("noassign", "CONTROLLER");
  const star = await member("star", "CONTROLLER"); await uba(star.id, "*", "BRANCH_CONTROLLER");
  const susp = await member("susp", "CONTROLLER", "SUSPENDED"); await uba(susp.id, L2.id, "BRANCH_MANAGER");
  const orphan = await mkUser("orphan"); await uba(orphan.id, L2.id, "BRANCH_MANAGER");

  const fp0 = await C.fingerprintF2(prisma);
  const dry = await C.syncScopes(prisma, { dryRun: true });
  assert("B1 dry-run plans rows for all 7 members and writes nothing", dry.created === 8 && (await prisma.memberScope.count()) === 0, JSON.stringify(dry));
  const ap = await prisma.$transaction((tx) => C.syncScopes(tx, { dryRun: false }));
  assert("B2 apply: 8 rows (admin, manager, ctl×2, viewer, implicit-default, star, suspended); orphan reported", ap.created === 8 && ap.orphanAssignments === 1 && ap.notes["star-assignment"] === 1 && ap.notes["implicit-default"] === 1 && ap.notes["superseded-by-role"] === 1, JSON.stringify(ap));
  const ap2 = await C.syncScopes(prisma, { dryRun: false });
  assert("B3 second apply = NO-OP", ap2.noop === true, JSON.stringify(ap2));
  const chk = await C.checkScopes(prisma);
  assert("B4 check: CHECK constraint present, no drift, targets inside workspace", chk.ok, chk.violations.join(" | "));
  const fp1 = await C.fingerprintF2(prisma);
  assert("B5 fingerprint unchanged (members / assignments / users / F1 brand + zone rows / content)", JSON.stringify(fp0) === JSON.stringify(fp1), JSON.stringify(Object.keys(fp0).filter((k) => fp0[k].hash !== fp1[k].hash)));

  const mx = await C.runMatrix(prisma);
  const onlyStar = Object.keys(mx.expected).every((k) => k.startsWith("known-star"));
  assert("B6 OFFLINE MATRIX: 0 unexpected mismatches", mx.unexpected === 0, mx.unexpectedSamples.join(" | "));
  assert("B7 only expected class = known-star (legacy * = ALL vs Gate 3A literal), and it occurs", onlyStar && (Object.values(mx.expected)[0] ?? 0) > 0, JSON.stringify(mx.expected));
  assert("B8 matrix covers 8 subjects × 9 caps × (workspace + 3 locations + alias + 4 zones)", mx.subjects === 8 && mx.cells === 8 * 9 * 9, `${mx.subjects}/${mx.cells}`);

  // CHECK constraint + NO ACTION FKs
  const scopeRow = await prisma.memberScope.findFirstOrThrow({ where: { source: "migrated:implicit-default" } });
  let e1 = false; try { await prisma.memberScopeTarget.create({ data: { scopeId: scopeRow.id, workspaceId: ws.id, dimension: "BRAND", branchId: L2.id } }); } catch { e1 = true; }
  let e2 = false; try { await prisma.memberScopeTarget.create({ data: { scopeId: scopeRow.id, workspaceId: ws.id, dimension: "LOCATION", branchId: L2.id, brandId: BB.id } }); } catch { e2 = true; }
  let e3 = false; try { await prisma.memberScopeTarget.create({ data: { scopeId: scopeRow.id, workspaceId: ws.id, dimension: "REGION", zoneTypeCode: "X" } }); } catch { e3 = true; }
  assert("B9 CHECK constraint rejects wrong-dimension, two-value and unknown-dimension targets", e1 && e2 && e3);
  let e4 = false; try { await prisma.branch.delete({ where: { id: L3.id } }); } catch { e4 = true; }
  assert("B10 NO ACTION FK: a location referenced by a scope target cannot silently disappear", e4 && (await prisma.branch.count({ where: { id: L3.id } })) === 1);

  // admin-source composite rows through the real loader (Brand / Zone type / Zone)
  const vm = await prisma.workspaceMember.findFirstOrThrow({ where: { workspaceId: ws.id, userId: viewer.id } });
  await prisma.memberScope.create({ data: { memberId: vm.id, workspaceId: ws.id, userId: viewer.id, preset: "BRANCH_MANAGER", source: "admin", sourceRef: "t1",
    targets: { create: [{ workspaceId: ws.id, dimension: "BRAND", brandId: BB.id }, { workspaceId: ws.id, dimension: "ZONE_TYPE", zoneTypeCode: "SPA" }] } } });
  const vin = await S.loadScopeInputs(prisma as never, ws.id, viewer.id);
  const defZone3 = await prisma.zone.findFirstOrThrow({ where: { branchId: L3.id, isDefault: true } });
  assert("B11 loader + evaluator: Brand B ∧ SPA → spa zone ALLOW; main zone / whole location DENY; viewer row still VIEW_ONLY",
    ev(vin, PC, [Z(spaZone.id)]) === "ALLOW" && ev(vin, PC, [Z(defZone3.id)]) === "DENY" && ev(vin, PC, [L(L3.id)]) === "DENY" && ev(vin, PC, [L(L2.id)]) === "DENY" && ev(vin, "monitoring.view", [L(L2.id)]) === "ALLOW");
  assert("B12 check ignores admin-source rows for drift (migrated rows still match)", (await C.checkScopes(prisma)).ok);
  const sin = await S.loadScopeInputs(prisma as never, ws.id, susp.id);
  const oin = await S.loadScopeInputs(prisma as never, ws.id, orphan.id);
  assert("B13 suspended member + orphan assignment → DENY", ev(sin, "monitoring.view", [L(L2.id)]) === "DENY" && ev(oin, "monitoring.view", [L(L2.id)]) === "DENY");
  const sti = await S.loadScopeInputs(prisma as never, ws.id, star.id);
  // allLocations covers every location AND workspace-level actions — but only within the row's own preset
  // (BRANCH_MANAGER has no users.manage / branches.manage / master.designate).
  assert("B14 \"*\" member → allLocations (legacy-equivalent) incl. other brand; preset still bounds capabilities",
    ev(sti, PC, [L(L3.id)]) === "ALLOW" && ev(sti, PC, []) === "ALLOW" && ev(sti, "users.manage", []) === "DENY" && ev(sti, "master.designate", [L(L3.id)]) === "DENY");
  const deferred: { n: number }[] = await prisma.$queryRawUnsafe(`select count(*)::int as n from pg_constraint where conname in ('MemberScopeTarget_brandId_fkey','MemberScopeTarget_branchId_fkey','MemberScopeTarget_zoneId_fkey') and condeferrable and condeferred`);
  assert("B14b value FKs are DEFERRABLE INITIALLY DEFERRED (3/3)", Number(deferred[0].n) === 3);

  // whole-workspace cascade still works with NO ACTION targets (checked at end of statement)
  const ws2u = await mkUser("w2");
  const ws2 = await prisma.workspace.create({ data: { name: "W2", slug: `f2a-w2-${t}`, ownerId: ws2u.id } });
  const b2 = await prisma.branch.create({ data: { workspaceId: ws2.id, name: "B", code: "B" } });
  const m2 = await prisma.workspaceMember.create({ data: { workspaceId: ws2.id, userId: ws2u.id, role: "CONTROLLER" } });
  await prisma.memberScope.create({ data: { memberId: m2.id, workspaceId: ws2.id, userId: ws2u.id, preset: "BRANCH_MANAGER", source: "admin", targets: { create: [{ workspaceId: ws2.id, dimension: "LOCATION", branchId: b2.id }] } } });
  let cascadeOk = true; try { await prisma.workspace.delete({ where: { id: ws2.id } }); } catch { cascadeOk = false; }
  assert("B15 whole-workspace delete still cascades (scopes, targets, branches)", cascadeOk && (await prisma.memberScope.count({ where: { workspaceId: ws2.id } })) === 0);

  await prisma.$disconnect();
  console.log(`\n${pass} passed, ${fail} failed`);
})().catch((e) => { console.error(e); process.exit(1); });
