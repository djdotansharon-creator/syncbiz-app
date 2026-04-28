/**
 * Core data store — backed by PostgreSQL via Prisma.
 * Replaces the previous file-based (JSON) implementation.
 * The `db` export surface is fully preserved for drop-in compatibility.
 */

import { prisma } from "./prisma";
import {
  enforceCanAddBranch,
  enforceCanAddDevice,
} from "./entitlement-limits";
import type {
  Account,
  Announcement,
  Branch,
  Device,
  LogEntry,
  Schedule,
  Source,
} from "./types";

// ─── Workspace resolution ────────────────────────────────────────────────────

async function resolveWorkspaceId(id: string | undefined): Promise<string | null> {
  if (!id) return null;
  const byId = await prisma.workspace.findUnique({ where: { id } });
  if (byId) return byId.id;
  const bySlug = await prisma.workspace.findUnique({ where: { slug: id } });
  return bySlug?.id ?? null;
}

// ─── Mapping helpers ─────────────────────────────────────────────────────────

function rowToBranch(row: {
  id: string; workspaceId: string; name: string; code: string;
  timezone: string; city: string; country: string; status: string;
  devicesOnline: number; devicesTotal: number;
}): Branch {
  return {
    id: row.id,
    accountId: row.workspaceId,
    name: row.name,
    code: row.code,
    timezone: row.timezone,
    city: row.city,
    country: row.country,
    status: row.status as Branch["status"],
    devicesOnline: row.devicesOnline,
    devicesTotal: row.devicesTotal,
  };
}

function rowToDevice(row: {
  id: string; workspaceId: string; branchId: string; name: string;
  deviceKind: string; platform: string; deviceStatus: string; health: string;
  capabilities: string[]; lastHeartbeat: string | null; ipAddress: string;
  agentVersion: string; lastSeenAt: Date | null; currentSourceId: string | null;
  volume: number;
}): Device {
  return {
    id: row.id,
    accountId: row.workspaceId,
    branchId: row.branchId,
    name: row.name,
    type: row.deviceKind as Device["type"],
    platform: row.platform as Device["platform"],
    status: row.deviceStatus as Device["status"],
    health: row.health as Device["health"],
    capabilities: row.capabilities as Device["capabilities"],
    lastHeartbeat: row.lastHeartbeat ?? row.lastSeenAt?.toISOString() ?? new Date().toISOString(),
    ipAddress: row.ipAddress,
    agentVersion: row.agentVersion,
    lastSeen: row.lastSeenAt?.toISOString() ?? new Date().toISOString(),
    currentSourceId: row.currentSourceId ?? undefined,
    volume: row.volume,
  };
}

function rowToSource(row: {
  id: string; workspaceId: string; branchId: string; name: string;
  url: string; type: string; description: string | null; capabilities: string[];
  artworkUrl: string | null; isLive: boolean; provider: string | null;
  playerMode: string | null; tags: string[]; browserPreference: string | null;
  fallbackUriOrPath: string | null; taxonomyTags: unknown;
}): Source {
  return {
    id: row.id,
    accountId: row.workspaceId,
    branchId: row.branchId,
    name: row.name,
    type: row.type as Source["type"],
    target: row.url,
    uriOrPath: row.url,
    description: row.description ?? undefined,
    capabilities: row.capabilities as Source["capabilities"],
    artworkUrl: row.artworkUrl ?? undefined,
    isLive: row.isLive,
    provider: row.provider as Source["provider"] ?? undefined,
    playerMode: row.playerMode as Source["playerMode"] ?? undefined,
    tags: row.tags,
    browserPreference: row.browserPreference as Source["browserPreference"] ?? undefined,
    fallbackUriOrPath: row.fallbackUriOrPath ?? undefined,
    taxonomyTags: row.taxonomyTags as Source["taxonomyTags"] ?? undefined,
  };
}

