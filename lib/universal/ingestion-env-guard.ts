/**
 * Phase B0.5 — production safety guard.
 *
 * Backfill / rollback / any provider ingestion MUST NOT run against production. This
 * guard refuses to proceed unless SYNCBIZ_ENV is explicitly "development" or "staging".
 * There is NO silent bypass: an unset or "production" env throws.
 */

export class ProductionSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductionSafetyError";
  }
}

const ALLOWED = new Set(["development", "staging"]);

/**
 * Throws unless SYNCBIZ_ENV ∈ {development, staging}. Call at the very start of any
 * script that writes to (or bulk-reads for a write plan against) the music DB.
 */
export function assertNonProductionEnv(action: string): void {
  const raw = process.env.SYNCBIZ_ENV;
  const env = (raw ?? "").trim().toLowerCase();

  if (env === "production") {
    throw new ProductionSafetyError(
      `REFUSED: "${action}" must never run against production. SYNCBIZ_ENV=production was detected. ` +
        `Point DATABASE_URL at a staging/dev database and set SYNCBIZ_ENV=development or staging.`,
    );
  }
  if (!ALLOWED.has(env)) {
    throw new ProductionSafetyError(
      `REFUSED: "${action}" requires SYNCBIZ_ENV=development or staging (got ${raw === undefined ? "<unset>" : `"${raw}"`}). ` +
        `This guard has no bypass — set the env explicitly, on a non-production database.`,
    );
  }
}

/** Non-secret description of a DB target. NEVER includes the password or full URL. */
export interface DatabaseTarget {
  env: string;
  host: string;
  port: string;
  database: string;
  /** First char + mask only, e.g. "a***". Never the real username in full. */
  userMasked: string;
}

/** Managed-host markers that indicate a cloud/production-class Postgres (e.g. Railway). */
const MANAGED_HOST_MARKERS = ["rlwy.net", "railway.app", "proxy.rlwy", "railway.internal"];
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", ""]);

/**
 * Parse DATABASE_URL into a printable, SECRET-FREE target (host + db + masked user + env).
 * Never returns the password or the full connection string.
 */
export function describeDatabaseTarget(databaseUrl = process.env.DATABASE_URL): DatabaseTarget {
  const env = process.env.SYNCBIZ_ENV ?? "<unset>";
  if (!databaseUrl) return { env, host: "<no DATABASE_URL>", port: "", database: "", userMasked: "" };
  try {
    const u = new URL(databaseUrl);
    const database = decodeURIComponent(u.pathname.replace(/^\//, "")).split("?")[0];
    const userMasked = u.username ? `${u.username[0]}***` : "<none>";
    return { env, host: u.hostname, port: u.port, database, userMasked };
  } catch {
    return { env, host: "<unparseable DATABASE_URL>", port: "", database: "", userMasked: "" };
  }
}

/**
 * Full pre-flight gate for any write/ingestion action. Combines the SYNCBIZ_ENV gate with
 * a DB-target check and RETURNS the (secret-free) target so the caller can print it. Rules:
 *   - SYNCBIZ_ENV must be development|staging (assertNonProductionEnv).
 *   - development → host MUST be local (blocks any remote DB).
 *   - a host equal to SYNCBIZ_PROD_DATABASE_HOST → always blocked.
 *   - staging on a managed host → requires SYNCBIZ_PROD_DATABASE_HOST set, so we can prove
 *     the target is not that production host. No silent bypass.
 */
export function assertSafeIngestionTarget(action: string, databaseUrl = process.env.DATABASE_URL): DatabaseTarget {
  assertNonProductionEnv(action);
  if (!databaseUrl) {
    throw new ProductionSafetyError(`REFUSED: "${action}" has no DATABASE_URL to target.`);
  }
  const target = describeDatabaseTarget(databaseUrl);
  const env = (process.env.SYNCBIZ_ENV ?? "").trim().toLowerCase();
  const host = target.host.toLowerCase();
  const prodHost = (process.env.SYNCBIZ_PROD_DATABASE_HOST ?? "").trim().toLowerCase();

  if (prodHost && host === prodHost) {
    throw new ProductionSafetyError(
      `REFUSED: DATABASE_URL host ("${target.host}") equals SYNCBIZ_PROD_DATABASE_HOST — that is production. Point at a staging/local database.`,
    );
  }

  const isLocal = LOCAL_HOSTS.has(host) || host.endsWith(".localhost");
  const looksManaged = MANAGED_HOST_MARKERS.some((m) => host.includes(m));

  if (env === "development" && !isLocal) {
    throw new ProductionSafetyError(
      `REFUSED: SYNCBIZ_ENV=development requires a LOCAL database host (localhost/127.0.0.1); got "${target.host}".`,
    );
  }
  if (env === "staging" && looksManaged && !prodHost) {
    throw new ProductionSafetyError(
      `REFUSED: staging points at a managed host ("${target.host}") but SYNCBIZ_PROD_DATABASE_HOST is not set, ` +
        `so I cannot verify this is NOT production. Set SYNCBIZ_PROD_DATABASE_HOST to the production host and retry.`,
    );
  }
  return target;
}
