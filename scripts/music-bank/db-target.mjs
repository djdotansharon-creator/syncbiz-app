// Safe DB-target resolver for local Music Bank tooling (catalog builder, backfill).
//
// WHY: the repo `.env` is NOT guaranteed local — historically it has pointed DATABASE_URL at Railway
// PRODUCTION while `.env.development` held the local target. Tools here can WRITE (mint mappings), so a
// blind `.env` load could silently touch prod. This forces the SAFE local target by default and requires
// an EXPLICIT, deliberate opt-in to ever reach a non-local DB — the same contract as scripts/prisma-safe.mjs.
import { readFileSync, existsSync } from "node:fs";

function readEnvVar(path, key) {
  if (!existsSync(path)) return null;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const l = raw.trim(); if (!l || l.startsWith("#")) continue; const i = l.indexOf("="); if (i < 0) continue;
    if (l.slice(0, i).trim() === key) {
      let v = l.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      return v;
    }
  }
  return null;
}
function describe(url) { try { const u = new URL(url); return { host: u.hostname, db: (u.pathname || "").replace(/^\//, "") }; } catch { return { host: "(unparseable)", db: "(unparseable)" }; } }

/**
 * Resolve a SAFE DATABASE_URL and set process.env.DATABASE_URL for a subsequent PrismaClient.
 *   - default: force the LOCAL target from .env.development, and REFUSE if it isn't localhost + a *dev* db.
 *   - SYNCBIZ_ALLOW_PROD_DB=1: deliberate opt-in — use the explicit process.env.DATABASE_URL / .env value,
 *     with a loud warning. Never a silent fallback to a possibly-prod `.env`.
 */
export function ensureSafeDbTarget(repoRoot) {
  const allow = /^(1|true|yes)$/i.test(process.env.SYNCBIZ_ALLOW_PROD_DB || "");
  if (allow) {
    const url = process.env.DATABASE_URL || readEnvVar(`${repoRoot}/.env`, "DATABASE_URL");
    if (!url) throw new Error("db-target: SYNCBIZ_ALLOW_PROD_DB set but no DATABASE_URL provided.");
    const t = describe(url);
    console.warn(`⚠️  db-target: EXPLICIT prod opt-in — host=${t.host} db=${t.db}. (deliberate override)`);
    process.env.DATABASE_URL = url;
    return { mode: "explicit", ...t };
  }
  const local = readEnvVar(`${repoRoot}/.env.development`, "DATABASE_URL");
  if (!local) throw new Error("db-target: .env.development DATABASE_URL not found — refusing (cannot resolve a safe local DB).");
  const t = describe(local);
  const isLocal = t.host === "localhost" || t.host === "127.0.0.1";
  const isDev = /dev/.test(t.db) && !/railway|prod/i.test(t.db);
  if (!isLocal || !isDev) {
    throw new Error(`db-target: .env.development target is not safe-local (host=${t.host} db=${t.db}). Refusing. To target prod on purpose: SYNCBIZ_ALLOW_PROD_DB=1 DATABASE_URL=<url> ...`);
  }
  process.env.DATABASE_URL = local;
  console.log(`db-target: safe-local host=${t.host} db=${t.db}.`);
  return { mode: "local", ...t };
}
