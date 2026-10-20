/**
 * CONTROL ROOM F1 — TEST-ONLY runner (inside the Railway TEST app container).
 *
 *   VONO_F1_TARGET=TEST node scripts/control-room/f1-backfill.cjs fingerprint   # identity/content fingerprint
 *   VONO_F1_TARGET=TEST node scripts/control-room/f1-backfill.cjs check         # F1 invariants (read-only)
 *   VONO_F1_TARGET=TEST node scripts/control-room/f1-backfill.cjs dry-run       # planned backfill, no writes
 *   VONO_F1_TARGET=TEST node scripts/control-room/f1-backfill.cjs apply         # backfill (one transaction) + check
 *
 * Refuses unless VONO_F1_TARGET=TEST AND the Railway project/service are the TEST ones AND the PROD workspace
 * sentinel is absent from the database. Prints ids / counts only — never secrets or connection strings.
 */
"use strict";
const { PrismaClient } = require("@prisma/client");
const core = require("./f1-foundation.cjs");

(async () => {
  const mode = process.argv[2] || "check";
  const refusal = core.testTargetRefusal(process.env);
  if (refusal) { console.error(`REFUSED (not TEST): ${refusal}`); process.exit(2); }
  const db = new PrismaClient();
  try {
    if (await core.prodSentinelPresent(db)) { console.error("REFUSED: PROD workspace sentinel present in this database"); process.exit(2); }
    let out;
    if (mode === "fingerprint") out = await core.fingerprint(db);
    else if (mode === "check") out = await core.runChecks(db);
    else if (mode === "dry-run") out = await core.runBackfill(db, { dryRun: true });
    else if (mode === "apply") {
      const report = await db.$transaction((tx) => core.runBackfill(tx, { dryRun: false }), { timeout: 60_000 });
      out = { report, check: await core.runChecks(db) };
    } else { console.error(`unknown mode ${mode}`); process.exit(2); }
    console.log(JSON.stringify(out));
  } finally {
    await db.$disconnect();
  }
})().catch((e) => { console.error(String(e && e.message ? e.message : e).slice(0, 400)); process.exit(1); });
