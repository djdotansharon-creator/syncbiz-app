/**
 * CLI for the CatalogItem → UniversalTrack backfill (Phase B0.1).
 *
 *   npx tsx scripts/backfill-universal-tracks.ts                 # dry-run (default, safe)
 *   npx tsx scripts/backfill-universal-tracks.ts --apply         # write (NON-prod DB only!)
 *   npx tsx scripts/backfill-universal-tracks.ts --rollback      # dry-run rollback preview
 *   npx tsx scripts/backfill-universal-tracks.ts --rollback --apply
 *   flags: --batch=200  --cursor=<catalogItemId>  --limit=1000
 *
 * DO NOT run --apply against production. It connects to whatever DATABASE_URL is set;
 * point it at a disposable copy. Dry-run performs reads only.
 */

import { PrismaClient } from "@prisma/client";
import {
  backfillCatalogToUniversal,
  rollbackBackfill,
  type BackfillOptions,
} from "@/lib/universal/catalog-backfill";
import { assertSafeIngestionTarget } from "@/lib/universal/ingestion-env-guard";

function parseArgs(argv: string[]) {
  const flags = new Set<string>();
  const opts: Record<string, string> = {};
  for (const a of argv) {
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      if (v === undefined) flags.add(k);
      else opts[k] = v;
    }
  }
  return { flags, opts };
}

async function main() {
  // Hard refusal on production — no bypass. Requires SYNCBIZ_ENV=development|staging AND a
  // non-production DB host. Prints the (secret-free) target so it is visible before any work.
  const target = assertSafeIngestionTarget("catalog backfill / rollback");
  console.log(`[target] env=${target.env} host=${target.host} port=${target.port} db=${target.database} user=${target.userMasked}`);

  const { flags, opts } = parseArgs(process.argv.slice(2));
  const apply = flags.has("apply");
  const prisma = new PrismaClient();

  try {
    if (flags.has("rollback")) {
      const res = await rollbackBackfill(prisma, { apply });
      console.log("[rollback]", JSON.stringify(res, null, 2));
      return;
    }

    const options: BackfillOptions = {
      apply,
      batchSize: opts.batch ? Number(opts.batch) : undefined,
      cursor: opts.cursor ?? null,
      limit: opts.limit ? Number(opts.limit) : null,
    };
    if (!apply) console.log("[backfill] DRY-RUN (no writes). Pass --apply to persist (non-prod DB only).");
    const report = await backfillCatalogToUniversal(prisma, options);
    console.log("[backfill]", JSON.stringify(report, null, 2));
    if (report.conflicts.length) console.log(`[backfill] ${report.conflicts.length} conflicts — review before --apply.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
