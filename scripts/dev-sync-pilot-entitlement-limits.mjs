#!/usr/bin/env node
/**
 * scripts/dev-sync-pilot-entitlement-limits.mjs
 *
 * Updates existing WorkspaceEntitlement rows that still reflect the Week 1 row
 * shape from migrations before pilot limits were aligned on the DB defaults
 * maxDevices (4) / maxPlaylists (20): i.e. 1 branch, 1 device, 5 users, 5 playlists.
 *
 * Idempotent — safe to run multiple times. Only touches rows matching that exact
 * legacy signature so admin-edited pilots are unchanged.
 *
 * Dev-only guard: refuses when NODE_ENV=production unless
 * SYNCBIZ_OVERRIDE_PILOT_SYNC=1 is set (escape hatch — use with caution).
 *
 * Usage:
 *   node --env-file=.env scripts/dev-sync-pilot-entitlement-limits.mjs
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({ log: ["warn", "error"] });

const LEGACY_SIGNATURE = {
  maxBranches: 1,
  maxDevices: 1,
  maxUsers: 5,
  maxPlaylists: 5,
};

const PILOT_ROW = {
  maxBranches: 1,
  maxDevices: 4,
  maxUsers: 5,
  maxPlaylists: 20,
};

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.SYNCBIZ_OVERRIDE_PILOT_SYNC !== "1") {
    console.error(
      "Refusing to run under NODE_ENV=production (unset NODE_ENV or set SYNCBIZ_OVERRIDE_PILOT_SYNC=1 to override — not typical).",
    );
    process.exit(1);
  }

  const result = await prisma.workspaceEntitlement.updateMany({
    where: LEGACY_SIGNATURE,
    data: PILOT_ROW,
  });
  console.log(
    `Updated ${result.count} WorkspaceEntitlement row(s) from legacy pilot signature 1/1/5/5 → 1/4/5/20.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
