// TEMP (Phase 1 source preflight) — LOCAL, READ-ONLY. Verifies the preview cache + manifest + catalog +
// local LogicalAssetSource mappings are complete and consistent before any production migration/ingest.
import fs from "node:fs"; import crypto from "node:crypto"; import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { probe } from "./ingest.mjs";
import { ensureSafeDbTarget } from "./db-target.mjs";

// Repo root resolved from this script's own location (scripts/music-bank/ → repo root),
// so it works regardless of the current working directory it is launched from.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CACHE = join(ROOT, "desktop", ".poc-preview-cache");
const MANIFEST = join(CACHE, "manifest.json");
const CATALOG = join(ROOT, "lib", "music-bank", "poc-catalog.ts");

ensureSafeDbTarget(ROOT); // local only (read-only here)
const db = new PrismaClient();

const fail = [];
const note = (cond, label, extra = "") => { if (!cond) fail.push(label + (extra ? " :: " + extra : "")); return cond; };

async function main() {
  const m = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  const assets = Object.entries(m.assets || {}).filter(([, a]) => a && a.status === "ready");
  const total = assets.length;
  note(total === 176, "manifest ready-asset count", `got ${total}`);

  let filesExist = 0, readable = 0, ffOk = 0, shaOk = 0;
  const fileIds = new Set(), missing = [], shaByFile = {};
  for (const [, a] of assets) {
    if (a.driveFileId) fileIds.add(a.driveFileId);
    const abs = join(CACHE, a.localPath || "");
    if (!a.localPath || !fs.existsSync(abs)) { missing.push(a.localPath || a.name); continue; }
    filesExist++;
    let buf;
    try { buf = fs.readFileSync(abs); readable++; } catch { continue; }
    const v = probe(abs);
    if (v.ok && (v.durationSeconds == null || v.durationSeconds >= 0)) ffOk++;
    try { const h = crypto.createHash("sha256").update(buf).digest("hex"); if (/^[0-9a-f]{64}$/.test(h)) { shaOk++; shaByFile[a.driveFileId] = h; } } catch {}
  }
  note(filesExist === 176, "files exist", `${filesExist}/176 (missing: ${missing.slice(0, 5).join(", ")})`);
  note(readable === 176, "files readable", `${readable}/176`);
  note(ffOk === 176, "ffprobe ok", `${ffOk}/176`);
  note(shaOk === 176, "sha256 computable", `${shaOk}/176`);
  note(fileIds.size === 176, "unique Drive fileIds (manifest)", `${fileIds.size}`);

  // catalog logicalIds
  const catTs = fs.readFileSync(CATALOG, "utf8");
  const catIds = [...catTs.matchAll(/id:\s*"(a_[0-9a-f]+)"/g)].map((x) => x[1]);
  const catSet = new Set(catIds);
  note(catIds.length === 176, "catalog track count", `${catIds.length}`);
  note(catSet.size === 176, "catalog unique logicalIds", `${catSet.size}`);

  // local mappings
  const rows = await db.logicalAssetSource.findMany({ where: { source: "google_drive", isCurrent: true } });
  const mapLids = new Set(rows.map((r) => r.logicalId));
  const mapFids = new Set(rows.map((r) => r.externalId));
  note(rows.length === 176, "current mappings", `${rows.length}`);
  note(mapLids.size === 176, "unique mapping logicalIds", `${mapLids.size}`);
  note(mapFids.size === 176, "unique mapping externalIds", `${mapFids.size}`);
  // duplicate mapping detection (any externalId with >1 current, or logicalId with >1 current)
  const allCur = await db.logicalAssetSource.groupBy({ by: ["externalId"], where: { source: "google_drive", isCurrent: true }, _count: true });
  const dupExt = allCur.filter((g) => g._count > 1);
  note(dupExt.length === 0, "no duplicate current externalId", `dups=${dupExt.length}`);

  // cross-consistency
  const lidMatchesCatalog = [...mapLids].every((l) => catSet.has(l)) && [...catSet].every((l) => mapLids.has(l));
  note(lidMatchesCatalog, "mapping logicalIds == catalog logicalIds (exact set)");
  const fidsMatchManifest = [...mapFids].every((f) => fileIds.has(f)) && [...fileIds].every((f) => mapFids.has(f));
  note(fidsMatchManifest, "mapping externalIds == manifest driveFileIds (exact set)");
  // provenance sanity: historical logicalId == a_sha1(fileId)[:16]
  let provOk = 0;
  for (const r of rows) { const calc = "a_" + crypto.createHash("sha1").update(r.externalId).digest("hex").slice(0, 16); if (calc === r.logicalId) provOk++; }

  console.log(JSON.stringify({
    total, filesExist, readable, ffOk, shaOk,
    uniqueFileIds: fileIds.size, catalogIds: catIds.length, catalogUnique: catSet.size,
    mappings: rows.length, uniqueMapLids: mapLids.size, uniqueMapFids: mapFids.size,
    dupExternalId: dupExt.length, lidMatchesCatalog, fidsMatchManifest, provenanceEqualsSha1: provOk,
    PASS: fail.length === 0, failures: fail,
  }, null, 2));
  await db.$disconnect();
  process.exit(fail.length ? 1 : 0);
}
main().catch(async (e) => { console.error("ERR", e?.message || e); try { await db.$disconnect(); } catch {} process.exit(2); });
