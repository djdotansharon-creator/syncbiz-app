/**
 * CONTROL ROOM F2a — TEST-ONLY runner (inside the Railway TEST app container; OFFLINE, no request path involved).
 *
 *   VONO_F1_TARGET=TEST npx tsx scripts/control-room/f2-scope.ts fingerprint | dry-run | apply | check | matrix
 *
 * Refuses unless VONO_F1_TARGET=TEST AND the Railway project / service are the TEST ones AND the PROD workspace
 * sentinel is absent (same guard as F1). Prints ids / counts only — never secrets, emails or connection strings.
 */
import { PrismaClient } from "@prisma/client";
import { checkScopes, fingerprintF2, runMatrix, syncScopes } from "./f2-scope-core";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const guard = require("./f1-foundation.cjs");

(async () => {
  const mode = process.argv[2] ?? "check";
  const refusal = guard.testTargetRefusal(process.env);
  if (refusal) { console.error(`REFUSED (not TEST): ${refusal}`); process.exit(2); }
  const db = new PrismaClient();
  try {
    if (await guard.prodSentinelPresent(db)) { console.error("REFUSED: PROD workspace sentinel present in this database"); process.exit(2); }
    let out: unknown;
    if (mode === "fingerprint") out = await fingerprintF2(db);
    else if (mode === "check") out = await checkScopes(db);
    else if (mode === "dry-run") out = await syncScopes(db, { dryRun: true });
    else if (mode === "apply") {
      const report = await db.$transaction((tx) => syncScopes(tx, { dryRun: false }), { timeout: 60_000 });
      out = { report, check: await checkScopes(db) };
    } else if (mode === "matrix") out = await runMatrix(db);
    else { console.error(`unknown mode ${mode}`); process.exit(2); }
    console.log(JSON.stringify(out));
  } finally {
    await db.$disconnect();
  }
})().catch((e) => { console.error(String(e && (e as Error).message ? (e as Error).message : e).slice(0, 400)); process.exit(1); });
