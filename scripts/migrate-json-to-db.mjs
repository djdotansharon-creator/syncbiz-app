#!/usr/bin/env node
/**
 * scripts/migrate-json-to-db.mjs
 *
 * One-time migration: copy all existing JSON file data into PostgreSQL.
 * Idempotent — safe to run multiple times (upserts everywhere).
 *
 * Usage:
 *   node scripts/migrate-json-to-db.mjs
 */

// Load .env manually (no dotenv dependency needed — Node 20.6+ has --env-file flag)
// Run with: node --env-file=.env scripts/migrate-json-to-db.mjs
import { PrismaClient } from "@prisma/client";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const prisma = new PrismaClient({ log: ["warn", "error"] });

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readJson(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch (e) {
    console.warn(`  ⚠ Could not parse ${filePath}: ${e.message}`);
    return null;
  }
}

function tenantRoleToUserRole(role) {
  if (role === "TENANT_OWNER") return "WORKSPACE_ADMIN";
  if (role === "TENANT_ADMIN") return "MANAGER";
  return "CONTROLLER";
}

// ─── Phase 1: Users & Workspaces ─────────────────────────────────────────────

async function migrateUsersAndWorkspaces() {
  console.log("\n[1/7] Migrating users & workspaces...");

  const data = readJson(join(ROOT, "data", "users.json"));
  if (!data) {
    console.log("  ⚠ data/users.json not found — skipping");
    return {};
  }

  const {
    tenants = [],
    users = [],
    memberships = [],
    branchAssignments = [],
    resetTokens = [],
  } = data;

  // Build: tenantId → first TENANT_OWNER userId
  const tenantOwnerMap = {};
  for (const m of memberships) {
    if (m.role === "TENANT_OWNER" && !tenantOwnerMap[m.tenantId]) {
      tenantOwnerMap[m.tenantId] = m.userId;
    }
  }

  // 1a. Upsert all users (needed before workspaces due to ownerId FK)
  let userCount = 0;
  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      create: {
        id: u.id,
        email: u.email,
        name: u.name ?? null,
        passwordHash: u.passwordHash ?? null,
        role: "CONTROLLER",
        createdAt: u.createdAt ? new Date(u.createdAt) : undefined,
      },
      update: {
        name: u.name ?? undefined,
        passwordHash: u.passwordHash ?? undefined,
      },
    });
    userCount++;
  }
  console.log(`  ✓ ${userCount} users upserted`);

  // 1b. Upsert workspaces
  // Returns map: oldTenantId → workspace.id (UUID)
  const workspaceIdMap = {};

  let wsCount = 0;
  for (const t of tenants) {
    const ownerId = tenantOwnerMap[t.id];
    if (!ownerId) {
      console.log(`  ⚠ No owner found for tenant ${t.id} — skipping`);
      continue;
    }

    // findUnique by slug first so we get the existing id, or create it
    let ws = await prisma.workspace.findUnique({ where: { slug: t.id } });
    if (!ws) {
      ws = await prisma.workspace.create({
        data: {
          name: t.name,
          slug: t.id,          // slug = old tenant ID — used by resolveWorkspaceId()
          ownerId,
          createdAt: t.createdAt ? new Date(t.createdAt) : undefined,
        },
      });
    }

    workspaceIdMap[t.id] = ws.id;
    wsCount++;
  }

  // Alias: acct-demo-001 is the same workspace as tnt-default
  if (workspaceIdMap["tnt-default"]) {
    workspaceIdMap["acct-demo-001"] = workspaceIdMap["tnt-default"];
  }

  console.log(`  ✓ ${wsCount} workspaces upserted`);

  // 1c. Upsert WorkspaceMembers
  let memberCount = 0;
  for (const m of memberships) {
    const wsId = workspaceIdMap[m.tenantId];
    if (!wsId) continue;
    await prisma.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: wsId, userId: m.userId } },
      create: {
        workspaceId: wsId,
        userId: m.userId,
        role: tenantRoleToUserRole(m.role),
      },
      update: { role: tenantRoleToUserRole(m.role) },
    });
    memberCount++;
  }
  console.log(`  ✓ ${memberCount} workspace members upserted`);

  // 1d. Upsert UserBranchAssignments
  // workspaceId = the workspace of the user's primary tenantId
  const userTenantMap = {};
  for (const u of users) userTenantMap[u.id] = u.tenantId;

  let assignCount = 0;
  for (const a of branchAssignments) {
    const tenantId = userTenantMap[a.userId];
    if (!tenantId) continue;
    const wsId = workspaceIdMap[tenantId];
    if (!wsId) continue;

    await prisma.userBranchAssignment.upsert({
      where: {
        userId_workspaceId_branchId: {
          userId: a.userId,
          workspaceId: wsId,
          branchId: a.branchId,
        },
      },
      create: {
        userId: a.userId,
        workspaceId: wsId,
        branchId: a.branchId,
        role: a.role,
      },
      update: { role: a.role },
    });
    assignCount++;
  }
  console.log(`  ✓ ${assignCount} branch assignments upserted`);

  // 1e. Upsert PasswordResetTokens
  let tokenCount = 0;
  for (const t of resetTokens) {
    await prisma.passwordResetToken.upsert({
      where: { tokenHash: t.tokenHash },
      create: {
        tokenHash: t.tokenHash,
        userId: t.userId,
        createdAt: new Date(t.createdAt),
        expiresAt: new Date(t.expiresAt),
      },
      update: {},
    });
    tokenCount++;
  }
  console.log(`  ✓ ${tokenCount} password reset tokens upserted`);

  return workspaceIdMap;
}

