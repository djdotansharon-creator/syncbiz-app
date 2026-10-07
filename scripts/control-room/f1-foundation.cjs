/**
 * CONTROL ROOM F1 — Brand + Zone foundation: backfill / invariant check / fingerprint (CommonJS core).
 *
 * Plain CommonJS on purpose: it runs INSIDE the TEST app container (`node scripts/control-room/f1-backfill.cjs`)
 * with the deployed Prisma client, and is unit-tested with an in-memory fake (scripts/verify-control-room-f1.ts).
 * Constants mirror lib/control-room-foundation.ts (the verify script asserts they match).
 *
 * BACKFILL (idempotent — a second run is a no-op):
 *   1. one default Brand per Workspace (code "MAIN", name = workspace name)
 *   2. Branch.brandId NULL → that default Brand
 *   3. one default Zone per Branch (code "MAIN", name "Main", zoneTypeCode "MAIN")
 *   4. StationDevice.zoneId NULL → the default Zone of its (workspace, branch)   ("default" key → legacyKey alias)
 *   5. BranchMasterDesignation.zoneId NULL → the default Zone of its (workspace, branch)
 * It NEVER creates a Branch, StationDevice or designation, never changes an id / durableDeviceId / branchId /
 * legacyKey, and leaves a row it cannot resolve untouched (reported as "unresolved").
 *
 * DEFAULT UNIQUENESS: the partial unique indexes guarantee AT MOST ONE default; the check below proves EXACTLY ONE.
 * NULL-ZONE COMPATIBILITY: zoneId NULL resolves to the Location's default Zone (F1 semantics only).
 */
"use strict";
const crypto = require("node:crypto");

const DEFAULT_BRAND_CODE = "MAIN";
const DEFAULT_ZONE_CODE = "MAIN";
const DEFAULT_ZONE_NAME = "Main";
const DEFAULT_ZONE_TYPE_CODE = "MAIN";
const LEGACY_DEFAULT_BRANCH_KEY = "default";
/** Railway TEST identity (Control Room / P0 pilot TEST project). */
const TEST_PROJECT_NAME = "syncbiz-pr52-test";
const TEST_APP_SERVICE_NAME = "syncbiz-app-test";
/** The PROD workspace of the pilot Lenovo (docs/VONO_PILOT_BASELINE.md §4) — its presence proves a PROD database. */
const PROD_WORKSPACE_SENTINEL = "f2366813-341d-46ba-a6b8-92d2c1fd39b1";

/** Refuse anything that is not explicitly the Railway TEST app environment. Returns null when OK, else a reason. */
function testTargetRefusal(env) {
  if (env.VONO_F1_TARGET !== "TEST") return "VONO_F1_TARGET=TEST not set";
  if (env.RAILWAY_PROJECT_NAME !== TEST_PROJECT_NAME) return `RAILWAY_PROJECT_NAME is not ${TEST_PROJECT_NAME}`;
  if (env.RAILWAY_SERVICE_NAME !== TEST_APP_SERVICE_NAME) return `RAILWAY_SERVICE_NAME is not ${TEST_APP_SERVICE_NAME}`;
  return null;
}

async function prodSentinelPresent(db) {
  return (await db.workspace.findUnique({ where: { id: PROD_WORKSPACE_SENTINEL }, select: { id: true } })) !== null;
}

/** Location (Branch) for a (workspace, branchId) pair; legacy "default" key → the workspace's legacyKey alias. */
async function findLocation(db, workspaceId, branchId) {
  const b = (branchId || "").trim() || LEGACY_DEFAULT_BRANCH_KEY;
  const byId = await db.branch.findFirst({ where: { workspaceId, id: b }, select: { id: true } });
  if (byId) return byId;
  return db.branch.findFirst({ where: { workspaceId, legacyKey: b }, select: { id: true } });
}

