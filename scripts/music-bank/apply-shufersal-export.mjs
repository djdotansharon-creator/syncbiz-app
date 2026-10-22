// SHUFERSAL-DEMO bank — APPLY the dry-run export to a DB. Mirrors the 176-catalog route:
// ingestFile's row model + db-target's explicit-opt-in guard, but INSERT-ONLY from a frozen export
// (shufersal-export.json) so logicalIds are taken VERBATIM and never regenerated at apply time.
//
// SAFETY (TEST ONLY — never PROD):
//   • Requires SYNCBIZ_ALLOW_PROD_DB=1 + an explicit DATABASE_URL (same opt-in as db-target.mjs).
//   • REFUSES if the DB host/name matches /prod/i.
//   • Requires EXPECT_DB_HOST to substring-match the real host (operator confirms the TEST target).
//   • Requires APPLY=1 to write; otherwise PRE-CHECK only (no write).
//   • Pre-check: 0 existing rows for this source/genre (never double-insert).
//   • One transaction. INSERT-ONLY (no update/delete). Asserts +100/+100 delta and that the
//     pre-existing banks (other genres) are UNCHANGED, else throws → full rollback.
//
// Run INSIDE the TEST environment (where the internal DB resolves), e.g. via `railway ssh` in the
// TEST service, exactly like the 176 were replayed in-container.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const EXPORT = process.env.SHUFERSAL_EXPORT || path.join(DIR, "shufersal-export.json");
const SOURCE = "r2-shufersal-demo";
const GENRE = "shufersal-demo";
const APPLY = process.env.APPLY === "1";

