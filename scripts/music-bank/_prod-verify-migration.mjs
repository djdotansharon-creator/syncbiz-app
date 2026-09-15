// TEMP — verify the LogicalAssetSource migration on PRODUCTION. Run ONLY via `railway run` (prod
// DATABASE_URL injected). Read-only. Asserts the target is the prod host before touching anything.
import { PrismaClient } from "@prisma/client";

const url = process.env.DATABASE_URL || "";
let host = "?"; try { host = new URL(url).hostname; } catch {}
if (!/rlwy|proxy|railway/i.test(host)) { console.error("REFUSED: not a production host (host=" + host + ")"); process.exit(3); }

const db = new PrismaClient();
async function main() {
  const tbl = await db.$queryRawUnsafe(`SELECT to_regclass('public."LogicalAssetSource"')::text AS t`);
  const tableExists = !!tbl?.[0]?.t;
  const idx = await db.$queryRawUnsafe(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='LogicalAssetSource' ORDER BY indexname`);
  const hasSourceExternal = idx.some((i) => /UNIQUE/i.test(i.indexdef) && /\bsource\b/.test(i.indexdef) && /externalId/.test(i.indexdef));
  const hasPartialCurrent = idx.some((i) => /UNIQUE/i.test(i.indexdef) && /logicalId/.test(i.indexdef) && /WHERE .*isCurrent/i.test(i.indexdef));
  const rowCount = tableExists ? Number((await db.$queryRawUnsafe(`SELECT count(*)::int AS c FROM "LogicalAssetSource"`))[0].c) : -1;
  console.log(JSON.stringify({
    host, tableExists, rowCount,
    indexes: idx.map((i) => ({ name: i.indexname, def: i.indexdef.replace(/ON public\./, "ON ") })),
    uniqueSourceExternalId: hasSourceExternal,
    partialUniqueCurrentLogicalId: hasPartialCurrent,
    PASS: tableExists && hasSourceExternal && hasPartialCurrent,
  }, null, 2));
  await db.$disconnect();
}
main().catch(async (e) => { console.error("ERR", e?.message || e); try { await db.$disconnect(); } catch {} process.exit(2); });
