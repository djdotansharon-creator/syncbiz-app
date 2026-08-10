/**
 * Read-only inspection of the universal-music schema on the LOCAL dev DB (B0/B0.5).
 * Verifies tables, indexes, unique constraints, and foreign keys exist, and that the
 * regenerated Prisma Client connects + queries every new model with NO Prisma error.
 *
 * Guarded: refuses to run unless the target is a safe non-production local DB.
 *   npx tsx scripts/inspect-universal-schema.ts
 */

import { PrismaClient } from "@prisma/client";
import { assertSafeIngestionTarget } from "@/lib/universal/ingestion-env-guard";

const GROUPS: Record<string, string[]> = {
  Identity: ["UniversalTrack", "Artist", "TrackArtist", "ProviderMapping", "SourceProvenance", "TrackRelease"],
  Charts: ["ChartSnapshot", "ChartEntry", "TrendSignal", "ChartObservationEntry", "MusicIngestionRun"],
  Radio: ["RadioStation", "RadioAirplayEvent", "StationPlaylistSnapshot", "StationPlaylistEntry"],
  Unresolved: ["ExternalTrackObservation"],
};
// Prisma model accessors (camelCase) for the count/no-error check.
const MODEL_ACCESSORS = [
  "universalTrack", "artist", "trackArtist", "providerMapping", "sourceProvenance", "trackRelease",
  "chartSnapshot", "chartEntry", "trendSignal", "chartObservationEntry", "musicIngestionRun",
  "radioStation", "radioAirplayEvent", "stationPlaylistSnapshot", "stationPlaylistEntry",
  "externalTrackObservation",
] as const;

async function main() {
  const target = assertSafeIngestionTarget("schema inspection");
  console.log(`[target] env=${target.env} host=${target.host} port=${target.port} db=${target.database} user=${target.userMasked}`);

  const prisma = new PrismaClient();
  try {
    const tables = (await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public'`,
    )).map((r) => r.table_name);
    const indexes = await prisma.$queryRawUnsafe<Array<{ tablename: string; indexname: string; indexdef: string }>>(
      `SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname='public'`,
    );
    const constraints = await prisma.$queryRawUnsafe<Array<{ table_name: string; constraint_type: string }>>(
      `SELECT table_name, constraint_type FROM information_schema.table_constraints WHERE table_schema='public'`,
    );

    const tableSet = new Set(tables);
    let missing = 0;
    for (const [group, list] of Object.entries(GROUPS)) {
      console.log(`\n── ${group} ──`);
      for (const t of list) {
        const exists = tableSet.has(t);
        if (!exists) { missing += 1; console.log(`  ✗ ${t}  — MISSING`); continue; }
        const idx = indexes.filter((i) => i.tablename === t);
        const cons = constraints.filter((c) => c.table_name === t);
        const pk = cons.filter((c) => c.constraint_type === "PRIMARY KEY").length;
        const uniq = cons.filter((c) => c.constraint_type === "UNIQUE").length;
        const fk = cons.filter((c) => c.constraint_type === "FOREIGN KEY").length;
        console.log(`  ✓ ${t.padEnd(26)} indexes=${idx.length}  pk=${pk}  unique=${uniq}  fk=${fk}`);
      }
    }

    // Spot-check the headline constraints the design depends on.
    const need = (name: string) => indexes.some((i) => i.indexname === name);
    const checks: Array<[string, boolean]> = [
      ["UniversalTrack.canonicalIsrc unique", need("UniversalTrack_canonicalIsrc_key")],
      ["UniversalTrack.legacyCatalogItemId unique", need("UniversalTrack_legacyCatalogItemId_key")],
      ["ProviderMapping (provider,externalId) unique", need("ProviderMapping_provider_externalId_key")],
      ["ChartSnapshot.editionUid unique", need("ChartSnapshot_editionUid_key")],
      ["Artist.normalizedName unique", need("Artist_normalizedName_key")],
    ];
    console.log(`\n── key unique constraints ──`);
    let missingKeys = 0;
    for (const [label, ok] of checks) { if (!ok) missingKeys += 1; console.log(`  ${ok ? "✓" : "✗"} ${label}`); }

    // Prisma Client ↔ schema: count every new model (proves no "table missing"/mapping error).
    console.log(`\n── Prisma Client model access (counts, must be 0 on fresh DB) ──`);
    let modelErrors = 0;
    const client = prisma as unknown as Record<string, { count: () => Promise<number> }>;
    for (const m of MODEL_ACCESSORS) {
      try {
        const n = await client[m].count();
        console.log(`  ✓ prisma.${m}.count() = ${n}`);
      } catch (e) {
        modelErrors += 1;
        console.log(`  ✗ prisma.${m}.count() FAILED: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    const ok = missing === 0 && missingKeys === 0 && modelErrors === 0;
    console.log(`\n${ok ? "✓ SCHEMA OK" : "✗ SCHEMA INCOMPLETE"} — tablesMissing=${missing} keyConstraintsMissing=${missingKeys} modelErrors=${modelErrors}`);
    process.exitCode = ok ? 0 : 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