function describe(url) { try { const u = new URL(url); return { host: u.hostname, db: (u.pathname || "").replace(/^\//, "") }; } catch { return { host: "(unparseable)", db: "(unparseable)" }; } }

async function main() {
  // When run via `railway run -s Postgres`, the service injects DATABASE_PUBLIC_URL (external proxy,
  // reachable from this machine) + DATABASE_URL (internal, NOT reachable). Prefer the public one for
  // Prisma + the guard so the connection actually works. The secret is injected by railway, never logged.
  if (process.env.DATABASE_PUBLIC_URL) process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL;

  // ── guards ──
  if (!/^(1|true|yes)$/i.test(process.env.SYNCBIZ_ALLOW_PROD_DB || "")) {
    throw new Error("refusing: set SYNCBIZ_ALLOW_PROD_DB=1 + explicit TEST DATABASE_URL (deliberate opt-in).");
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("refusing: DATABASE_URL not set.");
  const t = describe(url);
  if (/prod/i.test(t.host) || /prod/i.test(t.db)) throw new Error(`refusing: target looks like PROD (host=${t.host} db=${t.db}).`);
  const expect = process.env.EXPECT_DB_HOST || "";
  if (!expect || !t.host.includes(expect)) {
    throw new Error(`refusing: EXPECT_DB_HOST must substring-match the real host. real host=${t.host}. Set EXPECT_DB_HOST to confirm the TEST target.`);
  }
  console.log(`apply-shufersal: target host=${t.host} db=${t.db} APPLY=${APPLY}`);

  const exp = JSON.parse(fs.readFileSync(EXPORT, "utf8"));
  const las = exp.logicalAssetSource ?? [];
  const ma = exp.mediaAsset ?? [];
  if (las.length !== 100 || ma.length !== 100) throw new Error(`export must hold 100+100 rows (got ${las.length}+${ma.length}).`);
  // logicalIds verbatim + internally consistent
  const lidSet = new Set(ma.map((r) => r.logicalId));
  if (lidSet.size !== 100) throw new Error("export mediaAsset logicalIds not unique (100).");
  if (!las.every((r) => lidSet.has(r.logicalId))) throw new Error("export source/asset logicalIds mismatch.");

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    // ── BEFORE snapshot ──
    const beforeMA = await prisma.mediaAsset.count();
    const beforeLAS = await prisma.logicalAssetSource.count();
    const beforeShufMA = await prisma.mediaAsset.count({ where: { genreId: GENRE } });
    const beforeShufLAS = await prisma.logicalAssetSource.count({ where: { source: SOURCE } });
    const beforeOtherMA = beforeMA - beforeShufMA; // the existing bank(s) — must stay constant
    const beforeByGenre = await prisma.mediaAsset.groupBy({ by: ["genreId"], _count: { _all: true } });

    if (beforeShufMA !== 0 || beforeShufLAS !== 0) {
      console.log(JSON.stringify({ aborted: "already applied", beforeShufMA, beforeShufLAS }, null, 1));
      return;
    }
    if (!APPLY) {
      console.log(JSON.stringify({ mode: "PRE-CHECK ONLY (APPLY!=1, nothing written)", beforeMA, beforeLAS, beforeShufMA, beforeShufLAS, beforeOtherMA, willInsert: { mediaAsset: 100, logicalAssetSource: 100 } }, null, 1));
      return;
    }

    // ── INSERT-ONLY, one transaction ──
    await prisma.$transaction(async (tx) => {
      await tx.logicalAssetSource.createMany({
        data: las.map((r) => ({ logicalId: r.logicalId, source: r.source, externalId: r.externalId, isCurrent: r.isCurrent !== false })),
      });
      await tx.mediaAsset.createMany({
        data: ma.map((r) => ({
          logicalId: r.logicalId, provider: r.provider || "R2", bucket: r.bucket, objectKey: r.objectKey,
          mimeType: r.mimeType || "audio/mpeg", sizeBytes: BigInt(r.sizeBytes), durationSeconds: r.durationSeconds ?? null,
          contentHash: r.contentHash, contentHashAlgorithm: r.contentHashAlgorithm || "sha256",
          status: "READY", genreId: r.genreId || GENRE, ingestSource: r.ingestSource || SOURCE,
          ingestExternalId: r.ingestExternalId || r.objectKey, lastVerifiedAt: new Date(),
        })),
      });

      // ── assertions inside the txn → any failure rolls back everything ──
      const afterMA = await tx.mediaAsset.count();
      const afterLAS = await tx.logicalAssetSource.count();
      const afterShufMA = await tx.mediaAsset.count({ where: { genreId: GENRE, status: "READY" } });
      const afterShufLAS = await tx.logicalAssetSource.count({ where: { source: SOURCE } });
      const afterOtherMA = afterMA - (await tx.mediaAsset.count({ where: { genreId: GENRE } }));
      if (afterMA - beforeMA !== 100) throw new Error(`MediaAsset delta ${afterMA - beforeMA} ≠ 100`);
      if (afterLAS - beforeLAS !== 100) throw new Error(`LogicalAssetSource delta ${afterLAS - beforeLAS} ≠ 100`);
      if (afterShufMA !== 100) throw new Error(`shufersal READY MediaAsset ${afterShufMA} ≠ 100`);
      if (afterShufLAS !== 100) throw new Error(`shufersal LogicalAssetSource ${afterShufLAS} ≠ 100`);
      if (afterOtherMA !== beforeOtherMA) throw new Error(`existing bank changed: other MediaAsset ${beforeOtherMA} → ${afterOtherMA}`);
      console.log(JSON.stringify({
        mode: "APPLIED (committed)", target: t,
        delta: { mediaAsset: afterMA - beforeMA, logicalAssetSource: afterLAS - beforeLAS },
        shufersalReady: afterShufMA, existingBankUnchanged: afterOtherMA === beforeOtherMA,
        before: { mediaAsset: beforeMA, logicalAssetSource: beforeLAS, byGenre: beforeByGenre },
        after: { mediaAsset: afterMA, logicalAssetSource: afterLAS },
      }, null, 1));
    });
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error("ABORT:", e.message); process.exit(1); });
