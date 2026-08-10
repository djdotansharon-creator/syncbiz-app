/**
 * Phase V3/V4 — LOCAL validation report for the universal backfill + resolver.
 * Read-only. Prints entity counts, structural verifications, a deterministic fingerprint
 * (for idempotency comparison across apply/rollback/reapply), and — with --calibrate — a
 * resolver decision/confidence distribution + review lists. Never writes. Guarded to local.
 *
 *   npx tsx scripts/validate-universal-report.ts
 *   npx tsx scripts/validate-universal-report.ts --calibrate
 */

import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { assertSafeIngestionTarget } from "@/lib/universal/ingestion-env-guard";
import { splitArtists } from "@/lib/universal/normalize";
import { resolveUniversalTrack, type ResolverPrisma } from "@/lib/universal/catalog-resolver";
import { SEED_MARKER } from "./seed-universal-validation-catalog";

async function main() {
  const calibrate = process.argv.includes("--calibrate");
  const target = assertSafeIngestionTarget("validation report");
  console.log(`[target] env=${target.env} host=${target.host} db=${target.database} user=${target.userMasked}`);

  const prisma = new PrismaClient();
  try {
    // ── Counts ──
    const [catalogTotal, seedCatalog, universalTrack, artist, trackArtist, providerMapping, sourceProvenance, trackRelease] =
      await Promise.all([
        prisma.catalogItem.count(),
        prisma.catalogItem.count({ where: { curationNotes: { contains: SEED_MARKER } } }),
        prisma.universalTrack.count(),
        prisma.artist.count(),
        prisma.trackArtist.count(),
        prisma.providerMapping.count(),
        prisma.sourceProvenance.count(),
        prisma.trackRelease.count(),
      ]);
    console.log("\n[counts]", JSON.stringify({ catalogTotal, seedCatalog, universalTrack, artist, trackArtist, providerMapping, sourceProvenance, trackRelease }, null, 2));

    // ── Fingerprint (uuid-independent; identical seed → identical fingerprint) ──
    const mappings = await prisma.providerMapping.findMany({ select: { provider: true, externalId: true } });
    const uts = await prisma.universalTrack.findMany({ select: { legacyCatalogItemId: true, normalizedTitle: true } });
    const fingerprint = crypto.createHash("sha1").update(JSON.stringify({
      counts: { universalTrack, artist, trackArtist, providerMapping, sourceProvenance },
      mappings: mappings.map((m) => `${m.provider}|${m.externalId}`).sort(),
      legacy: uts.map((u) => u.legacyCatalogItemId).sort(),
      titles: uts.map((u) => u.normalizedTitle).sort(),
    })).digest("hex");
    console.log(`[fingerprint] ${fingerprint}`);

    // ── Structural verifications ──
    const bridged = await prisma.universalTrack.count({ where: { legacyCatalogItemId: { not: null } } });
    const provenanceBackfill = await prisma.sourceProvenance.count({ where: { source: "catalog_backfill" } });

    // duration mapping sample
    const durSample = await prisma.universalTrack.findMany({
      where: { legacyCatalogItemId: { not: null }, durationMs: { not: null } },
      select: { durationMs: true, legacyCatalogItem: { select: { durationSec: true } } },
      take: 200,
    });
    const durOk = durSample.filter((u) => u.legacyCatalogItem && u.durationMs === (u.legacyCatalogItem.durationSec ?? -1) * 1000).length;

    // multi-artist order sample
    const multi = await prisma.universalTrack.findFirst({
      where: { artists: { some: {} }, displayTitle: "Neon Skyline" },
      select: { displayTitle: true, artists: { select: { order: true, role: true, artist: { select: { displayName: true } } }, orderBy: { order: "asc" } } },
    });

    // version detection sample (the version matrix)
    const versionSample = await prisma.universalTrack.findMany({
      where: { displayTitle: { startsWith: "Midnight Avenue" } },
      select: { displayTitle: true, versionType: true },
      orderBy: { displayTitle: "asc" },
    });

    console.log("\n[verify]", JSON.stringify({
      bridgedUniversalTracks: bridged,
      provenanceBackfill,
      durationMappedSampleOk: `${durOk}/${durSample.length}`,
      multiArtist: multi ? { title: multi.displayTitle, artists: multi.artists.map((a) => `${a.order}:${a.role}:${a.artist.displayName}`) } : "NOT FOUND",
      catalogUnchanged: `${seedCatalog} seed rows present (total catalog=${catalogTotal})`,
    }, null, 2));
    console.log("[verify.versionDetection]");
    for (const v of versionSample) console.log(`  ${(v.versionType ?? "null").padEnd(12)} ← ${v.displayTitle}`);

    if (!calibrate) return;

    // ── V4: resolver calibration over seed-derived queries (no external id → fuzzy path) ──
    const rows = await prisma.catalogItem.findMany({
      where: { curationNotes: { contains: SEED_MARKER } },
      select: { id: true, title: true, artist: true, durationSec: true, curationNotes: true },
    });
    const decisions = { auto_match: 0, ambiguous: 0, unresolved: 0 };
    const conf = { "<0.60": 0, "0.60-0.69": 0, "0.70-0.89": 0, ">=0.90": 0 };
    let hardBlock = 0;
    let versionMismatch = 0;
    const review: Record<string, string[]> = {
      possibleFalsePositive: [], sameTitleDiffArtist: [], originalVsRemaster: [],
      remixVsOriginal: [], radioEditVsExtended: [], hebrewArabic: [], missingMetadata: [],
    };
    const tagOf = (notes: string | null) => (notes ?? "").replace(SEED_MARKER, "").trim();

    for (const row of rows) {
      const q = { title: row.title, artists: splitArtists(row.artist), durationMs: row.durationSec ? row.durationSec * 1000 : undefined };
      const r = await resolveUniversalTrack(prisma as unknown as ResolverPrisma, q);
      decisions[r.decision] += 1;
      const c = r.confidence;
      if (c < 0.6) conf["<0.60"] += 1; else if (c < 0.7) conf["0.60-0.69"] += 1; else if (c < 0.9) conf["0.70-0.89"] += 1; else conf[">=0.90"] += 1;
      if (r.warnings.some((w) => w.startsWith("version block"))) hardBlock += 1;
      if (r.versionMismatch && r.versionMismatch.length > 0) versionMismatch += 1;

      const tag = tagOf(row.curationNotes);
      const line = `${r.decision}(${c.toFixed(2)}) "${row.title}" — ${row.artist ?? "<no artist>"}`;

      // real false-positive check: auto-matched to a DIFFERENT song's UniversalTrack
      if (r.decision === "auto_match" && r.match) {
        const legacy = await prisma.universalTrack.findUnique({ where: { id: r.match.id }, select: { legacyCatalogItemId: true } });
        if (legacy && legacy.legacyCatalogItemId && legacy.legacyCatalogItemId !== row.id) {
          review.possibleFalsePositive.push(`${line}  → matched a DIFFERENT catalog row`);
        }
      }
      if (tag.startsWith("match:same-title-diff-artist")) review.sameTitleDiffArtist.push(line);
      if (tag === "version:Remaster" || tag === "version:Original") review.originalVsRemaster.push(line);
      if (tag === "version:Remix") review.remixVsOriginal.push(line);
      if (tag === "version:Radio Edit" || tag === "version:Extended") review.radioEditVsExtended.push(line);
      if (tag.startsWith("lang:he") || tag.startsWith("lang:ar")) review.hebrewArabic.push(line);
      if (tag.startsWith("meta:no-")) review.missingMetadata.push(line);
    }

    console.log("\n[calibration] decisions", JSON.stringify(decisions));
    console.log("[calibration] confidence", JSON.stringify(conf));
    console.log(`[calibration] hardBlock=${hardBlock} versionMismatchInBest=${versionMismatch} thresholds=auto>=0.90 ambiguous0.70-0.89 unresolved<0.70`);
    for (const [k, v] of Object.entries(review)) {
      console.log(`\n[review:${k}] (${v.length})`);
      for (const line of v.slice(0, 12)) console.log(`  ${line}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
