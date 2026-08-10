/**
 * Read-only verification of a LOCAL dev database target. It does NOT connect to any
 * database — it only parses DATABASE_URL + SYNCBIZ_ENV (from .env.development by default)
 * and asserts they describe a safe local dev target:
 *   - SYNCBIZ_ENV = development
 *   - host       = localhost
 *   - database   = syncbiz_dev
 *   - NOT production (reuses the ingestion safety guard)
 *
 *   npm run db:check
 *   npx tsx scripts/check-db-target.ts [envFile]
 */

import fs from "node:fs";
import path from "node:path";
import {
  assertSafeIngestionTarget,
  describeDatabaseTarget,
  ProductionSafetyError,
} from "@/lib/universal/ingestion-env-guard";

const EXPECTED_DB = "syncbiz_dev";
const EXPECTED_HOST = "localhost";
const EXPECTED_ENV = "development";

/** Minimal .env loader (no dependency). Only sets keys not already in process.env. */
function loadEnvFile(file: string): boolean {
  if (!fs.existsSync(file)) return false;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
  return true;
}

const envFile = process.argv[2] ?? ".env.development";
const loaded = loadEnvFile(path.resolve(process.cwd(), envFile));
if (!loaded) console.warn(`(note) ${envFile} not found — checking current process.env instead.`);

let ok = true;
const fail = (msg: string) => {
  ok = false;
  console.error(`  ✗ ${msg}`);
};

const target = describeDatabaseTarget();
// Secret-free: env + host + db + masked user only. No password, no full URL.
console.log(`[target] env=${target.env} host=${target.host} port=${target.port} db=${target.database} user=${target.userMasked}`);

// 1) Reuse the production safety guard (env gate + prod-host gate + dev-must-be-local).
try {
  assertSafeIngestionTarget("db target check");
} catch (e) {
  fail(`safety guard blocked this target: ${e instanceof ProductionSafetyError ? e.message : String(e)}`);
}

// 2) Explicit local-dev expectations requested for this setup.
const env = (process.env.SYNCBIZ_ENV ?? "").trim().toLowerCase();
if (env !== EXPECTED_ENV) fail(`SYNCBIZ_ENV must be "${EXPECTED_ENV}" (got "${process.env.SYNCBIZ_ENV ?? "<unset>"}")`);
if (target.host.toLowerCase() !== EXPECTED_HOST) fail(`host must be "${EXPECTED_HOST}" (got "${target.host}")`);
if (target.database !== EXPECTED_DB) fail(`database must be "${EXPECTED_DB}" (got "${target.database || "<none>"}")`);

if (ok) {
  console.log(`\n✓ OK — local dev target is safe (env=development, host=localhost, db=syncbiz_dev, NOT production).`);
} else {
  console.error(`\n✗ FAILED — fix ${envFile} before running any migrate / backfill. Nothing was connected or changed.`);
  process.exitCode = 1;
}
