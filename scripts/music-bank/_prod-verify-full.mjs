// PHASE 6 — authoritative production verification. Run via `railway run` (prod DB) + SYNCBIZ_ALLOW_PROD_DB=1.
// Checks the CURRENT prod state: 176 READY, 1 READY/logicalId, 0 PENDING, 0 FAILED, all fields present,
// integrity (local sha256 == DB contentHash for all 176) + real R2-byte integrity on a per-genre sample.
import fs from "node:fs"; import crypto from "node:crypto"; import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { loadR2, getBuf } from "./r2-client.mjs";

// Repo root resolved from this script's own location (scripts/music-bank/ → repo root),
// so it works regardless of the current working directory it is launched from.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CACHE = join(ROOT, "desktop", ".poc-preview-cache");
if (!/^(1|true|yes)$/i.test(process.env.SYNCBIZ_ALLOW_PROD_DB || "")) { console.error("REFUSED: SYNCBIZ_ALLOW_PROD_DB not set"); process.exit(3); }
let dbHost = "?"; try { dbHost = new URL(process.env.DATABASE_URL || "").hostname; } catch {}
if (!/rlwy|proxy|railway/i.test(dbHost)) { console.error("REFUSED: not prod host=" + dbHost); process.exit(3); }
const cfg = loadR2(join(ROOT, ".env.r2.local"));
const db = new PrismaClient();

async function main() {
  // manifest → per-fileId local sha256 + genre + expected logicalId(via mapping)
  const m = JSON.parse(fs.readFileSync(join(CACHE, "manifest.json"), "utf8"));
  const ready = Object.entries(m.assets || {}).filter(([, a]) => a && a.status === "ready" && a.driveFileId && a.genreId && a.localPath);
  const maps = await db.logicalAssetSource.findMany({ where: { source: "google_drive", isCurrent: true } });
  const fidToLid = Object.fromEntries(maps.map((r) => [r.externalId, r.logicalId]));

  // DB aggregate state
  const readyRows = await db.mediaAsset.findMany({ where: { status: "READY", provider: "R2" } });
  const pending = await db.mediaAsset.count({ where: { status: "PENDING" } });
  const failed = await db.mediaAsset.count({ where: { status: "FAILED" } });
  const retired = await db.mediaAsset.count({ where: { status: "RETIRED" } });

  // one READY per logicalId
  const byLid = {}; for (const r of readyRows) (byLid[r.logicalId] ||= []).push(r);
  const dupReady = Object.entries(byLid).filter(([, v]) => v.length > 1);

  // field completeness + genre counts
  const genreCounts = {}; let fieldsOk = 0;
  for (const r of readyRows) {
    genreCounts[r.genreId] = (genreCounts[r.genreId] || 0) + 1;
    if (r.provider === "R2" && r.bucket === "syncbiz-media-prod" && r.objectKey && r.mimeType && r.sizeBytes != null && Number(r.sizeBytes) > 0 && r.contentHash && r.genreId) fieldsOk++;
  }

  // integrity: for each of the 176 source assets, local sha256 == DB READY row contentHash for its logicalId
  let integrityOk = 0; const integrityBad = [];
  for (const [, a] of ready) {
    const lid = fidToLid[a.driveFileId];
    const rows = byLid[lid] || [];
    const row = rows[0];
    const buf = fs.readFileSync(join(CACHE, a.localPath));
    const sha = crypto.createHash("sha256").update(buf).digest("hex");
    if (row && row.contentHash === sha && row.genreId === a.genreId && Number(row.sizeBytes) === buf.length) integrityOk++;
    else integrityBad.push({ name: a.name, lid, dbHash: row?.contentHash?.slice(0, 12), srcHash: sha.slice(0, 12), status: row ? "hash/size/genre mismatch" : "no READY row" });
  }

  // real R2-byte integrity on a per-genre sample: GET the object, sha256 it, compare to DB contentHash
  const sampleByGenre = {}; for (const r of readyRows) if (!sampleByGenre[r.genreId]) sampleByGenre[r.genreId] = r;
  const r2Integrity = [];
  for (const g of Object.keys(sampleByGenre).sort()) {
    const r = sampleByGenre[g];
    const got = await getBuf(cfg, r.objectKey);
    const sha = got.status === 200 || got.status === 206 ? crypto.createHash("sha256").update(got.buf).digest("hex") : null;
    r2Integrity.push({ genre: g, status: got.status, bytes: got.buf?.length, sha256MatchesDb: sha === r.contentHash });
  }

  const pass = readyRows.length === 176 && dupReady.length === 0 && pending === 0 && failed === 0 && fieldsOk === 176 && integrityOk === 176 && r2Integrity.every((x) => x.sha256MatchesDb);
  console.log("PHASE6 " + JSON.stringify({
    readyR2: readyRows.length, pending, failed, retired, dupReadyLogicalIds: dupReady.length,
    fieldsComplete: fieldsOk, integritySrcVsDb: integrityOk + "/176", genreCounts,
    r2ByteIntegritySample: r2Integrity, integrityBad: integrityBad.slice(0, 5), PASS: pass,
  }, null, 2));
  await db.$disconnect();
  process.exit(pass ? 0 : 1);
}
main().catch(async (e) => { console.error("FATAL", e?.message || e); try { await db.$disconnect(); } catch {} process.exit(2); });
