import "server-only";

/**
 * Device enrollment — the database side (docs/DEVICE_ENROLLMENT_DESIGN.md, Phase 2). The rules live in `lib/device-enrollment.ts` (pure); this file only reads and writes
 * `DeviceEnrollment` rows and applies those rules. Everything here is DORMANT unless the env flag SYNCBIZ_DEVICE_ENROLLMENT=1 AND the workspace's `enrollmentEnabled` are on:
 * with the env flag off nothing below touches the new table or the new entitlement columns (so a database that has not been migrated yet is never queried for them).
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeTenantAuditLog, type TenantAuditAction } from "@/lib/admin/tenant-audit";
import {
  DEFAULT_TTL_DAYS,
  MAX_PENDING_PER_USER,
  actorCanDecide,
  allocationState,
  canApproveAnotherPlayer,
  clampTtlDays,
  computeExpiresAt,
  decideMint,
  effectiveStatus,
  isEnrollmentEnvEnabled,
  playerClassFor,
  rowBranchIds,
  type Actor,
  type Allocation,
  type ApproveInput,
  type EnrollmentPlatform,
  type MintDecision,
  type RequestInput,
} from "@/lib/device-enrollment";

export class EnrollmentError extends Error {
  constructor(public code: string, public httpStatus: number, message?: string) {
    super(message ?? code);
  }
}

export type EnrollmentConfig = { enabled: boolean; ttlDays: number; maxPlayers: number };

const OFF: EnrollmentConfig = { enabled: false, ttlDays: DEFAULT_TTL_DAYS, maxPlayers: 0 };

/** Is enrollment on for this workspace? Env flag first (no database access when it is off), then the workspace switch. A failing read is treated as OFF — never as "block everyone". */
export async function getEnrollmentConfig(workspaceId: string): Promise<EnrollmentConfig> {
  if (!isEnrollmentEnvEnabled()) return OFF;
  try {
    const ent = await prisma.workspaceEntitlement.findUnique({
      where: { workspaceId },
      select: { enrollmentEnabled: true, enrollmentTtlDays: true, maxPlayers: true },
    });
    if (!ent || !ent.enrollmentEnabled) return OFF;
    return { enabled: true, ttlDays: clampTtlDays(ent.enrollmentTtlDays), maxPlayers: ent.maxPlayers };
  } catch (e) {
    console.error("[device-enrollment] config read failed — treating enrollment as OFF", e instanceof Error ? e.message : String(e));
    return OFF;
  }
}

export type EnrollmentRow = Awaited<ReturnType<typeof prisma.deviceEnrollment.findUniqueOrThrow>>;

export async function getEnrollmentByDevice(workspaceId: string, durableDeviceId: string): Promise<EnrollmentRow | null> {
  return prisma.deviceEnrollment.findUnique({ where: { workspaceId_durableDeviceId: { workspaceId, durableDeviceId } } });
}

/** "I am still here" — best effort, never throws. */
export async function touchEnrollmentSeen(id: string): Promise<void> {
  try {
    await prisma.deviceEnrollment.update({ where: { id }, data: { lastSeenAt: new Date() } });
  } catch {
    /* ignore */
  }
}

async function countApprovedPlayers(tx: Prisma.TransactionClient | typeof prisma, workspaceId: string, exceptId?: string): Promise<number> {
  // the owner's own computer plays like any player but is a gift — it never takes a seat of the paid allocation (owner 2026-10-28)
  return tx.deviceEnrollment.count({ where: { workspaceId, status: "approved", approvedRole: "PLAYER", OR: [{ playerClass: null }, { playerClass: { not: "owner" } }], ...(exceptId ? { id: { not: exceptId } } : {}) } });
}

export async function getAllocation(workspaceId: string, cfg?: EnrollmentConfig): Promise<Allocation> {
  const c = cfg ?? (await getEnrollmentConfig(workspaceId));
  return allocationState(c.maxPlayers, await countApprovedPlayers(prisma, workspaceId));
}

