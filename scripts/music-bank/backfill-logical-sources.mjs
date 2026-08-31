// Backfill LogicalAssetSource from the preview-cache manifest: for every existing sample, map its
// (already-frozen) catalog logicalId ↔ its CURRENT Drive fileId. This is the ONE-TIME capture that
// severs the historical logicalId = a_<sha1(driveFileId)> coupling: from here on, identity lives in
// this table, not in the hash.
//
// Local-only by default. To run against a non-local DB you must pass SYNCBIZ_ALLOW_PROD_DB=1 on
// purpose (production backfill is owner-gated — do NOT run it casually).
//
//   node scripts/music-bank/backfill-logical-sources.mjs [manifestPath]
import { readFileSync, existsSync } from "node:fs";
import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";

const ROOT = "D:/APP Project/syncbiz-app";
for (const raw of readFileSync(`${ROOT}/.env`, "utf-8").split(/\r?\n/)) {
  const l = raw.trim(); if (!l || l.startsWith("#")) continue; const i = l.indexOf("="); if (i < 0) continue;
  const k = l.slice(0, i).trim(); let v = l.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (process.env[k] === undefined) process.env[k] = v;
}

// safety: refuse a non-local DB unless explicitly allowed
const host = (() => { try { return new URL(process.env.DATABASE_URL).hostname; } catch { return "?"; } })();
const isLocal = host === "localhost" || host === "127.0.0.1";
if (!isLocal && process.env.SYNCBIZ_ALLOW_PROD_DB !== "1") {
  console.error(`REFUSED: DATABASE_URL host=${host} is not local. Set SYNCBIZ_ALLOW_PROD_DB=1 to target it on purpose.`);
  process.exit(1);
}

const manifestPath = process.argv[2] || `${ROOT}/desktop/.poc-preview-cache/manifest.json`;
if (!existsSync(manifestPath)) { console.error("manifest not found:", manifestPath); process.exit(1); }
const assets = JSON.parse(readFileSync(manifestPath, "utf-8")).assets || {};
const SOURCE = "google_drive";

const db = new PrismaClient();
async function main() {
  const entries = Object.entries(assets);
  let upserts = 0, provenanceOk = 0, provenanceBad = 0;
  const logicalIds = new Set(), fileIds = new Set();
  for (const [logicalId, a] of entries) {
    const externalId = a.driveFileId;
    if (!externalId) { console.log("SKIP (no driveFileId):", logicalId); continue; }
    // provenance sanity (informational): historical logicalId should equal a_<sha1(fileId)[:16]>
    const calc = "a_" + crypto.createHash("sha1").update(externalId).digest("hex").slice(0, 16);
    calc === logicalId ? provenanceOk++ : provenanceBad++;
    logicalIds.add(logicalId); fileIds.add(externalId);
    await db.logicalAssetSource.upsert({
      where: { source_externalId: { source: SOURCE, externalId } },
      update: { logicalId, isCurrent: true },
      create: { logicalId, source: SOURCE, externalId, isCurrent: true },
    });
    upserts++;
  }
  const rows = await db.logicalAssetSource.count({ where: { source: SOURCE } });
  const distinctLogical = await db.logicalAssetSource.findMany({ where: { source: SOURCE }, distinct: ["logicalId"], select: { logicalId: true } });
  console.log("BACKFILL " + JSON.stringify({
    manifestAssets: entries.length,
    upserts,
    rowsInTable: rows,
    distinctLogicalIds: distinctLogical.length,
    uniqueLogicalIdsInManifest: logicalIds.size,
    uniqueFileIdsInManifest: fileIds.size,
    provenanceOk, provenanceBad,
    pass: entries.length === upserts && rows === upserts && distinctLogical.length === logicalIds.size && logicalIds.size === fileIds.size,
  }));
  await db.$disconnect();
}
main().catch(async (e) => { console.error("ERR", e.message); await db.$disconnect(); process.exit(1); });