/** Backfill. dryRun=true reports the planned actions without writing. */
async function runBackfill(db, { dryRun }) {
  const report = { dryRun, brandsCreated: 0, branchesLinked: 0, zonesCreated: 0, stationsLinked: 0, designationsLinked: 0, unresolved: [] };
  const workspaces = await db.workspace.findMany({ select: { id: true, name: true }, orderBy: { id: "asc" } });
  for (const ws of workspaces) {
    let brand = await db.brand.findFirst({ where: { workspaceId: ws.id, isDefault: true }, select: { id: true } });
    if (!brand) {
      report.brandsCreated++;
      brand = dryRun
        ? { id: `(planned-brand:${ws.id})` }
        : await db.brand.create({ data: { workspaceId: ws.id, name: (ws.name || "").trim() || "Main", code: DEFAULT_BRAND_CODE, isDefault: true }, select: { id: true } });
    }
    const branches = await db.branch.findMany({ where: { workspaceId: ws.id }, select: { id: true, brandId: true }, orderBy: { id: "asc" } });
    for (const b of branches) {
      if (!b.brandId) {
        report.branchesLinked++;
        if (!dryRun) await db.branch.update({ where: { id: b.id }, data: { brandId: brand.id } });
      }
      const zone = await db.zone.findFirst({ where: { branchId: b.id, isDefault: true }, select: { id: true } });
      if (!zone) {
        report.zonesCreated++;
        if (!dryRun) {
          await db.zone.create({ data: { workspaceId: ws.id, branchId: b.id, name: DEFAULT_ZONE_NAME, code: DEFAULT_ZONE_CODE, zoneTypeCode: DEFAULT_ZONE_TYPE_CODE, isDefault: true } });
        }
      }
    }
  }
  for (const [model, label, key] of [["stationDevice", "StationDevice", "stationsLinked"], ["branchMasterDesignation", "BranchMasterDesignation", "designationsLinked"]]) {
    const rows = await db[model].findMany({ where: { zoneId: null }, select: { id: true, workspaceId: true, branchId: true }, orderBy: { id: "asc" } });
    for (const r of rows) {
      const loc = await findLocation(db, r.workspaceId, r.branchId);
      const zone = loc ? await db.zone.findFirst({ where: { branchId: loc.id, isDefault: true }, select: { id: true } }) : null;
      if (!zone) {
        // dry run: a default zone planned above for this location counts as resolvable
        if (dryRun && loc) { report[key]++; continue; }
        report.unresolved.push(`${label}:${r.id}`);
        continue;
      }
      report[key]++;
      if (!dryRun) await db[model].update({ where: { id: r.id }, data: { zoneId: zone.id } });
    }
  }
  report.noop = report.brandsCreated + report.branchesLinked + report.zonesCreated + report.stationsLinked + report.designationsLinked === 0;
  return report;
}

