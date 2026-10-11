// Music Bank — batch ingest of the Royalty-Free CATALOG (lib/music-bank/poc-catalog.ts) through the EXISTING
// per-file primitive `ingestFile` (scripts/music-bank/ingest.mjs). Owner-approved 2026-10-11 (TEST, dry run first).
//
// Identity contract (the reason this driver exists): every file is ingested with logicalId = its CATALOG id
// (`a_<16 hex>`, what the catalog requests from /api/media/<logicalId>) and genreId = its CATALOG genre id, with
// the Drive fileId as provenance. Calling ingestFile WITHOUT the explicit logicalId would mint a NEW random id and
// the catalog could never resolve the asset — so the driver always passes it and verifies the result.
//
// Uploads are BLOCKED in every mode (the R2 `put` throws): the bytes must already be in the bucket (verified by HEAD).
//
//   DRY RUN (default; writes NOTHING):
//     node scripts/music-bank/ingest-catalog.mjs --dry-run --snapshot <db-snapshot.json>
//     Runs the SAME ingestFile / resolveOrCreateLogicalId code against an in-memory DB seeded from a read-only
//     snapshot of the target DB ({ mediaAsset: [...], logicalAssetSource: [...] }) and records every write it would do.
//     R2: HEAD only (read). Local files: read + sha256 + ffprobe.
//   APPLY (writes the target DB; never uploads): requires --apply AND SYNCBIZ_ALLOW_PROD_DB=1 + DATABASE_URL
//     (db-target.mjs). Owner approval required before running it.
import fs from "node:fs";
import path from "node:path";
import { ingestFile } from "./ingest.mjs";
import { loadR2, head } from "./r2-client.mjs";

const ROOT = "D:/APP Project/syncbiz-app";
const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const snapIdx = argv.indexOf("--snapshot");
const SNAPSHOT = snapIdx >= 0 ? argv[snapIdx + 1] : null;
const SOURCE = "google_drive";

// ── catalog + manifest ──────────────────────────────────────────────────────────────────────────────────────
function readCatalog() {
  const src = fs.readFileSync(`${ROOT}/lib/music-bank/poc-catalog.ts`, "utf8");
  const genres = new Map(); let g = null;
  for (const line of src.split(/\r?\n/)) {
    const mg = line.match(/^      id: "([^"]+)",$/); if (mg) { g = mg[1]; genres.set(g, []); continue; }
    const mt = line.match(/\{ id: "(a_[0-9a-f]{16})"/); if (mt && g) genres.get(g).push(mt[1]);
  }
  return genres;
}
const catalog = readCatalog();
const manifest = JSON.parse(fs.readFileSync(`${ROOT}/desktop/.poc-preview-cache/manifest.json`, "utf8")).assets;

// ── in-memory DB (dry run): just enough of the Prisma surface ingestFile / logical-identity use ───────────────
function makeMemoryDb(snapshot) {
  const tables = { mediaAsset: [...(snapshot.mediaAsset ?? [])], logicalAssetSource: [...(snapshot.logicalAssetSource ?? [])] };
  const writes = [];
  let seq = 0;
  const matches = (row, where) => Object.entries(where).every(([k, v]) => {
    if (k === "NOT") return !matches(row, v);
    if (k === "provider_bucket_objectKey") return row.provider === v.provider && row.bucket === v.bucket && row.objectKey === v.objectKey;
    if (k === "source_externalId") return row.source === v.source && row.externalId === v.externalId;
    if (v && typeof v === "object" && "not" in v) return row[k] !== v.not;
    return row[k] === v;
  });
  const model = (name) => ({
    findUnique: async ({ where }) => tables[name].find((r) => matches(r, where)) ?? null,
    findFirst: async ({ where }) => tables[name].find((r) => matches(r, where)) ?? null,
    create: async ({ data }) => { const row = { id: `dry-${name}-${++seq}`, ...data }; tables[name].push(row); writes.push({ op: "create", model: name, data: row }); return row; },
    update: async ({ where, data }) => { const row = tables[name].find((r) => matches(r, where)); if (!row) throw new Error(`dry ${name}.update: no row`); Object.assign(row, data); writes.push({ op: "update", model: name, id: row.id, data }); return row; },
    updateMany: async ({ where, data }) => { const rows = tables[name].filter((r) => matches(r, where)); for (const r of rows) Object.assign(r, data); if (rows.length) writes.push({ op: "updateMany", model: name, count: rows.length, data }); return { count: rows.length }; },
  });
  const db = { mediaAsset: model("mediaAsset"), logicalAssetSource: model("logicalAssetSource") };
  db.$transaction = async (fn) => fn(db);
  return { db, tables, writes };
}

