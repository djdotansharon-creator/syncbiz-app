/**
 * Local-only: ensure Playwright DJ Creator specs can authenticate.
 *
 * WHY: Login uses `validateCredentialsAsync` — if `User.passwordHash` is set,
 * passwords are verified with scrypt; the legacy `TEST_USERS` map is ignored,
 * so a stale/wrong DB hash breaks E2E that expect test@syncbiz.com / test123.
 *
 * This script is idempotent. It resets the known E2E password hash and guarantees
 * a workspace + membership (same shape as onboarding).
 *
 * Safety gates (either one required):
 *   - Pass CLI flag: `--confirm-local-e2e`
 *   - Or set env: `SYNCBIZ_ALLOW_E2E_USER_SEED=1`
 *
 * Read-only diagnostics:
 *   `--check-only`
 *
 * Examples (PowerShell):
 *   $env:SYNCBIZ_ALLOW_E2E_USER_SEED="1"; npx tsx scripts/seed-e2e-user.ts
 *   npx tsx scripts/seed-e2e-user.ts --check-only
 *   npx tsx scripts/seed-e2e-user.ts --confirm-local-e2e
 */

import { prisma } from "../lib/prisma";
import { hashPassword } from "../lib/password-utils";

const EMAIL = "test@syncbiz.com";
const PASSWORD = "test123";
const TRIAL_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_BRANCH_ID = "default";

const PILOT_LIMITS = {
  maxBranches: 1,
  maxDevices: 4,
  maxUsers: 5,
  maxPlaylists: 20,
} as const;

function gateOk(argv: string[], env: NodeJS.ProcessEnv): boolean {
  return env.SYNCBIZ_ALLOW_E2E_USER_SEED === "1" || argv.includes("--confirm-local-e2e");
}

/** Redact DATABASE_URL — provider + endpoint shape only */
function summarizeDatabaseUrl(raw: string | undefined): string {
  if (!raw?.trim()) return "DATABASE_URL unset (relative to cwd / Prisma env load)";
  const s = raw.trim();
  const scheme = /^([a-z+]+):/i.exec(s)?.[1] ?? "?";
  try {
    const noQuery = s.split("?")[0];
    const rest = /^[a-z+]+:\/\/(?:([^@]+)@)?(.+)$/i.exec(noQuery);
    if (!rest) return `${scheme}: (opaque URL)`;
    const hostRest = rest[2];
    const hostPart = hostRest.includes("/") ? hostRest.slice(0, hostRest.indexOf("/")) : hostRest;
    const dbSlug = hostRest.includes("/") ? hostRest.slice(hostRest.indexOf("/") + 1) : "(no db path)";
    return `${scheme} host=${hostPart} db=${dbSlug}`;
  } catch {
    return `${scheme}: (unable to parse for summary)`;
  }
}

async function printCheck(hasWriteGate: boolean) {
  // eslint-disable-next-line no-console
  console.info("[seed-e2e-user] DATABASE:", summarizeDatabaseUrl(process.env.DATABASE_URL));

  const user = await prisma.user.findUnique({
    where: { email: EMAIL },
    select: { id: true, email: true, passwordHash: true, status: true, role: true },
  });
  const membershipCount = user
    ? await prisma.workspaceMember.count({ where: { userId: user.id } })
    : 0;

  // eslint-disable-next-line no-console
  console.info("[seed-e2e-user] user row:", user ? "exists" : "missing");
  if (user) {
    // eslint-disable-next-line no-console
    console.info(
      `  → id suffix …${user.id.slice(-8)} · role=${user.role} · status=${user.status} · passwordHash=${user.passwordHash ? "set (not shown)" : "null"} · workspaces=${membershipCount}`,
    );
  }

  // eslint-disable-next-line no-console
  console.info(
    hasWriteGate
      ? "[seed-e2e-user] write gate OK — rerun without --check-only to apply."
      : "[seed-e2e-user] pass --confirm-local-e2e or set SYNCBIZ_ALLOW_E2E_USER_SEED=1 to mutate DB.",
  );
}