async function assertBranchInWorkspace(workspaceId: string, branchId: string): Promise<void> {
  if (branchId === "default") return; // the legacy default branch key (a single-branch account)
  const b = await prisma.branch.findFirst({ where: { id: branchId, workspaceId }, select: { id: true } });
  if (!b) throw new EnrollmentError("branch_not_found", 404);
}

// ───────────────────────────────────────────────── the device's own calls ───────────────────────

/** A device asks for a role. Approved stays approved; a pending one is refreshed (its expiry is NOT extended); anything else becomes a fresh pending request. */
export async function submitRequest(args: { workspaceId: string; userId: string; input: RequestInput; ip: string; userAgent: string; now?: Date }): Promise<EnrollmentRow> {
  const now = args.now ?? new Date();
  const cfg = await getEnrollmentConfig(args.workspaceId);
  if (!cfg.enabled) throw new EnrollmentError("enrollment_disabled", 409);
  const { input } = args;
  if (input.branchId) await assertBranchInWorkspace(args.workspaceId, input.branchId);
  const existing = await getEnrollmentByDevice(args.workspaceId, input.durableDeviceId);
  if (existing) {
    const st = effectiveStatus(existing, now);
    if (st === "approved") return existing;
    if (st === "pending") {
      return prisma.deviceEnrollment.update({
        where: { id: existing.id },
        data: { label: input.label, note: input.note, appVersion: input.appVersion, requesterFirstName: input.firstName, requesterLastName: input.lastName, requesterPhone: input.phone, requesterEmail: input.email, lastSeenAt: now },
      });
    }
  } else {
    const open = await prisma.deviceEnrollment.count({ where: { workspaceId: args.workspaceId, requestedByUserId: args.userId, status: "pending", expiresAt: { gt: now } } });
    if (open >= MAX_PENDING_PER_USER) throw new EnrollmentError("too_many_pending_requests", 429);
  }
  const data = {
    status: "pending",
    platform: input.platform,
    requestedRole: input.role,
    approvedRole: null,
    playerClass: input.role === "PLAYER" ? playerClassFor(input.platform) : null,
    label: input.label,
    appVersion: input.appVersion,
    userAgent: args.userAgent.slice(0, 300),
    requestIp: args.ip.slice(0, 64),
    requestedByUserId: args.userId,
    requestedBranchId: input.branchId,
    requestedBranchName: input.branchName,
    requestedBranchAddress: input.branchAddress,
    requestedBrandName: input.brandName,
    requesterFirstName: input.firstName,
    requesterLastName: input.lastName,
    requesterPhone: input.phone,
    requesterEmail: input.email,
    approvedBranchIds: [] as string[],
    note: input.note,
    decisionNote: "",
    decidedByUserId: null,
    decidedAt: null,
    grandfathered: false,
    requestedAt: now,
    expiresAt: computeExpiresAt(now, cfg.ttlDays),
    lastSeenAt: now,
  };
  const row = await prisma.deviceEnrollment.upsert({
    where: { workspaceId_durableDeviceId: { workspaceId: args.workspaceId, durableDeviceId: input.durableDeviceId } },
    create: { workspaceId: args.workspaceId, durableDeviceId: input.durableDeviceId, ...data },
    update: data,
  });
  await writeTenantAuditLog(prisma, {
    action: "device.enroll_request",
    entity: "device_enrollment",
    actorUserId: args.userId,
    workspaceId: args.workspaceId,
    targetUserId: row.id,
    ipAddress: args.ip || null,
    metadata: { durableDeviceId: input.durableDeviceId, role: input.role, platform: input.platform, branchId: input.branchId, label: input.label },
  });
  return row;
}