async function main() {
  // 1. cross-check catalog ↔ manifest ↔ files BEFORE touching anything
  const plan = [];
  for (const [genreId, ids] of catalog) for (const id of ids) {
    const a = manifest[id];
    if (!a) throw new Error(`catalog id ${id} missing in manifest`);
    if (a.genreId !== genreId) throw new Error(`genre mismatch ${id}: catalog ${genreId} vs manifest ${a.genreId}`);
    if (!a.driveFileId) throw new Error(`${id}: no driveFileId`);
    const filePath = path.join(`${ROOT}/desktop/.poc-preview-cache`, path.basename(a.localPath));
    if (!fs.existsSync(filePath)) throw new Error(`${id}: file missing`);
    plan.push({ logicalId: id, genreId, driveFileId: a.driveFileId, filePath, name: path.basename(a.localPath) });
  }
  const manifestOnly = Object.keys(manifest).filter((id) => !plan.some((p) => p.logicalId === id));
  if (manifestOnly.length) throw new Error(`manifest ids not in catalog: ${manifestOnly.length}`);

  // 2. target DB
  let db, mem = null, prisma = null;
  if (APPLY) {
    const { ensureSafeDbTarget } = await import("./db-target.mjs");
    const t = ensureSafeDbTarget(ROOT);
    if (t.mode !== "explicit") throw new Error("--apply requires the explicit SYNCBIZ_ALLOW_PROD_DB=1 + DATABASE_URL target");
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient(); db = prisma;
  } else {
    if (!SNAPSHOT) throw new Error("dry run needs --snapshot <db-snapshot.json> (read-only export of the target DB)");
    mem = makeMemoryDb(JSON.parse(fs.readFileSync(SNAPSHOT, "utf8"))); db = mem.db;
  }

  // 3. R2: HEAD (read) is real; PUT is BLOCKED in every mode
  const cfg = loadR2(`${ROOT}/.env.r2.local`);
  let heads = 0;
  const r2 = {
    head: async (c, key) => { heads++; return head(c, key); },
    put: async () => { throw new Error("UPLOAD_BLOCKED: object not in R2 — uploads are not allowed by this run"); },
  };

  // 4. run the existing primitive per file, in catalog order
  const results = [], failures = [];
  for (const p of plan) {
    try {
      const r = await ingestFile(cfg, db, { filePath: p.filePath, sourceId: p.driveFileId, name: p.name, genreId: p.genreId, logicalId: p.logicalId, source: SOURCE, r2 });
      if (r.result === "rejected") failures.push({ logicalId: p.logicalId, reason: r.reason });
      else if (r.logicalId !== p.logicalId) failures.push({ logicalId: p.logicalId, reason: `identity drift → ${r.logicalId}` });
      else results.push({ ...r, genreId: p.genreId });
    } catch (e) { failures.push({ logicalId: p.logicalId, reason: e.message }); }
  }

  // 5. report
  const created = (model) => mem ? mem.writes.filter((w) => w.op === "create" && w.model === model).length : null;
  const finalReady = mem ? mem.tables.mediaAsset.filter((r) => r.status === "READY") : null;
  const readyByGenre = {}; for (const r of finalReady ?? []) readyByGenre[r.genreId] = (readyByGenre[r.genreId] || 0) + 1;
  const report = {
    mode: APPLY ? "APPLY" : "DRY_RUN (nothing written, nothing uploaded)",
    bucket: cfg.bucket,
    catalogTracks: plan.length, catalogGenres: catalog.size,
    ingested: results.filter((r) => r.result === "ingested").length,
    idempotentSkips: results.filter((r) => r.result === "idempotent-skip").length,
    identityModes: results.reduce((m, r) => ((m[r.identity] = (m[r.identity] || 0) + 1), m), {}),
    alreadyInR2: results.filter((r) => r.resumed === true).length,
    uploads: 0,
    r2HeadRequests: heads,
    failuresOrConflicts: failures.length,
    ...(mem ? {
      wouldCreate: { logicalAssetSource: created("logicalAssetSource"), mediaAsset: created("mediaAsset") },
      wouldCreateTotalRows: created("logicalAssetSource") + created("mediaAsset"),
      finalReadyMediaAssets: finalReady.length, readyGenres: Object.keys(readyByGenre).length, readyByGenre,
      readyIdsEqualCatalogIds: finalReady.length === plan.length && plan.every((p) => finalReady.some((r) => r.logicalId === p.logicalId && r.genreId === p.genreId && r.bucket === cfg.bucket)),
      retiredOrUpdatedExisting: mem.writes.filter((w) => w.op === "updateMany").length,
    } : {}),
  };
  console.log(JSON.stringify(report, null, 1));
  if (failures.length) console.log("FAILURES:", JSON.stringify(failures.slice(0, 10)));
  if (prisma) await prisma.$disconnect();
  if (failures.length) process.exitCode = 1;
}
main().catch((e) => { console.error("ABORT:", e.message); process.exit(1); });