async function main() {
  const argv = process.argv.slice(2);
  const checkOnly = argv.includes("--check-only");

  const hasGate = gateOk(argv, process.env);

  await printCheck(hasGate);

  if (checkOnly) return;

  if (!hasGate) {
    console.error(
      "[seed-e2e-user] Refusing writes: pass --confirm-local-e2e or set SYNCBIZ_ALLOW_E2E_USER_SEED=1",
    );
    process.exit(1);
  }

  const hashed = hashPassword(PASSWORD);

  const result = await prisma.$transaction(async (tx) => {
    let user = await tx.user.findUnique({ where: { email: EMAIL } });

    if (!user) {
      user = await tx.user.create({
        data: {
          email: EMAIL,
          name: "E2E Test User",
          role: "WORKSPACE_ADMIN",
          passwordHash: hashed,
          status: "ACTIVE",
          deactivatedAt: null,
        },
      });
      // eslint-disable-next-line no-console
      console.info("[seed-e2e-user] created user", EMAIL);
    } else {
      user = await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash: hashed,
          status: "ACTIVE",
          deactivatedAt: null,
          role: "WORKSPACE_ADMIN",
        },
      });
      // eslint-disable-next-line no-console
      console.info("[seed-e2e-user] updated password + active state for", EMAIL);
    }

    let workspace =
      (await tx.workspace.findFirst({
        where: { ownerId: user.id },
        orderBy: { createdAt: "asc" },
      })) ?? null;

    if (!workspace) {
      const slug = `e2e-ws-${user.id.slice(0, 8)}`;
      workspace = await tx.workspace.create({
        data: {
          name: "E2E Workspace",
          slug,
          ownerId: user.id,
          members: { create: { userId: user.id, role: "WORKSPACE_ADMIN" } },
        },
      });

      await tx.userBranchAssignment.upsert({
        where: {
          userId_workspaceId_branchId: {
            userId: user.id,
            workspaceId: workspace.id,
            branchId: DEFAULT_BRANCH_ID,
          },
        },
        update: {},
        create: {
          userId: user.id,
          workspaceId: workspace.id,
          branchId: DEFAULT_BRANCH_ID,
          role: "BRANCH_MANAGER",
        },
      });

      await tx.workspaceEntitlement.upsert({
        where: { workspaceId: workspace.id },
        update: {},
        create: {
          workspaceId: workspace.id,
          status: "TRIALING",
          planCode: "trial",
          trialEndsAt: new Date(Date.now() + TRIAL_MS),
          ...PILOT_LIMITS,
        },
      });

      // eslint-disable-next-line no-console
      console.info("[seed-e2e-user] created workspace", workspace.id);
    }

    await tx.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
      update: { status: "ACTIVE", suspendedAt: null },
      create: {
        workspaceId: workspace.id,
        userId: user.id,
        role: "WORKSPACE_ADMIN",
        status: "ACTIVE",
      },
    });

    await tx.userBranchAssignment.upsert({
      where: {
        userId_workspaceId_branchId: {
          userId: user.id,
          workspaceId: workspace.id,
          branchId: DEFAULT_BRANCH_ID,
        },
      },
      update: {},
      create: {
        userId: user.id,
        workspaceId: workspace.id,
        branchId: DEFAULT_BRANCH_ID,
        role: "BRANCH_MANAGER",
      },
    });

    await tx.workspaceEntitlement.upsert({
      where: { workspaceId: workspace.id },
      update: {},
      create: {
        workspaceId: workspace.id,
        status: "TRIALING",
        planCode: "trial",
        trialEndsAt: new Date(Date.now() + TRIAL_MS),
        ...PILOT_LIMITS,
      },
    });

    return { userId: user.id, workspaceId: workspace.id };
  });

  // eslint-disable-next-line no-console
  console.info(
    `[seed-e2e-user] done — user=${result.userId} · primary workspace=${result.workspaceId} (${EMAIL} / configured password)`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