/** What a not-yet-approved device may see of the company: only the branches whose name matches what it is typing (never the whole list, nothing before the first letter). Owner 2026-10-28. */
export async function searchBranchesForEnrollment(workspaceId: string, query: string, limit = 30): Promise<Array<{ id: string; name: string; city: string }>> {
  const cfg = await getEnrollmentConfig(workspaceId);
  const q = query.trim().slice(0, 60);
  if (!cfg.enabled || q.length < 1) return [];
  const rows = await prisma.branch.findMany({
    where: { workspaceId, name: { contains: q, mode: "insensitive" } },
    orderBy: { name: "asc" },
    take: Math.min(50, Math.max(1, limit)),
    select: { id: true, name: true, city: true },
  });
  if (rows.length > 0) return rows.map((r) => ({ id: r.id, name: r.name, city: r.city ?? "" }));
  // a single-branch (legacy) account has no Branch rows — its one branch is the default
  const any = await prisma.branch.count({ where: { workspaceId } });
  return any === 0 && "default".includes(q.toLowerCase()) ? [{ id: "default", name: "Default", city: "" }] : [];
}

/** The owner's own computer (owner 2026-10-28): the normal interface with every control, able to play like a player, for every branch (no narrowing) — and a gift: it never takes a Player seat (`playerClass: "owner"`). */
function ownerDeviceData(userId: string, now: Date, ttlDays: number, grandfathered = false) {
  return {
    status: "approved",
    requestedRole: "PLAYER",
    approvedRole: "PLAYER",
    playerClass: "owner",
    requestedByUserId: userId,
    requestedBranchId: null as string | null,
    approvedBranchIds: [] as string[],
    note: "",
    decisionNote: "owner",
    decidedByUserId: userId,
    decidedAt: now,
    grandfathered,
    requestedAt: now,
    expiresAt: computeExpiresAt(now, ttlDays),
    lastSeenAt: now,
  };
}

/** The workspace ADMIN approves THIS device himself — "I'm the owner" (owner 2026-10-28): the one who approves everyone else does not wait for someone else to approve his new computer.
 *  See `ownerDeviceData`. The route checks that the caller is an admin; the audit log records it as a self-approval. */
export async function approveOwnDevice(args: { workspaceId: string; userId: string; durableDeviceId: string; platform: EnrollmentPlatform; label: string; ip?: string; now?: Date }): Promise<EnrollmentRow> {
  const now = args.now ?? new Date();
  const cfg = await getEnrollmentConfig(args.workspaceId);
  if (!cfg.enabled) throw new EnrollmentError("enrollment_disabled", 409);
  const existing = await getEnrollmentByDevice(args.workspaceId, args.durableDeviceId);
  if (existing && effectiveStatus(existing, now) === "approved") return existing;
  const data = { ...ownerDeviceData(args.userId, now, cfg.ttlDays), platform: args.platform, label: args.label };
  return prisma.$transaction(async (tx) => {
    const row = await tx.deviceEnrollment.upsert({
      where: { workspaceId_durableDeviceId: { workspaceId: args.workspaceId, durableDeviceId: args.durableDeviceId } },
      create: { workspaceId: args.workspaceId, durableDeviceId: args.durableDeviceId, ...data },
      update: data,
    });
    await writeTenantAuditLog(tx, {
      action: "device.enroll_approve",
      entity: "device_enrollment",
      actorUserId: args.userId,
      workspaceId: args.workspaceId,
      targetUserId: row.id,
      ipAddress: args.ip || null,
      metadata: { durableDeviceId: args.durableDeviceId, role: "PLAYER", playerClass: "owner", branchIds: [], self: true, owner: true },
    });
    return row;
  });
}

// ───────────────────────────────────────────────── the manager's calls ──────────────────────────

export type EnrollmentListItem = {
  id: string;
  durableDeviceId: string;
  status: string;
  platform: string;
  requestedRole: string;
  approvedRole: string | null;
  playerClass: string | null;
  label: string;
  note: string;
  decisionNote: string;
  requestedBranchId: string | null;
  requestedBranchName: string;
  requestedBranchAddress: string;
  requestedBrandName: string;
  requesterFirstName: string;
  requesterLastName: string;
  requesterPhone: string;
  requesterEmail: string;
  /** the signed-in account the request came from (a Player does not have to give a person's details) */
  requestedByEmail: string;
  approvedBranchIds: string[];
  branchNames: Record<string, string>;
  requestedByUserId: string;
  requestedAt: string;
  expiresAt: string;
  decidedAt: string | null;
  lastSeenAt: string | null;
  grandfathered: boolean;
  userAgent: string;
  requestIp: string;
  /** may THIS actor approve / reject / revoke it */
  canDecide: boolean;
};

