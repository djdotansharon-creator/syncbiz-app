#!/usr/bin/env node
/**
 * scripts/backfill-workspace-entitlements.mjs
 *
 * One-time V1 SaaS backfill: create a `WorkspaceEntitlement` row for every
 * existing `Workspace` that doesn't yet have one. Idempotent — safe to
 * re-run any number of times.
 *
 * Per the approved V1 plan:
 *   status      = TRIALING
 *   planCode    = "trial"
 *   trialEndsAt = now + 60 days   (existing-workspace grace window;
 *                                  brand-new signups get 30 days instead,
 *                                  see ensureWorkspaceEntitlement in
 *                                  lib/user-store.ts)
 *   maxBranches / maxDevices / maxUsers / maxPlaylists explicitly set to
 *   the V1 pilot values 1 / 4 / 5 / 20 (1 branch; 1 main desktop player +
 *   1 control computer + 1–2 mobile devices; 5 users; ≥20 playlists).
 *   Mirrored in prisma/schema.prisma and lib/user-store.ts.
 *
 * V1 has NO enforcement code — this row is lifecycle bookkeeping, surfaced
 * read-only at /admin/platform. Suspend/unsuspend writes start in Week 2;
 * gating starts in Week 3 behind a feature flag.
 *
 * Usage:
 *   node --env-file=.env scripts/backfill-workspace-entitlements.mjs
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({ log: ["warn", "error"] });

const TRIAL_DAYS = 60;
const PILOT_LIMITS = {
  maxBranches: 1,
  maxDevices: 4,
  maxUsers: 5,
  maxPlaylists: 20,
};

async function main() {
  const workspaces = await prisma.workspace.findMany({
    select: { id: true, name: true, slug: true },
    orderBy: { createdAt: "asc" },
  });
  console.log(`Found ${workspaces.length} workspace(s).`);
  if (workspaces.length === 0) {
    console.log("Nothing to backfill.");
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const ws of workspaces) {
    try {
      const existing = await prisma.workspaceEntitlement.findUnique({
        where: { workspaceId: ws.id },
        select: { id: true },
      });
      if (existing) {
        skipped++;
        continue;
      }

      await prisma.workspaceEntitlement.create({
        data: {
          workspaceId: ws.id,
          status: "TRIALING",
          planCode: "trial",
          trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
          ...PILOT_LIMITS,
          notes: `backfilled ${today} for V1 pilot`,
        },
      });
      created++;
      console.log(`  + ${ws.name} (${ws.slug})`);
    } catch (e) {
      failed++;
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`  ! ${ws.name} (${ws.slug}): ${msg}`);
    }
  }

  console.log("");
  console.log(
    `Summary: created=${created} skipped=${skipped} failed=${failed} total=${workspaces.length}`,
  );
  if (failed > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
