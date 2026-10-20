/**
 * CONTROL ROOM PHASE 1 / GATE 1 (ops, idempotent) — ensure the canonical Branch row that represents a
 * workspace's legacy runtime branch key "default", then sync the alias to the WS server (SHADOW mode there).
 *
 * Runs INSIDE the app container (uses DATABASE_URL, NEXT_PUBLIC_WS_URL, SYNCBIZ_WS_SECRET from its env):
 *   node scripts/control-room/ensure-legacy-branch.mjs <workspaceId> <code> "<name>" [--resync-designation]
 *
 * Gate 1 guarantees: creates/updates ONLY that one Branch row (legacyKey="default"); rewrites NO existing
 * "default" rows (designation, StationDevice, assignments, pads, announcements, playlists untouched).
 * --resync-designation re-asserts the EXISTING DB designation for "default" to the WS server (same device id —
 * the WS revoke step skips the designated device, so the station is never demoted). Prints no secrets.
 */
import { PrismaClient } from "@prisma/client";

const [workspaceId, code, name] = process.argv.slice(2);
const resyncDesignation = process.argv.includes("--resync-designation");
if (!workspaceId || !code || !name) {
  console.error("usage: node scripts/control-room/ensure-legacy-branch.mjs <workspaceId> <code> <name> [--resync-designation]");
  process.exit(2);
}
const LEGACY = "default";
const wsHttp = (process.env.NEXT_PUBLIC_WS_URL ?? process.env.WS_SERVER_HTTP_URL ?? "").replace(/^ws(s?):/, "http$1:").replace(/\/$/, "");
const secret = process.env.SYNCBIZ_WS_SECRET ?? process.env.WS_SECRET ?? "";

async function postWs(path, body) {
  if (!wsHttp || !secret) return { ok: false, status: 0, text: "WS url/secret not configured" };
  const r = await fetch(`${wsHttp}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-SyncBiz-Secret": secret },
    body: JSON.stringify(body),
  });
  return { ok: r.ok, status: r.status, text: (await r.text()).slice(0, 200) };
}

const prisma = new PrismaClient();
try {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { id: true } });
  if (!ws) throw new Error("workspace not found");
  const branch = await prisma.branch.upsert({
    where: { workspaceId_legacyKey: { workspaceId, legacyKey: LEGACY } },
    update: {},
    create: { workspaceId, legacyKey: LEGACY, code, name },
    select: { id: true, code: true, name: true, legacyKey: true },
  });
  console.log("canonical branch", JSON.stringify(branch));
  const alias = await postWs("/internal/branch-alias", { workspaceId, legacyKey: LEGACY, canonicalBranchId: branch.id });
  console.log("ws alias sync", JSON.stringify(alias));
  if (resyncDesignation) {
    const d = await prisma.branchMasterDesignation.findUnique({
      where: { workspaceId_branchId: { workspaceId, branchId: LEGACY } },
      select: { durableDeviceId: true },
    });
    if (!d) console.log("designation resync skipped: no DB designation for", LEGACY);
    else {
      const r = await postWs("/internal/branch-master-designation", { workspaceId, branchId: LEGACY, durableDeviceId: d.durableDeviceId });
      console.log("designation resync", JSON.stringify({ durableDeviceId: d.durableDeviceId, ...r }));
    }
  }
  const untouched = {
    designationDefault: await prisma.branchMasterDesignation.count({ where: { workspaceId, branchId: LEGACY } }),
    stationDeviceDefault: await prisma.stationDevice.count({ where: { workspaceId, branchId: LEGACY } }),
    assignmentDefault: await prisma.userBranchAssignment.count({ where: { workspaceId, branchId: LEGACY } }),
    padsDefault: await prisma.jinglePadAssignment.count({ where: { workspaceId, branchId: LEGACY } }),
    announcementDefault: await prisma.announcement.count({ where: { workspaceId, branchId: LEGACY } }),
    playlistDefault: await prisma.playlist.count({ where: { workspaceId, branchId: LEGACY } }),
  };
  console.log("legacy rows (unchanged)", JSON.stringify(untouched));
} catch (e) {
  console.error("FAILED", e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
