// PRODUCTION Music Bank ingest runner. Run ONLY via `railway run` (prod DATABASE_URL injected) with
// SYNCBIZ_ALLOW_PROD_DB=1. Modes: "canary" (1 asset per genre) | "full" (all 176). Idempotent +
// resumable (ingestFile skips already-READY content). Verifies DB + R2 + sha256, and transport
// (/api/media → 302 → R2 Range 206) using an in-process minted token. NEVER prints secrets.
import fs from "node:fs"; import crypto from "node:crypto"; import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { loadR2, head } from "./r2-client.mjs";
import { ingestFile, probe } from "./ingest.mjs";

// Repo root resolved from this script's own location (scripts/music-bank/ → repo root),
// so it works regardless of the current working directory it is launched from.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CACHE = join(ROOT, "desktop", ".poc-preview-cache");
const MODE = (process.argv[2] || "canary").toLowerCase();
const PROD_URL = "https://syncbiz-app-production.up.railway.app";

// --- prod guards ---
if (!/^(1|true|yes)$/i.test(process.env.SYNCBIZ_ALLOW_PROD_DB || "")) { console.error("REFUSED: SYNCBIZ_ALLOW_PROD_DB not set"); process.exit(3); }
let dbHost = "?"; try { dbHost = new URL(process.env.DATABASE_URL || "").hostname; } catch {}
if (!/rlwy|proxy|railway/i.test(dbHost)) { console.error("REFUSED: DATABASE_URL not prod host=" + dbHost); process.exit(3); }

const cfg = loadR2(join(ROOT, ".env.r2.local"));

function mintToken(genres) {
  const secret = process.env.SYNCBIZ_MEDIA_SECRET;
  if (!secret || secret.length < 16) throw new Error("SYNCBIZ_MEDIA_SECRET missing");
  const now = Math.floor(Date.now() / 1000);
  const payload = { purpose: "media_access", workspaceId: "prod-ingest-verify", deviceId: "ingest-runner", accessMode: "preview", allowedGenres: genres, iat: now, exp: now + 3600, sid: crypto.randomBytes(9).toString("base64url") };
  const b64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(b64).digest("base64url");
  return `${b64}.${sig}`;
}

