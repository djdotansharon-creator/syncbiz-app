/**
 * CONTROL ROOM F1 — Brand + Zone foundation (SHADOW). Focused verification.
 *
 * Part A (always): pure zone-type code + NULL-zone resolution + TEST-target refusal + constant parity + static
 *   scope / additive-migration checks.
 * Part B (only with F1_VERIFY_DATABASE_URL = a THROWAWAY LOCAL Postgres with all migrations applied): seeds the
 *   TEST shape (one workspace, canonical branch with legacyKey "default", 2 stations incl. a legacy "default"-keyed
 *   one, one designation, content rows), then proves: dry-run writes nothing; apply backfills; check passes; second
 *   run is a no-op; fingerprint (ids / bindings / content) unchanged; partial indexes = AT MOST ONE default (second
 *   default rejected) while EXACTLY ONE comes from backfill + transactional creation (store.addBranch); a failed
 *   creation leaves no orphan zone; NULL zoneId resolves to the default zone; resolveZone helper semantics.
 * Run: npx tsx scripts/verify-control-room-f1.ts      (Part B: F1_VERIFY_DATABASE_URL=<local tmp db> …)
 */
import Module from "node:module";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const ROOT = path.join(__dirname, "..");
const read = (...p: string[]) => readFileSync(path.join(ROOT, ...p), "utf-8").replace(/\r\n/g, "\n");

// test-process stub: server-only (lib/store → entitlement-limits)
{
  const Mo = Module as unknown as { _resolveFilename: (r: string, ...a: unknown[]) => string; _cache: Record<string, unknown> };
  const m = new Module("stub:server-only") as unknown as { loaded: boolean; exports: unknown };
  m.loaded = true; m.exports = {}; Mo._cache["stub:server-only"] = m;
  const orig = Mo._resolveFilename;
  Mo._resolveFilename = function (r: string, ...rest: unknown[]) { return r === "server-only" ? "stub:server-only" : orig.call(this, r, ...rest); };
}

const DBURL = process.env.F1_VERIFY_DATABASE_URL ?? "";
if (DBURL) {
  const host = new URL(DBURL).hostname;
  if (host !== "localhost" && host !== "127.0.0.1") { console.error("F1_VERIFY_DATABASE_URL must be a LOCAL throwaway DB"); process.exit(2); }
  process.env.DATABASE_URL = DBURL; // lib/prisma reads it at import
}

