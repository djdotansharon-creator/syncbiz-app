/**
 * Prisma PRODUCTION-SAFETY GUARD (P0.2).
 *
 * WHY: the project's root `.env` (git-ignored, local) points DATABASE_URL at the
 * Railway PRODUCTION database. `npx prisma migrate ...` loads `.env` by default, so a
 * careless CLI call can hit production. This wrapper makes the SAFE local path the
 * default and requires an EXPLICIT opt-in to ever touch a non-local DB.
 *
 * USAGE (all safe — forced to local syncbiz_dev):
 *   npm run db:migrate            # prisma migrate dev
 *   npm run db:migrate:status     # prisma migrate status
 *   npm run db:migrate:deploy     # prisma migrate deploy (local)
 *   node scripts/prisma-safe.mjs migrate dev --name my_change
 *
 * INTENTIONAL production use (rare, deliberate) — bypasses the guard on purpose:
 *   SYNCBIZ_ALLOW_PROD_DB=1 DATABASE_URL="<prod-url>" npx prisma migrate deploy
 *
 * The guard NEVER writes to production. It only refuses, or forces the local target.
 */
import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("prisma-safe: no prisma command given (e.g. `migrate status`).");
  process.exit(2);
}

/** Parse DATABASE_URL from an env file WITHOUT overriding already-set process.env. */
function readEnvUrl(file) {
  if (!existsSync(file)) return null;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*DATABASE_URL\s*=\s*(.*?)\s*$/);
    if (m) return m[1].replace(/^["']|["']$/g, "");
  }
  return null;
}

function describe(url) {
  try {
    const u = new URL(url);
    return { host: u.hostname, db: (u.pathname || "").replace(/^\//, "") };
  } catch {
    return { host: "(unparseable)", db: "(unparseable)" };
  }
}

const EXPLICIT_PROD = /^(1|true|yes)$/i.test(process.env.SYNCBIZ_ALLOW_PROD_DB || "");

let childEnv;
if (EXPLICIT_PROD) {
  // Deliberate, explicit opt-in — pass through whatever DATABASE_URL is set.
  const t = describe(process.env.DATABASE_URL || "");
  console.warn(`⚠️  prisma-safe: SYNCBIZ_ALLOW_PROD_DB set — allowing target host=${t.host} db=${t.db}. (explicit override)`);
  childEnv = { ...process.env };
} else {
  // SAFE DEFAULT — force the local dev target from .env.development, ignore root .env (prod).
  const localUrl = readEnvUrl(path.resolve(process.cwd(), ".env.development"));
  if (!localUrl) {
    console.error("prisma-safe: .env.development not found — cannot resolve a safe local DB. Refusing.");
    process.exit(1);
  }
  const t = describe(localUrl);
  const isLocalHost = t.host === "localhost" || t.host === "127.0.0.1";
  const isDevDb = /dev/.test(t.db) && !/railway|prod/i.test(t.db);
  if (!isLocalHost || !isDevDb) {
    console.error(`prisma-safe: refusing — .env.development target is not safe-local (host=${t.host} db=${t.db}). Expected localhost/syncbiz_dev.`);
    console.error("To target production ON PURPOSE: SYNCBIZ_ALLOW_PROD_DB=1 DATABASE_URL=<url> npx prisma ...");
    process.exit(1);
  }
  console.log(`prisma-safe: safe-local target host=${t.host} db=${t.db} (SYNCBIZ_ENV=development).`);
  childEnv = { ...process.env, DATABASE_URL: localUrl, SYNCBIZ_ENV: "development" };
}

const child = spawn("npx", ["prisma", ...args], { stdio: "inherit", shell: true, env: childEnv });
child.on("exit", (code) => process.exit(code ?? 0));
child.on("error", (e) => {
  console.error("prisma-safe: failed to launch prisma:", e.message);
  process.exit(1);
});