// ─── Phase 2: Branches ────────────────────────────────────────────────────────
// Branch.id is stored as the original legacy string (e.g. "default", "bldn-001").
// This matches the upsert pattern in store.ts so they stay in sync.

async function migrateBranches(workspaceIdMap) {
  console.log("\n[2/7] Migrating branches...");

  const defaultWsId = workspaceIdMap["tnt-default"];
  if (!defaultWsId) {
    console.log("  ⚠ No default workspace found — skipping branches");
    return;
  }

  // Collect all unique branchIds referenced in devices + schedules
  const branchIds = new Set();
  const devices = readJson(join(ROOT, "data", "devices.json")) ?? [];
  const schedules = readJson(join(ROOT, "data", "schedules.json")) ?? [];

  for (const d of devices) if (d.branchId) branchIds.add(d.branchId);
  for (const s of schedules) if (s.branchId) branchIds.add(s.branchId);

  let count = 0;
  for (const branchId of branchIds) {
    await prisma.branch.upsert({
      where: { id: branchId },
      update: {},
      create: {
        id: branchId,
        workspaceId: defaultWsId,
        name: branchId === "default" ? "Default Branch" : branchId,
        code: branchId.toUpperCase().replace(/[^A-Z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toUpperCase().slice(0, 24) || "BRANCH",
        status: "active",
      },
    });
    count++;
  }
  console.log(`  ✓ ${count} branches upserted`);
}

// ─── Phase 3: Sources ─────────────────────────────────────────────────────────

async function migrateSources(workspaceIdMap) {
  console.log("\n[3/7] Migrating sources...");

  const sources = readJson(join(ROOT, "data", "sources.json"));
  if (!sources) {
    console.log("  ⚠ data/sources.json not found — skipping");
    return;
  }

  let count = 0;
  for (const s of sources) {
    const wsId = workspaceIdMap[s.accountId] ?? workspaceIdMap["tnt-default"];
    if (!wsId) { console.log(`  ⚠ No workspace for source ${s.id}`); continue; }

    await prisma.source.upsert({
      where: { id: s.id },
      create: {
        id: s.id,
        workspaceId: wsId,
        name: s.name,
        url: s.target ?? "",
        type: s.type,
        branchId: s.branchId ?? "default",
        description: s.description ?? null,
        capabilities: s.capabilities ?? [],
        isLive: s.isLive ?? false,
        provider: s.provider ?? null,
        playerMode: s.playerMode ?? null,
        tags: s.tags ?? [],
      },
      update: {
        name: s.name,
        url: s.target ?? "",
        type: s.type,
        isLive: s.isLive ?? false,
        tags: s.tags ?? [],
      },
    });
    count++;
  }
  console.log(`  ✓ ${count} sources upserted`);
}

// ─── Phase 4: Devices ─────────────────────────────────────────────────────────

async function migrateDevices(workspaceIdMap) {
  console.log("\n[4/7] Migrating devices...");

  const devices = readJson(join(ROOT, "data", "devices.json"));
  if (!devices) {
    console.log("  ⚠ data/devices.json not found — skipping");
    return;
  }

  let count = 0;
  for (const d of devices) {
    const wsId = workspaceIdMap[d.accountId] ?? workspaceIdMap["tnt-default"];
    if (!wsId) { console.log(`  ⚠ No workspace for device ${d.id}`); continue; }

    // Ensure branch stub exists (same pattern as store.ts addDevice)
    if (d.branchId) {
      await prisma.branch.upsert({
        where: { id: d.branchId },
        update: {},
        create: {
          id: d.branchId,
          workspaceId: wsId,
          name: d.branchId,
          code: d.branchId.toUpperCase().replace(/[^A-Z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toUpperCase().slice(0, 24) || "BRANCH",
        },
      });
    }

    await prisma.device.upsert({
      where: { id: d.id },
      create: {
        id: d.id,
        workspaceId: wsId,
        branchId: d.branchId ?? "default",
        name: d.name,
        deviceKind: d.type ?? "audio-player",
        type: "ELECTRON",          // closest Prisma enum; real kind is in deviceKind
        platform: d.platform ?? "windows",
        deviceStatus: d.status ?? "offline",
        health: d.health ?? "ok",
        capabilities: d.capabilities ?? [],
        lastHeartbeat: d.lastHeartbeat ?? d.lastSeen ?? null,
        ipAddress: d.ipAddress ?? "",
        agentVersion: d.agentVersion ?? "1.0.0",
        volume: d.volume ?? 50,
        currentSourceId: d.currentSourceId ?? null,
        lastSeenAt: d.lastSeen ? new Date(d.lastSeen) : null,
        token: randomUUID(),       // legacy devices have no token; generate one
        isOnline: d.status === "online",
      },
      update: {
        name: d.name,
        deviceKind: d.type ?? "audio-player",
        deviceStatus: d.status ?? "offline",
        health: d.health ?? "ok",
        volume: d.volume ?? 50,
        currentSourceId: d.currentSourceId ?? null,
      },
    });
    count++;
  }
  console.log(`  ✓ ${count} devices upserted`);
}

// ─── Phase 5: Playlists ───────────────────────────────────────────────────────

async function migratePlaylists(workspaceIdMap) {
  console.log("\n[5/7] Migrating playlists...");

  const playlistsDir = join(ROOT, "playlists");
  if (!existsSync(playlistsDir)) {
    console.log("  ⚠ playlists/ directory not found — skipping");
    return;
  }

  const files = readdirSync(playlistsDir).filter((f) => f.endsWith(".json"));
  let count = 0;
  let skipped = 0;

  for (const file of files) {
    const p = readJson(join(playlistsDir, file));
    if (!p) { skipped++; continue; }

    // Resolve workspace: use tenantId field, or fall back to tnt-default
    const tenantId = p.tenantId ?? "tnt-default";
    const wsId = workspaceIdMap[tenantId] ?? workspaceIdMap["tnt-default"];
    if (!wsId) { skipped++; continue; }

    const id = p.id ?? randomUUID();
    const tracks = p.tracks ?? [];
    const order = p.order ?? tracks.map((t) => t.id ?? t.url ?? "");

    await prisma.playlist.upsert({
      where: { id },
      create: {
        id,
        workspaceId: wsId,
        name: p.name ?? file.replace(".json", ""),
        genre: p.genre ?? "",
        playlistType: p.type ?? "youtube",
        url: p.url ?? "",
        thumbnail: p.thumbnail ?? p.cover ?? "",
        branchId: p.branchId ?? null,
        viewCount: p.viewCount ?? null,
        durationSeconds: p.durationSeconds ?? null,
        adminNotes: p.adminNotes ?? null,
        useCase: p.useCase ?? null,
        useCases: p.useCases ?? [],
        primaryGenre: p.primaryGenre ?? null,
        subGenres: p.subGenres ?? [],
        mood: p.mood ?? null,
        energyLevel: p.energyLevel ?? null,
        libraryPlacement: p.libraryPlacement ?? null,
        playlistOwnershipScope: p.playlistOwnershipScope ?? null,
        trackOrder: order,
        isShared: false,
        createdAt: p.createdAt ? new Date(p.createdAt) : undefined,
        items: tracks.length > 0
          ? {
              create: tracks.map((t, idx) => ({
                trackId: t.id ?? t.url ?? "",
                name: t.name ?? t.title ?? "",
                trackType: t.type ?? "youtube",
                url: t.url ?? "",
                cover: t.cover ?? null,
                position: idx,
              })),
            }
          : undefined,
      },
      update: {
        name: p.name ?? file.replace(".json", ""),
        genre: p.genre ?? "",
        playlistType: p.type ?? "youtube",
        url: p.url ?? "",
        thumbnail: p.thumbnail ?? p.cover ?? "",
        trackOrder: order,
      },
    });
    count++;
  }
  console.log(`  ✓ ${count} playlists upserted${skipped > 0 ? `, ${skipped} skipped` : ""}`);
}

// ─── Phase 6: Schedules ───────────────────────────────────────────────────────

async function migrateSchedules(workspaceIdMap) {
  console.log("\n[6/7] Migrating schedules...");

  const schedules = readJson(join(ROOT, "data", "schedules.json"));
  if (!schedules) {
    console.log("  ⚠ data/schedules.json not found — skipping");
    return;
  }

  let count = 0;
  for (const s of schedules) {
    const wsId = workspaceIdMap[s.accountId] ?? workspaceIdMap["tnt-default"];
    if (!wsId) { console.log(`  ⚠ No workspace for schedule ${s.id}`); continue; }

    const branchId = s.branchId ?? "default";

    // Ensure branch stub exists
    await prisma.branch.upsert({
      where: { id: branchId },
      update: {},
      create: {
        id: branchId,
        workspaceId: wsId,
        name: branchId === "default" ? "Default Branch" : branchId,
        code: branchId.toUpperCase().replace(/[^A-Z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toUpperCase().slice(0, 24) || "BRANCH",
      },
    });

    await prisma.schedule.upsert({
      where: { id: s.id },
      create: {
        id: s.id,
        workspaceId: wsId,
        branchId,
        name: s.name ?? null,
        targetType: s.targetType ?? "SOURCE",
        targetId: s.targetId ?? s.sourceId ?? "",
        sourceId: s.sourceId ?? null,
        deviceId: s.deviceId ?? null,
        recurrence: s.recurrence ?? "weekly",
        oneOffDateLocal: s.oneOffDateLocal ?? null,
        daysOfWeek: s.daysOfWeek ?? [],
        startTimeLocal: s.startTimeLocal ?? "09:00",
        endTimeLocal: s.endTimeLocal ?? "23:59",
        enabled: s.enabled ?? true,
        priority: s.priority ?? 1,
        timezone: s.timezone ?? "UTC",
        requestedStartPosition: s.requestedStartPosition ?? null,
        requestedEndPosition: s.requestedEndPosition ?? null,
        createdBy: s.createdBy ?? null,
        updatedBy: s.updatedBy ?? null,
        createdAt: s.createdAt ? new Date(s.createdAt) : undefined,
        updatedAt: s.updatedAt ? new Date(s.updatedAt) : undefined,
      },
      update: {
        name: s.name ?? null,
        targetType: s.targetType ?? "SOURCE",
        targetId: s.targetId ?? s.sourceId ?? "",
        enabled: s.enabled ?? true,
        daysOfWeek: s.daysOfWeek ?? [],
        startTimeLocal: s.startTimeLocal ?? "09:00",
        endTimeLocal: s.endTimeLocal ?? "23:59",
      },
    });
    count++;
  }
  console.log(`  ✓ ${count} schedules upserted`);
}

// ─── Phase 7: Catalog Items ───────────────────────────────────────────────────

async function migrateCatalog() {
  console.log("\n[7/7] Migrating catalog items...");

  const catalogDir = join(ROOT, "catalog");
  if (!existsSync(catalogDir)) {
    console.log("  ⚠ catalog/ directory not found — skipping");
    return;
  }

  const files = readdirSync(catalogDir).filter((f) => f.endsWith(".json"));
  let count = 0;
  let skipped = 0;

  for (const file of files) {
    const c = readJson(join(catalogDir, file));
    if (!c) { skipped++; continue; }

    const url = c.urlKey ?? c.url ?? "";
    if (!url) { skipped++; continue; }

    await prisma.catalogItem.upsert({
      where: { url },
      create: {
        id: c.id,
        url,
        title: c.title ?? "Untitled",
        thumbnail: c.thumbnailUrl ?? c.thumbnail ?? null,
        createdAt: c.createdAt ? new Date(c.createdAt) : undefined,
        updatedAt: c.updatedAt ? new Date(c.updatedAt) : undefined,
        // tenantId is intentionally stripped — CatalogItem is global (no workspaceId)
      },
      update: {
        title: c.title ?? "Untitled",
        thumbnail: c.thumbnailUrl ?? c.thumbnail ?? null,
      },
    });
    count++;
  }
  console.log(`  ✓ ${count} catalog items upserted${skipped > 0 ? `, ${skipped} skipped` : ""}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== SyncBiz JSON → PostgreSQL Migration ===");
  console.log(`Database: ${(process.env.DATABASE_URL ?? "").replace(/:[^:@]+@/, ":***@")}`);

  try {
    await prisma.$connect();
    console.log("Connected to database.");

    const workspaceIdMap = await migrateUsersAndWorkspaces();
    await migrateBranches(workspaceIdMap);
    await migrateSources(workspaceIdMap);
    await migrateDevices(workspaceIdMap);
    await migratePlaylists(workspaceIdMap);
    await migrateSchedules(workspaceIdMap);
    await migrateCatalog();

    // ─── Summary ──────────────────────────────────────────────────────────────
    console.log("\n=== Migration Complete ===");
    const [users, workspaces, members, branches, sources, devices, playlists, schedules, catalog] =
      await Promise.all([
        prisma.user.count(),
        prisma.workspace.count(),
        prisma.workspaceMember.count(),
        prisma.branch.count(),
        prisma.source.count(),
        prisma.device.count(),
        prisma.playlist.count(),
        prisma.schedule.count(),
        prisma.catalogItem.count(),
      ]);

    console.log("Final row counts:");
    console.log(`  users              : ${users}`);
    console.log(`  workspaces         : ${workspaces}`);
    console.log(`  workspace members  : ${members}`);
    console.log(`  branches           : ${branches}`);
    console.log(`  sources            : ${sources}`);
    console.log(`  devices            : ${devices}`);
    console.log(`  playlists          : ${playlists}`);
    console.log(`  schedules          : ${schedules}`);
    console.log(`  catalog items      : ${catalog}`);
  } catch (err) {
    console.error("\n❌ Migration failed:", err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