(async () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const core = require("./control-room/f1-foundation.cjs");
  const F = await import("../lib/control-room-foundation");

  // ── Part A — pure ─────────────────────────────────────────────────────────────────────────────────────────
  assert("A1 zone type: canonical codes normalize", F.normalizeZoneTypeCode(" spa ") === "SPA" && F.normalizeZoneTypeCode("kids club") === "KIDS_CLUB" && F.normalizeZoneTypeCode("Main-Store") === "MAIN_STORE");
  assert("A2 zone type: future custom code accepted with NO schema change", F.normalizeZoneTypeCode("WINE_CELLAR") === "WINE_CELLAR" && F.zoneTypeLabel("WINE_CELLAR") === "Wine cellar");
  assert("A3 zone type: invalid codes rejected", F.normalizeZoneTypeCode("") === null && F.normalizeZoneTypeCode("1POOL") === null && F.normalizeZoneTypeCode("pool;drop") === null && F.normalizeZoneTypeCode("X".repeat(41)) === null);
  assert("A4 zone type catalog includes the locked examples", ["MAIN", "LOBBY", "POOL", "SPA", "RESTAURANT", "BAR", "GYM", "ROOFTOP", "RETAIL", "OUTDOOR", "BALLROOM", "BEACH", "KIDS_CLUB", "TERRACE"].every((c) => c in F.KNOWN_ZONE_TYPES));
  const zs = [{ id: "z1", workspaceId: "w", branchId: "b", isDefault: true }, { id: "z2", workspaceId: "w", branchId: "b", isDefault: false }];
  assert("A5 NULL zoneId resolves to the Location's default zone", JSON.stringify(F.decideZoneResolution({ workspaceId: "w", branchId: "b", zoneId: null }, zs)) === JSON.stringify({ ok: true, zoneId: "z1", viaDefault: true }));
  assert("A6 explicit zone of the same location resolves to itself", F.decideZoneResolution({ workspaceId: "w", branchId: "b", zoneId: "z2" }, zs).ok === true);
  assert("A7 zone of ANOTHER location is rejected", F.decideZoneResolution({ workspaceId: "w", branchId: "b", zoneId: "zx" }, zs, { id: "zx", workspaceId: "w", branchId: "other", isDefault: true }).ok === false);
  assert("A8 no default zone → unresolved (never invented)", F.decideZoneResolution({ workspaceId: "w", branchId: "b", zoneId: null }, [zs[1]]).ok === false);
  assert("A9 constants: lib ↔ cjs core parity", core.DEFAULT_BRAND_CODE === F.DEFAULT_BRAND_CODE && core.DEFAULT_ZONE_CODE === F.DEFAULT_ZONE_CODE && core.DEFAULT_ZONE_NAME === F.DEFAULT_ZONE_NAME && core.DEFAULT_ZONE_TYPE_CODE === F.DEFAULT_ZONE_TYPE_CODE);
  const testEnv = { VONO_F1_TARGET: "TEST", RAILWAY_PROJECT_NAME: "syncbiz-pr52-test", RAILWAY_SERVICE_NAME: "syncbiz-app-test" };
  assert("A10 TEST target accepted only with all three markers", core.testTargetRefusal(testEnv) === null);
  assert("A11 refuses without VONO_F1_TARGET / other project / other service",
    core.testTargetRefusal({ ...testEnv, VONO_F1_TARGET: undefined }) !== null &&
    core.testTargetRefusal({ ...testEnv, RAILWAY_PROJECT_NAME: "syncbiz" }) !== null &&
    core.testTargetRefusal({ ...testEnv, RAILWAY_SERVICE_NAME: "syncbiz-app" }) !== null &&
    core.testTargetRefusal({}) !== null);

  // static scope
  const mig = read("prisma", "migrations", "20261007120000_control_room_f1_brand_zone", "migration.sql");
  const stmts = mig.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--"));
  assert("A12 migration is additive only (no DROP / RENAME / ALTER COLUMN / NOT NULL on existing columns)",
    !/\bDROP\b|\bRENAME\b|ALTER COLUMN|SET NOT NULL|\bDELETE FROM\b|^\s*UPDATE\s/im.test(mig.replace(/ON (DELETE|UPDATE) (SET NULL|CASCADE|RESTRICT|NO ACTION)/g, "")) &&
    stmts.filter((l) => /^ALTER TABLE "(Branch|StationDevice|BranchMasterDesignation)" ADD COLUMN/.test(l)).every((l) => !/NOT NULL/.test(l)));
  assert("A13 partial unique indexes present (at most one default brand / zone)",
    /CREATE UNIQUE INDEX "Brand_one_default_per_workspace" ON "Brand"\("workspaceId"\) WHERE "isDefault";/.test(mig) &&
    /CREATE UNIQUE INDEX "Zone_one_default_per_branch" ON "Zone"\("branchId"\) WHERE "isDefault";/.test(mig));
  const schema = read("prisma", "schema.prisma");
  assert("A14 zoneTypeCode is a String (no ZoneType enum)", /zoneTypeCode String\s+@default\("MAIN"\)/.test(schema) && !/enum ZoneType/.test(schema));
  assert("A15 StationDevice.zoneId / BranchMasterDesignation.zoneId nullable; designation uniqueness unchanged",
    // Scoped to the two models (updated 2026-10-07 for F2a: MemberScopeTarget also has a nullable zoneId — invariant unchanged).
    ["StationDevice", "BranchMasterDesignation"].every((m) => /zoneId\s+String\?/.test(schema.slice(schema.indexOf(`model ${m} {`), schema.indexOf("\n}", schema.indexOf(`model ${m} {`))))) &&
    /@@unique\(\[workspaceId, branchId\]\)\n\s+@@index\(\[zoneId\]\)/.test(schema));
  // Only store.addBranch uses the foundation module; no authz / token / WS / station / playback file touched.
  const users = execSync(`git grep -l --untracked "control-room-foundation" -- app lib components server desktop`, { cwd: ROOT }).toString().trim().split("\n").filter(Boolean).sort();
  assert("A16 SHADOW: only lib/store.ts imports the foundation module", JSON.stringify(users) === JSON.stringify(["lib/store.ts"]), users.join(","));
  const changed = execSync(`git diff --name-only HEAD -- lib app components server desktop middleware.ts`, { cwd: ROOT }).toString().trim().split("\n").filter(Boolean).sort();
  assert("A17 no runtime file changed except lib/store.ts (authz / tokens / WS / station / playback untouched)", changed.every((f) => f === "lib/store.ts"), changed.join(","));

  // ── Part B — real throwaway local Postgres ─────────────────────────────────────────────────────────────────
  if (!DBURL) {
    console.log("SKIP  Part B (set F1_VERIFY_DATABASE_URL to a throwaway local DB with all migrations applied)");
    console.log(`\n${pass} passed, ${fail} failed`);
    return;
  }
  const { prisma } = await import("../lib/prisma");
  const { db: store } = await import("../lib/store");
  const p = prisma as unknown as Record<string, { [k: string]: (a?: unknown) => Promise<unknown> }> & typeof prisma;

  // seed: the TEST shape
  const user = await prisma.user.create({ data: { email: `f1-${Date.now()}@test.local`, name: "F1" } });
  const ws = await prisma.workspace.create({ data: { name: "TEST Workspace", slug: `f1-${Date.now()}`, ownerId: user.id } });
  const canon = await prisma.branch.create({ data: { workspaceId: ws.id, name: "TEST Pilot Branch (legacy default)", code: "T001", legacyKey: "default" } });
  await prisma.stationDevice.create({ data: { durableDeviceId: "dsk-lenovo-f1", workspaceId: ws.id, branchId: canon.id, platform: "win32", appVersion: "2.2.8-beta.12" } });
  await prisma.stationDevice.create({ data: { durableDeviceId: "dsk-devpc-f1", workspaceId: ws.id, branchId: "default", platform: "win32", appVersion: "2.2.8-beta.12" } });
  await prisma.branchMasterDesignation.create({ data: { workspaceId: ws.id, branchId: canon.id, durableDeviceId: "dsk-lenovo-f1", designatedBy: user.id } });
  await prisma.jinglePadAssignment.create({ data: { workspaceId: ws.id, branchId: canon.id, padId: "pad-1", label: "Bell" } });
  await prisma.announcement.create({ data: { workspaceId: ws.id, branchId: canon.id, name: "A1" } });

  const fp0 = await core.fingerprint(prisma);
  const pre = await core.runChecks(prisma);
  assert("B1 before backfill the F1 invariants fail (no brand / zone yet)", !pre.ok && pre.violations.some((v: string) => /default brands/.test(v)));

  const dry = await core.runBackfill(prisma, { dryRun: true });
  assert("B2 dry-run plans 1 brand, 1 branch link, 1 zone, 2 stations, 1 designation", dry.brandsCreated === 1 && dry.branchesLinked === 1 && dry.zonesCreated === 1 && dry.stationsLinked === 2 && dry.designationsLinked === 1, JSON.stringify(dry));
  assert("B3 dry-run wrote nothing", (await prisma.brand.count()) === 0 && (await prisma.zone.count()) === 0);

  const rep = (await prisma.$transaction((tx) => core.runBackfill(tx, { dryRun: false }))) as { unresolved: string[] };
  const post = await core.runChecks(prisma);
  assert("B4 apply backfilled and ALL F1 invariants pass", post.ok, post.violations.join(" | "));
  assert("B5 nothing unresolved", rep.unresolved.length === 0);
  const brand = await prisma.brand.findFirst({ where: { workspaceId: ws.id } });
  const zone = await prisma.zone.findFirst({ where: { branchId: canon.id } });
  assert("B6 default brand MAIN; canonical branch resolves to it", !!brand && brand.code === "MAIN" && brand.isDefault && (await prisma.branch.findUnique({ where: { id: canon.id } }))?.brandId === brand.id);
  assert("B7 one default zone MAIN for the canonical branch", !!zone && zone.isDefault && zone.code === "MAIN" && zone.zoneTypeCode === "MAIN" && (await prisma.zone.count({ where: { branchId: canon.id } })) === 1);
  const st = await prisma.stationDevice.findMany({ orderBy: { durableDeviceId: "asc" } });
  assert("B8 both stations (incl. the legacy \"default\"-keyed one) → that zone; branchId untouched", st.every((s) => s.zoneId === zone!.id) && st.find((s) => s.durableDeviceId === "dsk-devpc-f1")!.branchId === "default");
  const des = await prisma.branchMasterDesignation.findFirst();
  assert("B9 designation → that zone; designated device unchanged", des!.zoneId === zone!.id && des!.durableDeviceId === "dsk-lenovo-f1");
  const fp1 = await core.fingerprint(prisma);
  assert("B10 fingerprint unchanged (workspace / branch ids / stations / designation / assignments / content)", JSON.stringify(fp0) === JSON.stringify(fp1), JSON.stringify(Object.keys(fp0).filter((k) => fp0[k].hash !== fp1[k].hash)));
  assert("B11 no Branch id \"default\", no extra StationDevice / designation rows", (await prisma.branch.count({ where: { id: "default" } })) === 0 && (await prisma.stationDevice.count()) === 2 && (await prisma.branchMasterDesignation.count()) === 1);
  const rep2 = await core.runBackfill(prisma, { dryRun: false });
  assert("B12 second backfill run = NO-OP", rep2.noop === true, JSON.stringify(rep2));

  // DEFAULT UNIQUENESS: the index guarantees AT MOST ONE …
  let dupBrand = "";
  try { await prisma.brand.create({ data: { workspaceId: ws.id, name: "Second", code: "SECOND", isDefault: true } }); } catch (e) { dupBrand = (e as { code?: string }).code ?? "err"; }
  assert("B13 partial index rejects a 2nd default Brand (AT MOST ONE)", dupBrand === "P2002", dupBrand);
  let dupZone = "";
  try { await prisma.zone.create({ data: { workspaceId: ws.id, branchId: canon.id, name: "Other", code: "OTHER", isDefault: true } }); } catch (e) { dupZone = (e as { code?: string }).code ?? "err"; }
  assert("B14 partial index rejects a 2nd default Zone (AT MOST ONE)", dupZone === "P2002", dupZone);
  const pool = await prisma.zone.create({ data: { workspaceId: ws.id, branchId: canon.id, name: "Pool", code: "POOL", zoneTypeCode: "POOL" } });
  assert("B15 non-default zones are unrestricted (multi-zone location)", !!pool.id);
  // … but NOT existence: a location with zero defaults is accepted by the DB and caught by the check script.
  const bare = await prisma.branch.create({ data: { workspaceId: ws.id, name: "Bare (stub path)", code: "BARE" } });
  const chk = await core.runChecks(prisma);
  assert("B16 DB allows ZERO defaults — EXACTLY ONE is proven by the check script (violation reported)", !chk.ok && chk.violations.some((v: string) => v.includes(bare.id)));
  await prisma.branch.delete({ where: { id: bare.id } });

  // transactional legitimate creation (store.addBranch)
  const created = await store.addBranch({ accountId: ws.id, name: "Hotel Tel Aviv" });
  const cz = await prisma.zone.findMany({ where: { branchId: created.id } });
  const cb = await prisma.branch.findUnique({ where: { id: created.id } });
  assert("B17 store.addBranch attaches the default Brand + creates exactly one default Zone", cb!.brandId === brand!.id && cz.length === 1 && cz[0].isDefault && cz[0].code === "MAIN");
  assert("B18 addBranch API shape unchanged (no brand / zone fields leaked)", !("brandId" in (created as object)) && Object.keys(created).sort().join(",") === "accountId,city,code,country,devicesOnline,devicesTotal,id,name,status,timezone");
  const zonesBefore = await prisma.zone.count();
  let dupErr = false;
  try { await store.addBranch({ accountId: ws.id, name: "Dup", id: created.id }); } catch { dupErr = true; }
  assert("B19 failed creation rolls back atomically (no orphan zone)", dupErr && (await prisma.zone.count()) === zonesBefore);
  assert("B20 checks pass after legitimate creation", (await core.runChecks(prisma)).ok);

  // NULL-zone compatibility after backfill (a station registered by the unchanged F1 register path has zoneId NULL)
  await prisma.stationDevice.create({ data: { durableDeviceId: "dsk-new-f1", workspaceId: ws.id, branchId: canon.id, platform: "win32", appVersion: "x" } });
  const chkNull = await core.runChecks(prisma);
  assert("B21 NULL zoneId still RESOLVES to the default zone (F1 invariant holds)", chkNull.ok && chkNull.facts.stationsWithNullZone === 1, chkNull.violations.join(" | "));
  const r1 = await F.resolveZone(ws.id, "default", null);
  const r2 = await F.resolveZone(ws.id, canon.id, pool.id);
  const r3 = await F.resolveZone(ws.id, created.id, pool.id);
  assert("B22 resolveZone: legacy key → default zone; own zone → itself; foreign zone → rejected",
    r1.ok && r1.zoneId === zone!.id && r1.viaDefault && r2.ok && r2.zoneId === pool.id && !r3.ok);
  assert("B23 resolveBrand: canonical + legacy key resolve to the default brand", (await F.resolveBrand(ws.id, canon.id)) === brand!.id && (await F.resolveBrand(ws.id, "default")) === brand!.id);
  // designation integrity: a designation whose station is bound to another zone is reported
  await prisma.stationDevice.update({ where: { durableDeviceId: "dsk-lenovo-f1" }, data: { zoneId: pool.id } });
  assert("B24 check reports a designated station bound to a different zone", (await core.runChecks(prisma)).violations.some((v: string) => /different zone/.test(v)));
  await prisma.stationDevice.update({ where: { durableDeviceId: "dsk-lenovo-f1" }, data: { zoneId: zone!.id } });
  assert("B25 PROD sentinel absent in the test DB", (await core.prodSentinelPresent(prisma)) === false);

  await prisma.$disconnect();
  void p;
  console.log(`\n${pass} passed, ${fail} failed`);
})().catch((e) => { console.error(e); process.exit(1); });