export async function listEnrollments(args: { workspaceId: string; actor: Actor; now?: Date }): Promise<{ items: EnrollmentListItem[]; pendingCount: number; allocation: Allocation; config: EnrollmentConfig }> {
  const now = args.now ?? new Date();
  const config = await getEnrollmentConfig(args.workspaceId);
  // switched off (or not available on this server): nothing to list and the new table is never touched — a database that has not been migrated yet stays untouched
  if (!config.enabled) return { items: [], pendingCount: 0, allocation: allocationState(0, 0), config };
  const rows = await prisma.deviceEnrollment.findMany({ where: { workspaceId: args.workspaceId }, orderBy: { requestedAt: "desc" }, take: 500 });
  const visible = rows.filter((r) => args.actor.isAdmin || actorCanDecide(args.actor, rowBranchIds(r)));
  const branchIds = Array.from(new Set(visible.flatMap((r) => [...rowBranchIds(r)])));
  const names: Record<string, string> = {};
  if (branchIds.length > 0) {
    const bs = await prisma.branch.findMany({ where: { workspaceId: args.workspaceId, id: { in: branchIds } }, select: { id: true, name: true } });
    for (const b of bs) names[b.id] = b.name;
  }
  const userIds = Array.from(new Set(visible.filter((r) => r.status === "pending").map((r) => r.requestedByUserId)));
  const emails = new Map<string, string>();
  if (userIds.length > 0) for (const u of await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true } })) emails.set(u.id, u.email);
  const items: EnrollmentListItem[] = visible.map((r) => {
    const ids = rowBranchIds(r);
    return {
      id: r.id,
      durableDeviceId: r.durableDeviceId,
      status: effectiveStatus(r, now),
      platform: r.platform,
      requestedRole: r.requestedRole,
      approvedRole: r.approvedRole,
      playerClass: r.playerClass,
      label: r.label,
      note: r.note,
      decisionNote: r.decisionNote,
      requestedBranchId: r.requestedBranchId,
      requestedBranchName: r.requestedBranchName,
      requestedBranchAddress: r.requestedBranchAddress,
      requestedBrandName: r.requestedBrandName,
      requesterFirstName: r.requesterFirstName,
      requesterLastName: r.requesterLastName,
      requesterPhone: r.requesterPhone,
      requesterEmail: r.requesterEmail,
      requestedByEmail: emails.get(r.requestedByUserId) ?? "",
      approvedBranchIds: r.approvedBranchIds,
      branchNames: Object.fromEntries(ids.map((i) => [i, names[i] ?? (i === "default" ? "Default" : i)])),
      requestedByUserId: r.requestedByUserId,
      requestedAt: r.requestedAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
      decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
      lastSeenAt: r.lastSeenAt ? r.lastSeenAt.toISOString() : null,
      grandfathered: r.grandfathered,
      userAgent: r.userAgent,
      requestIp: r.requestIp,
      canDecide: actorCanDecide(args.actor, ids),
    };
  });
  const allocation = allocationState(config.maxPlayers, rows.filter((r) => r.status === "approved" && r.approvedRole === "PLAYER" && r.playerClass !== "owner").length);
  return { items, pendingCount: items.filter((i) => i.status === "pending").length, allocation, config };
}