/** Invariant check (read-only). F1 invariants incl. NULL-zone compatibility resolution. */
async function runChecks(db) {
  const v = [];
  const workspaces = await db.workspace.findMany({ select: { id: true } });
  const brands = await db.brand.findMany({ select: { id: true, workspaceId: true, isDefault: true } });
  const branches = await db.branch.findMany({ select: { id: true, workspaceId: true, brandId: true, legacyKey: true } });
  const zones = await db.zone.findMany({ select: { id: true, workspaceId: true, branchId: true, isDefault: true, zoneTypeCode: true } });
  const stations = await db.stationDevice.findMany({ select: { id: true, durableDeviceId: true, workspaceId: true, branchId: true, zoneId: true } });
  const designations = await db.branchMasterDesignation.findMany({ select: { id: true, workspaceId: true, branchId: true, durableDeviceId: true, zoneId: true } });

  for (const ws of workspaces) {
    const n = brands.filter((b) => b.workspaceId === ws.id && b.isDefault).length;
    if (n !== 1) v.push(`workspace ${ws.id}: ${n} default brands (expected exactly 1)`);
  }
  for (const b of branches) {
    if (b.id === LEGACY_DEFAULT_BRANCH_KEY) v.push(`Branch row with id "default" exists (fake branch)`);
    const brand = brands.find((x) => x.id === b.brandId);
    if (!brand) v.push(`branch ${b.id}: brandId not set / brand missing`);
    else if (brand.workspaceId !== b.workspaceId) v.push(`branch ${b.id}: brand of another workspace`);
    const defs = zones.filter((z) => z.branchId === b.id && z.isDefault).length;
    if (defs !== 1) v.push(`branch ${b.id}: ${defs} default zones (expected exactly 1)`);
  }
  for (const z of zones) {
    const b = branches.find((x) => x.id === z.branchId);
    if (!b || b.workspaceId !== z.workspaceId) v.push(`zone ${z.id}: workspaceId does not match its location`);
    if (!/^[A-Z][A-Z0-9_]{0,39}$/.test(z.zoneTypeCode)) v.push(`zone ${z.id}: invalid zoneTypeCode`);
  }
  const resolveRow = (r) => {
    const raw = (r.branchId || "").trim() || LEGACY_DEFAULT_BRANCH_KEY;
    const loc = branches.find((b) => b.workspaceId === r.workspaceId && (b.id === raw || b.legacyKey === raw));
    if (!loc) return { ok: false, why: "location not found" };
    if (r.zoneId) {
      const z = zones.find((x) => x.id === r.zoneId);
      if (!z) return { ok: false, why: "zone not found" };
      if (z.branchId !== loc.id || z.workspaceId !== r.workspaceId) return { ok: false, why: "zone outside its location" };
      return { ok: true, zoneId: z.id, viaDefault: false };
    }
    const d = zones.filter((z) => z.branchId === loc.id && z.isDefault);
    return d.length === 1 ? { ok: true, zoneId: d[0].id, viaDefault: true } : { ok: false, why: "no default zone" };
  };
  const stationZone = {};
  for (const s of stations) {
    const res = resolveRow(s);
    if (!res.ok) v.push(`station ${s.durableDeviceId}: does not resolve to a zone of its own location (${res.why})`);
    else stationZone[s.durableDeviceId] = { zoneId: res.zoneId, workspaceId: s.workspaceId };
  }
  const perZone = {};
  for (const d of designations) {
    const res = resolveRow(d);
    if (!res.ok) { v.push(`designation ${d.id}: does not resolve to a zone of its own location (${res.why})`); continue; }
    perZone[res.zoneId] = (perZone[res.zoneId] || 0) + 1;
    const st = stationZone[d.durableDeviceId];
    if (!st || st.workspaceId !== d.workspaceId) v.push(`designation ${d.id}: designated device is not a StationDevice of this workspace`);
    else if (st.zoneId !== res.zoneId) v.push(`designation ${d.id}: designated station is bound to a different zone`);
  }
  for (const [z, n] of Object.entries(perZone)) if (n > 1) v.push(`zone ${z}: ${n} designated MASTERs (max 1)`);

  return {
    ok: v.length === 0,
    violations: v,
    facts: {
      workspaces: workspaces.length, brands: brands.length, defaultBrands: brands.filter((b) => b.isDefault).length,
      branches: branches.length, zones: zones.length, defaultZones: zones.filter((z) => z.isDefault).length,
      stations: stations.length, stationsWithNullZone: stations.filter((s) => !s.zoneId).length,
      designations: designations.length, designationsWithNullZone: designations.filter((d) => !d.zoneId).length,
    },
  };
}

/** Fingerprint of the pre-existing identity + content rows F1 must never change (ids / bindings only — no secrets). */
async function fingerprint(db) {
  const h = (rows) => crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex").slice(0, 16);
  const pick = async (model, select, orderBy) => (await db[model].findMany({ select, orderBy })) || [];
  const sets = {
    workspace: await pick("workspace", { id: true }, { id: "asc" }),
    branch: await pick("branch", { id: true, workspaceId: true, legacyKey: true, code: true }, { id: "asc" }),
    stationDevice: await pick("stationDevice", { id: true, durableDeviceId: true, workspaceId: true, branchId: true }, { id: "asc" }),
    branchMasterDesignation: await pick("branchMasterDesignation", { id: true, workspaceId: true, branchId: true, durableDeviceId: true }, { id: "asc" }),
    userBranchAssignment: await pick("userBranchAssignment", { id: true, workspaceId: true, userId: true, branchId: true }, { id: "asc" }),
    playlist: await pick("playlist", { id: true, workspaceId: true, branchId: true }, { id: "asc" }),
    jinglePadAssignment: await pick("jinglePadAssignment", { id: true, workspaceId: true, branchId: true, padId: true }, { id: "asc" }),
    announcement: await pick("announcement", { id: true, workspaceId: true, branchId: true }, { id: "asc" }),
    schedule: await pick("schedule", { id: true, workspaceId: true, branchId: true }, { id: "asc" }),
    source: await pick("source", { id: true, workspaceId: true }, { id: "asc" }),
  };
  const out = {};
  for (const [k, rows] of Object.entries(sets)) out[k] = { count: rows.length, hash: h(rows) };
  return out;
}

module.exports = {
  DEFAULT_BRAND_CODE, DEFAULT_ZONE_CODE, DEFAULT_ZONE_NAME, DEFAULT_ZONE_TYPE_CODE, LEGACY_DEFAULT_BRANCH_KEY,
  TEST_PROJECT_NAME, TEST_APP_SERVICE_NAME, PROD_WORKSPACE_SENTINEL,
  testTargetRefusal, prodSentinelPresent, runBackfill, runChecks, fingerprint,
};
