/**
 * Phase B1 pilot — Apple Music Charts ingestion (FIXTURE mode, LOCAL only).
 *
 *   npx tsx scripts/ingest-apple-music-charts.ts                 # dry-run (default)
 *   npx tsx scripts/ingest-apple-music-charts.ts --apply         # write to LOCAL dev DB
 *   flags: --country=il --chart=TOP --edition=2026-08-04 --fixture=<path>
 *
 * Fixture mode reads a local sample payload — NO network, NO Apple credentials. Guarded to
 * development/localhost/syncbiz_dev. Prints the DB target before any action.
 */

import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { assertSafeIngestionTarget } from "@/lib/universal/ingestion-env-guard";
import { buildSourcePayloadHash } from "@/lib/universal/chart-ingestion";
import { ingestChartSnapshot } from "@/lib/universal/chart-ingestion-runner";
import { AppleMusicChartsProvider, APPLE_MUSIC_PROVIDER_VERSION } from "@/lib/universal/providers/apple-music-charts-provider";
import type { ChartTypeName } from "@/lib/universal/music-intelligence";

function parseArgs(argv: string[]) {
  const flags = new Set<string>();
  const opts: Record<string, string> = {};
  for (const a of argv) {
    if (!a.startsWith("--")) continue;
    const [k, v] = a.slice(2).split("=");
    if (v === undefined) flags.add(k);
    else opts[k] = v;
  }
  return { flags, opts };
}

async function main() {
  const { flags, opts } = parseArgs(process.argv.slice(2));
  const apply = flags.has("apply");
  const country = (opts.country ?? "il").toLowerCase();
  const chartType = (opts.chart ?? "TOP").toUpperCase() as ChartTypeName;
  const editionKey = opts.edition ?? "2026-08-04";
  const fixturePath = path.resolve(process.cwd(), opts.fixture ?? "fixtures/apple-music-charts/il-top-songs.sample.json");

  const target = assertSafeIngestionTarget("apple music charts ingestion");
  console.log(`[target] env=${target.env} host=${target.host} port=${target.port} db=${target.database} user=${target.userMasked}`);
  if (!apply) console.log("DRY-RUN — resolves read-only, writes nothing. Pass --apply to persist (LOCAL dev only).");
  if (!fs.existsSync(fixturePath)) throw new Error(`fixture not found: ${fixturePath}`);
  console.log(`[fixture] ${path.basename(fixturePath)}  country=${country} chart=${chartType} edition=${editionKey}`);

  const provider = new AppleMusicChartsProvider({ fixturePath, storefront: country, providerVersion: APPLE_MUSIC_PROVIDER_VERSION });
  const rawPayloadString = provider.loadRawPayloadString();
  const sourcePayloadHash = buildSourcePayloadHash(rawPayloadString);

  const snapshot = await provider.fetchChart({ chartType, territory: country });
  const capturedAt = new Date().toISOString();

  const prisma = new PrismaClient();
  try {
    const report = await ingestChartSnapshot(prisma, snapshot, {
      apply,
      editionKey,
      capturedAt,
      chartDate: editionKey,
      sourcePayloadHash,
      providerVersion: APPLE_MUSIC_PROVIDER_VERSION,
      ingestionType: "chart",
    });
    const { sampleMatches, ...summary } = report;
    console.log("\n[ingest report]", JSON.stringify(summary, null, 2));
    console.log("\n[sample matches — first 10]");
    for (const m of sampleMatches) {
      console.log(`  #${String(m.rank).padStart(2)} ${m.decision}(${m.confidence.toFixed(2)}) "${m.title}" — ${m.artist}  [${m.reasons.join(", ")}]`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