/** How many open requests THIS actor may decide — the red circle on the Control Room tab. Touches nothing while enrollment is off. */
export async function countPendingForActor(args: { workspaceId: string; actor: Actor; now?: Date }): Promise<{ enabled: boolean; count: number }> {
  const now = args.now ?? new Date();
  const config = await getEnrollmentConfig(args.workspaceId);
  if (!config.enabled || (!args.actor.isAdmin && !args.actor.isManager)) return { enabled: config.enabled, count: 0 };
  const rows = await prisma.deviceEnrollment.findMany({
    where: { workspaceId: args.workspaceId, status: "pending", expiresAt: { gt: now } },
    select: { approvedBranchIds: true, requestedBranchId: true },
    take: 500,
  });
  return { enabled: true, count: rows.filter((r) => args.actor.isAdmin || actorCanDecide(args.actor, rowBranchIds(r))).length };
}

async function loadForDecision(tx: Prisma.TransactionClient, workspaceId: string, id: string): Promise<EnrollmentRow> {
  const row = await tx.deviceEnrollment.findUnique({ where: { id } });
  if (!row || row.workspaceId !== workspaceId) throw new EnrollmentError("not_found", 404);
  return row;
}

export async function approveEnrollment(args: { workspaceId: string; actor: Actor; id: string; input: ApproveInput; ip?: string; now?: Date }): Promise<EnrollmentRow> {
  const now = args.now ?? new Date();
  const cfg = await getEnrollmentConfig(args.workspaceId);
  if (!cfg.enabled) throw new EnrollmentError("enrollment_disabled", 409);
  if (args.input.mode === "replace") throw new EnrollmentError("replace_not_available_yet", 409, "Replacing the current player is done with Replace main station in the branch's activation panel.");
  // a Player belongs to exactly one real branch — also when the request only carried a typed branch name (the approver must pick the branch)
  if (args.input.role === "PLAYER" && args.input.branchIds.length !== 1) throw new EnrollmentError("player_needs_exactly_one_branch", 400);
  for (const b of args.input.branchIds) await assertBranchInWorkspace(args.workspaceId, b);
  return prisma.$transaction(async (tx) => {
    const row = await loadForDecision(tx, args.workspaceId, args.id);
    if (effectiveStatus(row, now) !== "pending") throw new EnrollmentError("not_pending", 409);
    // the actor must be able to decide BOTH what was asked for and what is being granted
    if (!actorCanDecide(args.actor, args.input.branchIds) || !actorCanDecide(args.actor, rowBranchIds(row))) throw new EnrollmentError("forbidden", 403);
    let playerClass: string | null = null;
    if (args.input.role === "PLAYER") {
      const cls = playerClassFor(row.platform as EnrollmentPlatform);
      if (!cls) throw new EnrollmentError("role_not_allowed_for_platform", 409);
      playerClass = cls;
      const alloc = allocationState(cfg.maxPlayers, await countApprovedPlayers(tx, args.workspaceId, row.id));
      if (!canApproveAnotherPlayer(alloc, false)) throw new EnrollmentError("allocation_full", 409);
    }
    const updated = await tx.deviceEnrollment.update({
      where: { id: row.id },
      data: { status: "approved", approvedRole: args.input.role, playerClass, approvedBranchIds: args.input.branchIds, decisionNote: args.input.note, decidedByUserId: args.actor.userId, decidedAt: now },
    });
    await writeTenantAuditLog(tx, {
      action: "device.enroll_approve",
      entity: "device_enrollment",
      actorUserId: args.actor.userId,
      workspaceId: args.workspaceId,
      targetUserId: row.id,
      ipAddress: args.ip ?? null,
      metadata: { durableDeviceId: row.durableDeviceId, role: args.input.role, branchIds: args.input.branchIds, playerClass },
    });
    return updated;
  });
}