function rowToSchedule(row: {
  id: string; workspaceId: string; branchId: string; name: string | null;
  targetType: string; targetId: string; sourceId: string | null;
  deviceId: string | null; recurrence: string; oneOffDateLocal: string | null;
  daysOfWeek: number[]; startTimeLocal: string; endTimeLocal: string;
  enabled: boolean; priority: number; timezone: string;
  requestedStartPosition: number | null; requestedEndPosition: number | null;
  createdBy: string | null; updatedBy: string | null; taxonomyTags: unknown;
  createdAt: Date; updatedAt: Date;
}): Schedule {
  return {
    id: row.id,
    accountId: row.workspaceId,
    branchId: row.branchId,
    name: row.name ?? undefined,
    targetType: row.targetType as Schedule["targetType"],
    targetId: row.targetId,
    sourceId: row.sourceId ?? undefined,
    deviceId: row.deviceId ?? undefined,
    recurrence: row.recurrence as Schedule["recurrence"],
    oneOffDateLocal: row.oneOffDateLocal ?? undefined,
    daysOfWeek: row.daysOfWeek,
    startTimeLocal: row.startTimeLocal,
    endTimeLocal: row.endTimeLocal,
    enabled: row.enabled,
    priority: row.priority,
    timezone: row.timezone,
    requestedStartPosition: row.requestedStartPosition ?? undefined,
    requestedEndPosition: row.requestedEndPosition ?? undefined,
    createdBy: row.createdBy ?? undefined,
    updatedBy: row.updatedBy ?? undefined,
    taxonomyTags: row.taxonomyTags as Schedule["taxonomyTags"] ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function rowToAnnouncement(row: {
  id: string; workspaceId: string; branchId: string; name: string; text: string;
  announcementType: string | null; scheduleId: string | null;
  announcementStatus: string; priority: string; ttsEnabled: boolean;
  resumePreviousSource: boolean; windowStart: string; windowEnd: string;
}): Announcement {
  return {
    id: row.id,
    accountId: row.workspaceId,
    branchId: row.branchId,
    title: row.name,
    message: row.text,
    type: row.announcementType as Announcement["type"] ?? undefined,
    scheduleId: row.scheduleId ?? undefined,
    status: row.announcementStatus as Announcement["status"],
    priority: row.priority as Announcement["priority"],
    ttsEnabled: row.ttsEnabled,
    resumePreviousSource: row.resumePreviousSource,
    windowStart: row.windowStart,
    windowEnd: row.windowEnd,
  };
}

// ─── In-memory log (non-critical, not migrated to DB) ───────────────────────
let logs: LogEntry[] = [];

// ─── Demo account stub ───────────────────────────────────────────────────────
const demoAccount: Account = {
  id: "acct-demo-001",
  name: "SyncBiz Demo",
  timezone: "America/New_York",
};

// ─── Public db interface ─────────────────────────────────────────────────────

export const db = {
  getAccount(): Account {
    return demoAccount;
  },

  // ─── BRANCHES ─────────────────────────────────────────────────────────────

  async getBranches(accountId?: string): Promise<Branch[]> {
    const wsId = await resolveWorkspaceId(accountId);
    if (!wsId) return [];
    const rows = await prisma.branch.findMany({ where: { workspaceId: wsId } });
    return rows.map(rowToBranch);
  },

  async addBranch(
    input: Pick<Branch, "accountId" | "name"> &
      Partial<Pick<Branch, "id" | "code" | "timezone" | "city" | "country" | "status">>,
  ): Promise<Branch> {
    const wsId = await resolveWorkspaceId(input.accountId);
    if (!wsId) throw new Error("Workspace not found for accountId: " + input.accountId);

    await enforceCanAddBranch(wsId);

    const normalizedName = input.name.trim();
    if (!normalizedName) throw new Error("name is required");
    const id = (input.id ?? "").trim() || crypto.randomUUID();
    const code = (input.code ?? normalizedName.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24)).trim() || "BRANCH";
    const row = await prisma.branch.create({
      data: {
        id,
        workspaceId: wsId,
        name: normalizedName,
        code,
        timezone: input.timezone ?? "America/New_York",
        city: input.city ?? "",
        country: input.country ?? "",
        status: input.status ?? "active",
      },
    });
    return rowToBranch(row);
  },

  async ensureBranchesLoaded(): Promise<void> { /* no-op with Prisma */ },
  async persistBranches(): Promise<void> { /* no-op with Prisma */ },

  // ─── DEVICES ──────────────────────────────────────────────────────────────

  async getDevices(accountId?: string): Promise<Device[]> {
    const wsId = await resolveWorkspaceId(accountId);
    if (!wsId) return [];
    const rows = await prisma.device.findMany({ where: { workspaceId: wsId } });
    return rows.map(rowToDevice);
  },

  async addDevice(
    input: Omit<Device, "id" | "accountId" | "lastSeen" | "lastHeartbeat"> &
      Partial<Pick<Device, "platform" | "health" | "capabilities" | "accountId">>,
  ): Promise<Device> {
    const wsId = await resolveWorkspaceId(input.accountId);
    if (!wsId) throw new Error("Workspace not found for accountId: " + input.accountId);
    // Ensure branch exists (or create a stub if using legacy "default" branchId)
    let branchDbId = input.branchId;
    const branch = await prisma.branch.findFirst({
      where: { workspaceId: wsId, id: branchDbId },
    });
    if (!branch) {
      await enforceCanAddBranch(wsId);
    }
    await enforceCanAddDevice(wsId);

    if (!branch) {
      // Create a stub branch record for legacy "default" branch
      const stub = await prisma.branch.upsert({
        where: { id: branchDbId },
        update: {},
        create: {
          id: branchDbId,
          workspaceId: wsId,
          name: branchDbId === "default" ? "Default" : branchDbId,
          code: "DEFAULT",
        },
      });
      branchDbId = stub.id;
    }
    const now = new Date().toISOString();
    const row = await prisma.device.create({
      data: {
        workspaceId: wsId,
        branchId: branchDbId,
        name: input.name,
        deviceKind: input.type ?? "audio-player",
        platform: input.platform ?? "windows",
        deviceStatus: input.status ?? "offline",
        health: input.health ?? "ok",
        capabilities: (input.capabilities ?? []) as string[],
        lastHeartbeat: now,
        ipAddress: input.ipAddress ?? "",
        agentVersion: input.agentVersion ?? "1.0.0",
        volume: input.volume ?? 50,
        currentSourceId: input.currentSourceId ?? null,
        token: crypto.randomUUID(),
      },
    });
    return rowToDevice(row);
  },

  async ensureDevicesLoaded(): Promise<void> { /* no-op */ },
  async persistDevices(): Promise<void> { /* no-op */ },

  // ─── SOURCES ──────────────────────────────────────────────────────────────

  async getSources(accountId?: string): Promise<Source[]> {
    const wsId = await resolveWorkspaceId(accountId);
    if (!wsId) return [];
    const rows = await prisma.source.findMany({ where: { workspaceId: wsId } });
    return rows.map(rowToSource);
  },

  async addSource(
    input: Omit<Source, "id" | "accountId"> & Partial<Pick<Source, "accountId">>,
  ): Promise<Source> {
    const wsId = await resolveWorkspaceId(input.accountId);
    if (!wsId) throw new Error("Workspace not found for accountId: " + input.accountId);
    const target = input.target ?? (input as Source & { uriOrPath?: string }).uriOrPath ?? "";
    const row = await prisma.source.create({
      data: {
        workspaceId: wsId,
        name: input.name,
        url: target,
        type: input.type,
        branchId: input.branchId ?? "default",
        description: input.description ?? null,
        capabilities: (input.capabilities ?? []) as string[],
        artworkUrl: input.artworkUrl ?? null,
        isLive: input.isLive ?? false,
        provider: input.provider ?? null,
        playerMode: input.playerMode ?? null,
        tags: (input.tags ?? []) as string[],
        browserPreference: input.browserPreference ?? null,
        fallbackUriOrPath: input.fallbackUriOrPath ?? null,
        taxonomyTags: input.taxonomyTags ? (input.taxonomyTags as object) : undefined,
      },
    });
    return rowToSource(row);
  },

  async deleteSource(id: string): Promise<boolean> {
    try {
      await prisma.source.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  },

  async updateSource(id: string, data: Partial<Source>): Promise<Source | null> {
    const existing = await prisma.source.findUnique({ where: { id } });
    if (!existing) return null;
    const row = await prisma.source.update({
      where: { id },
      data: {
        ...(data.name != null && { name: data.name }),
        ...(data.target != null && { url: data.target }),
        ...(data.type != null && { type: data.type }),
        ...(data.description != null && { description: data.description }),
        ...(data.artworkUrl != null && { artworkUrl: data.artworkUrl }),
        ...(data.browserPreference != null && { browserPreference: data.browserPreference }),
        ...(data.tags != null && { tags: data.tags as string[] }),
        ...(data.isLive != null && { isLive: data.isLive }),
      },
    });
    return rowToSource(row);
  },

  async ensureSourcesLoaded(): Promise<void> { /* no-op */ },
  async persistSources(): Promise<void> { /* no-op */ },

  // ─── SCHEDULES ────────────────────────────────────────────────────────────

  async getSchedules(accountId?: string): Promise<Schedule[]> {
    const wsId = await resolveWorkspaceId(accountId);
    if (!wsId) return [];
    const rows = await prisma.schedule.findMany({ where: { workspaceId: wsId } });
    return rows.map(rowToSchedule);
  },

  async findScheduleById(id: string): Promise<Schedule | null> {
    const row = await prisma.schedule.findUnique({ where: { id: id.trim() } });
    return row ? rowToSchedule(row) : null;
  },

  async getSchedule(id: string, accountId?: string): Promise<Schedule | null> {
    const wsId = await resolveWorkspaceId(accountId);
    const row = await prisma.schedule.findFirst({
      where: {
        id: id.trim(),
        ...(wsId ? { workspaceId: wsId } : {}),
      },
    });
    return row ? rowToSchedule(row) : null;
  },

  async addSchedule(
    input: Omit<Schedule, "id" | "accountId"> & Partial<Pick<Schedule, "targetType" | "targetId" | "accountId">>,
  ): Promise<Schedule> {
    const wsId = await resolveWorkspaceId(input.accountId);
    if (!wsId) throw new Error("Workspace not found for accountId: " + input.accountId);
    const branchId = (input.branchId ?? "default").trim() || "default";

    // Ensure branch exists
    await prisma.branch.upsert({
      where: { id: branchId },
      update: {},
      create: {
        id: branchId,
        workspaceId: wsId,
        name: branchId === "default" ? "Default" : branchId,
        code: "DEFAULT",
      },
    });

    const targetType = input.targetType ?? "SOURCE";
    const targetId = input.targetId ?? input.sourceId ?? "";
    const endRaw = input.endTimeLocal;
    const endTimeLocal = typeof endRaw === "string" && endRaw.trim().length > 0 ? endRaw : "23:59";

    const row = await prisma.schedule.create({
      data: {
        workspaceId: wsId,
        branchId,
        name: input.name ?? null,
        targetType,
        targetId,
        sourceId: input.sourceId ?? null,
        deviceId: input.deviceId ?? null,
        recurrence: input.recurrence ?? "weekly",
        oneOffDateLocal: input.oneOffDateLocal ?? null,
        daysOfWeek: input.daysOfWeek ?? [],
        startTimeLocal: input.startTimeLocal,
        endTimeLocal,
        enabled: input.enabled ?? true,
        priority: input.priority ?? 1,
        timezone: input.timezone ?? "UTC",
        requestedStartPosition: input.requestedStartPosition ?? null,
        requestedEndPosition: input.requestedEndPosition ?? null,
        createdBy: input.createdBy ?? null,
        taxonomyTags: input.taxonomyTags ? (input.taxonomyTags as object) : undefined,
      },
    });
    return rowToSchedule(row);
  },

  async updateSchedule(id: string, data: Partial<Schedule>): Promise<Schedule | null> {
    const existing = await prisma.schedule.findUnique({ where: { id: id.trim() } });
    if (!existing) return null;

    const endRaw = data.endTimeLocal;
    const endTimeLocal =
      endRaw !== undefined
        ? typeof endRaw === "string" && endRaw.trim().length > 0 ? endRaw : "23:59"
        : undefined;

    const row = await prisma.schedule.update({
      where: { id: id.trim() },
      data: {
        ...(data.name !== undefined && { name: data.name ?? null }),
        ...(data.branchId !== undefined && { branchId: data.branchId }),
        ...(data.targetType !== undefined && { targetType: data.targetType }),
        ...(data.targetId !== undefined && { targetId: data.targetId }),
        ...(data.sourceId !== undefined && { sourceId: data.sourceId ?? null }),
        ...(data.deviceId !== undefined && { deviceId: data.deviceId ?? null }),
        ...(data.daysOfWeek !== undefined && { daysOfWeek: data.daysOfWeek }),
        ...(data.startTimeLocal !== undefined && { startTimeLocal: data.startTimeLocal }),
        ...(endTimeLocal !== undefined && { endTimeLocal }),
        ...(data.enabled !== undefined && { enabled: data.enabled }),
        ...(data.priority !== undefined && { priority: data.priority }),
        ...(data.timezone !== undefined && { timezone: data.timezone }),
        ...(data.requestedStartPosition !== undefined && { requestedStartPosition: data.requestedStartPosition ?? null }),
        ...(data.requestedEndPosition !== undefined && { requestedEndPosition: data.requestedEndPosition ?? null }),
        ...(data.recurrence !== undefined && { recurrence: data.recurrence }),
        ...(data.oneOffDateLocal !== undefined && { oneOffDateLocal: data.oneOffDateLocal ?? null }),
        ...(data.updatedBy !== undefined && { updatedBy: data.updatedBy ?? null }),
      },
    });
    return rowToSchedule(row);
  },

  async deleteSchedule(id: string): Promise<boolean> {
    const trimmed = id.trim();
    const existing = await prisma.schedule.findUnique({ where: { id: trimmed } });
    if (!existing) return false;
    await prisma.schedule.delete({ where: { id: trimmed } });
    return true;
  },

  async ensureSchedulesLoaded(): Promise<void> { /* no-op */ },
  async persistSchedules(): Promise<void> { /* no-op */ },

  // ─── ANNOUNCEMENTS ────────────────────────────────────────────────────────

  async getAnnouncements(accountId?: string): Promise<Announcement[]> {
    const where = accountId ? { workspaceId: (await resolveWorkspaceId(accountId)) ?? "" } : {};
    const rows = await prisma.announcement.findMany({ where });
    return rows.map(rowToAnnouncement);
  },

  async addAnnouncement(input: Omit<Announcement, "id" | "accountId">): Promise<Announcement> {
    const row = await prisma.announcement.create({
      data: {
        workspaceId: "system",   // announcements route doesn't pass workspace; fallback
        name: input.title,
        text: input.message,
        branchId: input.branchId ?? "default",
        announcementType: input.type ?? null,
        scheduleId: input.scheduleId ?? null,
        announcementStatus: input.status ?? "draft",
        priority: input.priority ?? "normal",
        ttsEnabled: input.ttsEnabled ?? false,
        resumePreviousSource: input.resumePreviousSource ?? false,
        windowStart: input.windowStart ?? "",
        windowEnd: input.windowEnd ?? "",
      },
    });
    return rowToAnnouncement(row);
  },

  async ensureAnnouncementsLoaded(): Promise<void> { /* no-op */ },
  async persistAnnouncements(): Promise<void> { /* no-op */ },

  // ─── LOGS (in-memory — non-critical) ─────────────────────────────────────

  getLogs(): LogEntry[] {
    return logs;
  },

  addLog(entry: Omit<LogEntry, "id" | "accountId">): LogEntry {
    const log: LogEntry = {
      ...entry,
      id: `log-${Date.now()}`,
      accountId: "system",
    };
    logs = [log, ...logs].slice(0, 500); // cap at 500
    return log;
  },
};