const db = new PrismaClient();
async function main() {
  console.log(`[ingest-run] mode=${MODE} dbHost=${dbHost} bucket=${cfg.bucket}`);
  if (cfg.bucket !== "syncbiz-media-prod") { console.error("REFUSED: R2 bucket is not syncbiz-media-prod (got " + cfg.bucket + ")"); process.exit(3); }

  const m = JSON.parse(fs.readFileSync(join(CACHE, "manifest.json"), "utf8"));
  const ready = Object.entries(m.assets || {}).filter(([, a]) => a && a.status === "ready" && a.driveFileId && a.genreId && a.localPath);
  // group by genre
  const byGenre = {};
  for (const [, a] of ready) (byGenre[a.genreId] ||= []).push(a);
  for (const g in byGenre) byGenre[g].sort((x, y) => String(x.name).localeCompare(String(y.name)));

  let targets;
  if (MODE === "canary") targets = Object.keys(byGenre).sort().map((g) => byGenre[g][0]);
  else targets = ready.map(([, a]) => a);

  const results = [];
  let idx = 0;
  for (const a of targets) {
    idx++;
    const filePath = join(CACHE, a.localPath);
    try {
      const r = await ingestFile(cfg, db, { filePath, sourceId: a.driveFileId, name: a.name, genreId: a.genreId });
      results.push({ genre: a.genreId, name: a.name, logicalId: r.logicalId, result: r.result, identity: r.identity, objectKey: r.objectKey });
      if (idx % 20 === 0 || MODE === "canary") console.log(`  [${idx}/${targets.length}] ${r.result} ${a.genreId} ${r.logicalId}`);
    } catch (e) {
      results.push({ genre: a.genreId, name: a.name, driveFileId: a.driveFileId, result: "ERROR", error: (e?.message || String(e)).slice(0, 160) });
      console.error(`  [${idx}/${targets.length}] ERROR ${a.genreId} ${a.name}: ${e?.message || e}`);
    }
  }

  // --- verify each ingested target: DB READY + R2 head + sha256 ---
  const verify = [];
  for (const a of targets) {
    const lid = (results.find((r) => r.name === a.name && r.genre === a.genreId) || {}).logicalId;
    const row = await db.mediaAsset.findFirst({ where: { logicalId: lid, status: "READY" } });
    let r2ok = false, r2size = -1, shaMatch = false, fileSize = -1;
    if (row) {
      const h = await head(cfg, row.objectKey);
      r2ok = h.status === 200; r2size = h.size ?? -1;
      const buf = fs.readFileSync(join(CACHE, a.localPath)); fileSize = buf.length;
      const sha = crypto.createHash("sha256").update(buf).digest("hex");
      shaMatch = sha === row.contentHash && row.objectKey === `assets/${sha}.${(a.name.split(".").pop() || "mp3").toLowerCase()}`;
    }
    verify.push({
      genre: a.genreId, logicalId: lid, dbReady: !!row, provider: row?.provider, bucket: row?.bucket,
      hasObjectKey: !!row?.objectKey, mime: row?.mimeType, sizeBytes: row ? Number(row.sizeBytes) : null,
      r2Head200: r2ok, r2SizeMatch: r2ok && r2size === fileSize, sha256Match: shaMatch, genreMatch: row?.genreId === a.genreId,
    });
  }

  // --- transport: /api/media/<lid> → 302 → R2 Range 206 (sample: all canary; 1-per-genre for full) ---
  const genresForToken = [...new Set(targets.map((a) => a.genreId))];
  const token = mintToken(genresForToken);
  const transportSet = MODE === "canary" ? verify : Object.values(Object.fromEntries(verify.map((v) => [v.genre, v]))); // 1 per genre
  const transport = [];
  for (const v of transportSet) {
    if (!v.logicalId) { transport.push({ genre: v.genre, ok: false, reason: "no logicalId" }); continue; }
    let step = { genre: v.genre, logicalId: v.logicalId };
    try {
      const r1 = await fetch(`${PROD_URL}/api/media/${v.logicalId}?mt=${encodeURIComponent(token)}`, { redirect: "manual" });
      step.mediaStatus = r1.status;
      const loc = r1.headers.get("location");
      step.got302 = r1.status === 302 && !!loc;
      if (step.got302) {
        const r2 = await fetch(loc, { headers: { Range: "bytes=0-1" } });
        step.rangeStatus = r2.status; step.range206 = r2.status === 206;
        step.contentRange = r2.headers.get("content-range");
        try { await r2.arrayBuffer(); } catch {}
      }
      step.ok = step.got302 && step.range206;
    } catch (e) { step.ok = false; step.error = (e?.message || String(e)).slice(0, 120); }
    transport.push(step);
  }

  const ingested = results.filter((r) => r.result === "ingested" || r.result === "idempotent-skip").length;
  const errors = results.filter((r) => r.result === "ERROR");
  const verifyPass = verify.filter((v) => v.dbReady && v.provider === "R2" && v.bucket === "syncbiz-media-prod" && v.hasObjectKey && v.r2Head200 && v.r2SizeMatch && v.sha256Match && v.genreMatch).length;
  const transportPass = transport.filter((t) => t.ok).length;

  console.log("RESULT " + JSON.stringify({
    mode: MODE, targets: targets.length, ingestedOrSkipped: ingested, errors: errors.length,
    verifyPass, verifyTotal: verify.length, transportPass, transportTotal: transport.length,
  }));
  console.log("VERIFY " + JSON.stringify(verify, null, 1));
  console.log("TRANSPORT " + JSON.stringify(transport, null, 1));
  if (errors.length) console.log("ERRORS " + JSON.stringify(errors, null, 1));
  await db.$disconnect();
  process.exit(errors.length || verifyPass !== verify.length || transportPass !== transport.length ? 1 : 0);
}
main().catch(async (e) => { console.error("FATAL", e?.message || e); try { await db.$disconnect(); } catch {} process.exit(2); });