async function closeEnrollment(args: { workspaceId: string; actor: Actor; id: string; to: "rejected" | "revoked"; from: "pending" | "approved"; note: string; ip?: string; now?: Date }): Promise<EnrollmentRow> {
  const now = args.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const row = await loadForDecision(tx, args.workspaceId, args.id);
    if (effectiveStatus(row, now) !== args.from) throw new EnrollmentError(args.from === "pending" ? "not_pending" : "not_approved", 409);
    if (!actorCanDecide(args.actor, rowBranchIds(row))) throw new EnrollmentError("forbidden", 403);
    const updated = await tx.deviceEnrollment.update({ where: { id: row.id }, data: { status: args.to, decisionNote: args.note.slice(0, 300), decidedByUserId: args.actor.userId, decidedAt: now } });
    const action: TenantAuditAction = args.to === "rejected" ? "device.enroll_reject" : "device.enroll_revoke";
    await writeTenantAuditLog(tx, { action, entity: "device_enrollment", actorUserId: args.actor.userId, workspaceId: args.workspaceId, targetUserId: row.id, ipAddress: args.ip ?? null, metadata: { durableDeviceId: row.durableDeviceId, role: row.approvedRole ?? row.requestedRole } });
    return updated;
  });
}

export const rejectEnrollment = (a: { workspaceId: string; actor: Actor; id: string; note: string; ip?: string; now?: Date }) => closeEnrollment({ ...a, to: "rejected", from: "pending" });
export const revokeEnrollment = (a: { workspaceId: string; actor: Actor; id: string; note: string; ip?: string; now?: Date }) => closeEnrollment({ ...a, to: "revoked", from: "approved" });

// ───────────────────────────────────────────────── switching it on ──────────────────────────────

/**
 * Switch enrollment on for a workspace. Nothing already running goes dark: every existing StationDevice becomes an approved, grandfathered PLAYER of its branch, and the
 * enabling admin's own device (when given) becomes an approved, grandfathered REMOTE so the admin is never locked out of the screen that approves the others.
 */
export async function enableEnrollment(args: { workspaceId: string; actorUserId: string; ttlDays?: number; ownDeviceId?: string | null; ownDeviceLabel?: string; ip?: string; now?: Date }): Promise<{ grandfatheredStations: number }> {
  if (!isEnrollmentEnvEnabled()) throw new EnrollmentError("enrollment_not_available", 409, "The environment flag SYNCBIZ_DEVICE_ENROLLMENT is not set on this server.");
  const now = args.now ?? new Date();
  const ttl = clampTtlDays(args.ttlDays ?? DEFAULT_TTL_DAYS);
  return prisma.$transaction(async (tx) => {
    await tx.workspaceEntitlement.upsert({
      where: { workspaceId: args.workspaceId },
      create: { workspaceId: args.workspaceId, status: "TRIALING", planCode: "trial", trialEndsAt: new Date(now.getTime() + 30 * 86_400_000), enrollmentEnabled: true, enrollmentTtlDays: ttl },
      update: { enrollmentEnabled: true, enrollmentTtlDays: ttl },
    });
    const stations = await tx.stationDevice.findMany({ where: { workspaceId: args.workspaceId }, select: { durableDeviceId: true, branchId: true, platform: true, appVersion: true } });
    let created = 0;
    for (const s of stations) {
      const exists = await tx.deviceEnrollment.findUnique({ where: { workspaceId_durableDeviceId: { workspaceId: args.workspaceId, durableDeviceId: s.durableDeviceId } }, select: { id: true } });
      if (exists) continue;
      await tx.deviceEnrollment.create({
        data: { workspaceId: args.workspaceId, durableDeviceId: s.durableDeviceId, status: "approved", platform: "desktop", requestedRole: "PLAYER", approvedRole: "PLAYER", playerClass: "station", label: "Station (existing)", appVersion: s.appVersion, requestedByUserId: args.actorUserId, requestedBranchId: s.branchId, approvedBranchIds: [s.branchId], decidedByUserId: args.actorUserId, decidedAt: now, grandfathered: true, requestedAt: now, expiresAt: computeExpiresAt(now, ttl) },
      });
      created++;
    }
    const own = (args.ownDeviceId ?? "").trim();
    if (own) {
      // the admin who switches it on is never locked out of the screen that approves the others: an existing approved row is kept, anything else (pending / rejected / revoked / expired) becomes approved as the
      // OWNER'S computer — the normal interface with every control, able to play, for every branch, and never counted as a Player of the paid allocation.
      const mine = await tx.deviceEnrollment.findUnique({ where: { workspaceId_durableDeviceId: { workspaceId: args.workspaceId, durableDeviceId: own } }, select: { id: true, status: true } });
      const base = ownerDeviceData(args.actorUserId, now, ttl, true);
      if (!mine) {
        await tx.deviceEnrollment.create({ data: { workspaceId: args.workspaceId, durableDeviceId: own, platform: "browser", label: (args.ownDeviceLabel ?? "Admin's device").slice(0, 80), ...base } });
      } else if (mine.status !== "approved") {
        await tx.deviceEnrollment.update({ where: { id: mine.id }, data: base });
      }
    }
    await writeTenantAuditLog(tx, { action: "enrollment.settings", entity: "workspace", actorUserId: args.actorUserId, workspaceId: args.workspaceId, targetUserId: args.workspaceId, ipAddress: args.ip ?? null, metadata: { enabled: true, ttlDays: ttl, grandfatheredStations: created } });
    return { grandfatheredStations: created };
  });
}

export async function disableEnrollment(args: { workspaceId: string; actorUserId: string; ip?: string }): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.workspaceEntitlement.updateMany({ where: { workspaceId: args.workspaceId }, data: { enrollmentEnabled: false } });
    await writeTenantAuditLog(tx, { action: "enrollment.settings", entity: "workspace", actorUserId: args.actorUserId, workspaceId: args.workspaceId, targetUserId: args.workspaceId, ipAddress: args.ip ?? null, metadata: { enabled: false } });
  });
}

export async function setEnrollmentTtl(args: { workspaceId: string; actorUserId: string; ttlDays: number; ip?: string }): Promise<number> {
  const ttl = clampTtlDays(args.ttlDays);
  await prisma.$transaction(async (tx) => {
    await tx.workspaceEntitlement.updateMany({ where: { workspaceId: args.workspaceId }, data: { enrollmentTtlDays: ttl } });
    await writeTenantAuditLog(tx, { action: "enrollment.settings", entity: "workspace", actorUserId: args.actorUserId, workspaceId: args.workspaceId, targetUserId: args.workspaceId, ipAddress: args.ip ?? null, metadata: { ttlDays: ttl } });
  });
  return ttl;
}

/** The player allocation is set by the platform / billing side (platform SUPER_ADMIN), never by the workspace's own admin. */
export async function setMaxPlayers(args: { workspaceId: string; actorUserId: string; maxPlayers: number; ip?: string }): Promise<number> {
  const n = Math.max(0, Math.min(10_000, Math.floor(args.maxPlayers)));
  await prisma.$transaction(async (tx) => {
    await tx.workspaceEntitlement.updateMany({ where: { workspaceId: args.workspaceId }, data: { maxPlayers: n } });
    await writeTenantAuditLog(tx, { action: "enrollment.settings", entity: "workspace", actorUserId: args.actorUserId, workspaceId: args.workspaceId, targetUserId: args.workspaceId, ipAddress: args.ip ?? null, metadata: { maxPlayers: n } });
  });
  return n;
}

/**
 * The WS-token route's question: may this device have a token, and with what signed role? Dormant (kind "off", no database access) unless the env flag AND the workspace switch are on.
 * Anything not approved gets no token; an approved device gets its role (and, when scoped, only its branches).
 */
export async function resolveMintDecision(args: { workspaceId: string; durableDeviceId: string | null; userAgent: string | null }): Promise<MintDecision> {
  const cfg = await getEnrollmentConfig(args.workspaceId);
  if (!cfg.enabled) return { kind: "off" };
  const id = (args.durableDeviceId ?? "").trim();
  const row = id ? await getEnrollmentByDevice(args.workspaceId, id) : null;
  if (row && effectiveStatus(row, new Date()) === "approved") void touchEnrollmentSeen(row.id);
  return decideMint({ enabled: true, userAgent: args.userAgent, durableDeviceId: id, row, now: new Date() });
}
