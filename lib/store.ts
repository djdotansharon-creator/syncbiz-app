import { existsSync } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname } from "path";
import {
  getSchedulesDataPath,
  getSourcesDataPath,
  getDevicesDataPath,
  getBranchesDataPath,
  getAnnouncementsDataPath,
} from "./data-path";
import type {
  Account,
  Announcement,
  Branch,
  Device,
  LogEntry,
  Schedule,
  Source,
} from "./types";
import {
  announcements as seedAnnouncements,
  branches as seedBranches,
  devices as seedDevices,
  logs as seedLogs,
  schedules as seedSchedules,
  sources as seedSources,
} from "./mock-data";

// Single demo account for the MVP.
const demoAccount: Account = {
  id: "acct-demo-001",
  name: "SyncBiz Demo Retail Co.",
  timezone: "America/New_York",
};

let branches: Branch[] = seedBranches.map((b) => ({
  ...b,
  accountId: demoAccount.id,
}));

let devices: Device[] = seedDevices.map((d) => ({
  ...d,
  accountId: demoAccount.id,
}));

let sources: Source[] = seedSources.map((s) => ({
  ...s,
  accountId: demoAccount.id,
  branchId: branches[0]?.id ?? "bldn-001",
}));

let schedules: Schedule[] = seedSchedules.map((s) => ({
  ...s,
  accountId: demoAccount.id,
}));

/**
 * Reload schedules from disk on every call.
 * Next.js may run API routes in different isolates; a one-time load left stale in-memory
 * arrays so DELETE returned 404 while the UI (from disk/RSC) still showed the row.
 */
async function reloadSchedulesFromDisk(): Promise<void> {
  const path = getSchedulesDataPath();
  await mkdir(dirname(path), { recursive: true });
  if (existsSync(path)) {
    try {
      const raw = await readFile(path, "utf-8");
      const data = JSON.parse(raw) as unknown;
      if (Array.isArray(data)) {
        const loaded = data.filter(
          (row): row is Schedule =>
            typeof row === "object" &&
            row !== null &&
            typeof (row as Schedule).id === "string" &&
            (row as Schedule).id.length > 0,
        );
        schedules = loaded;
      }
    } catch (e) {
      console.error("[store] schedules.json read failed", e);
    }
    return;
  }
  try {
    await writeFile(path, JSON.stringify(schedules, null, 2), "utf-8");
  } catch (e) {
    console.error("[store] schedules.json bootstrap write failed", e);
  }
}

async function persistSchedulesToDisk(): Promise<void> {
  const path = getSchedulesDataPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(schedules, null, 2), "utf-8");
}

// ─── SOURCES ────────────────────────────────────────────────────────────────

async function reloadSourcesFromDisk(): Promise<void> {
  const path = getSourcesDataPath();
  await mkdir(dirname(path), { recursive: true });
  if (existsSync(path)) {
    try {
      const raw = await readFile(path, "utf-8");
      const data = JSON.parse(raw) as unknown;
      if (Array.isArray(data)) {
        sources = data.filter(
          (row): row is Source =>
            typeof row === "object" && row !== null &&
            typeof (row as Source).id === "string" &&
            (row as Source).id.length > 0,
        );
      }
    } catch (e) {
      console.error("[store] sources.json read failed", e);
    }
    return;
  }
  const seed = process.env.NODE_ENV === "production" ? [] : sources;
  try {
    await writeFile(path, JSON.stringify(seed, null, 2), "utf-8");
    if (process.env.NODE_ENV === "production") sources = [];
  } catch (e) {
    console.error("[store] sources.json bootstrap write failed", e);
  }
}

async function persistSourcesToDisk(): Promise<void> {
  const path = getSourcesDataPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(sources, null, 2), "utf-8");
}

// ─── DEVICES ────────────────────────────────────────────────────────────────

async function reloadDevicesFromDisk(): Promise<void> {
  const path = getDevicesDataPath();
  await mkdir(dirname(path), { recursive: true });
  if (existsSync(path)) {
    try {
      const raw = await readFile(path, "utf-8");
      const data = JSON.parse(raw) as unknown;
      if (Array.isArray(data)) {
        devices = data.filter(
          (row): row is Device =>
            typeof row === "object" && row !== null &&
            typeof (row as Device).id === "string" &&
            (row as Device).id.length > 0,
        );
      }
    } catch (e) {
      console.error("[store] devices.json read failed", e);
    }
    return;
  }
  const seed = process.env.NODE_ENV === "production" ? [] : devices;
  try {
    await writeFile(path, JSON.stringify(seed, null, 2), "utf-8");
    if (process.env.NODE_ENV === "production") devices = [];
  } catch (e) {
    console.error("[store] devices.json bootstrap write failed", e);
  }
}

async function persistDevicesToDisk(): Promise<void> {
  const path = getDevicesDataPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(devices, null, 2), "utf-8");
}

// ─── BRANCHES ───────────────────────────────────────────────────────────────

async function reloadBranchesFromDisk(): Promise<void> {
  const path = getBranchesDataPath();
  await mkdir(dirname(path), { recursive: true });
  if (existsSync(path)) {
    try {
      const raw = await readFile(path, "utf-8");
      const data = JSON.parse(raw) as unknown;
      if (Array.isArray(data)) {
        branches = data.filter(
          (row): row is Branch =>
            typeof row === "object" && row !== null &&
            typeof (row as Branch).id === "string" &&
            (row as Branch).id.length > 0,
        );
      }
    } catch (e) {
      console.error("[store] branches.json read failed", e);
    }
    return;
  }
  const seed = process.env.NODE_ENV === "production" ? [] : branches;
  try {
    await writeFile(path, JSON.stringify(seed, null, 2), "utf-8");
    if (process.env.NODE_ENV === "production") branches = [];
  } catch (e) {
    console.error("[store] branches.json bootstrap write failed", e);
  }
}

async function persistBranchesToDisk(): Promise<void> {
  const path = getBranchesDataPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(branches, null, 2), "utf-8");
}

// ─── ANNOUNCEMENTS ──────────────────────────────────────────────────────────

async function reloadAnnouncementsFromDisk(): Promise<void> {
  const path = getAnnouncementsDataPath();
  await mkdir(dirname(path), { recursive: true });
  if (existsSync(path)) {
    try {
      const raw = await readFile(path, "utf-8");
      const data = JSON.parse(raw) as unknown;
      if (Array.isArray(data)) {
        announcements = data.filter(
          (row): row is Announcement =>
            typeof row === "object" && row !== null &&
            typeof (row as Announcement).id === "string" &&
            (row as Announcement).id.length > 0,
        );
      }
    } catch (e) {
      console.error("[store] announcements.json read failed", e);
    }
    return;
  }
  const seed = process.env.NODE_ENV === "production" ? [] : announcements;
  try {
    await writeFile(path, JSON.stringify(seed, null, 2), "utf-8");
    if (process.env.NODE_ENV === "production") announcements = [];
  } catch (e) {
    console.error("[store] announcements.json bootstrap write failed", e);
  }
}

async function persistAnnouncementsToDisk(): Promise<void> {
  const path = getAnnouncementsDataPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(announcements, null, 2), "utf-8");
}

let announcements: Announcement[] = seedAnnouncements.map((a) => ({
  ...a,
  accountId: demoAccount.id,
}));

let logs: LogEntry[] = seedLogs.map((l) => ({
  ...l,
  accountId: demoAccount.id,
}));

export const db = {
  getAccount(): Account {
    return demoAccount;
  },

  // ─── BRANCHES ───────────────────────────────────────────────────────────────

  async getBranches(accountId?: string): Promise<Branch[]> {
    await reloadBranchesFromDisk();
    if (!accountId) return branches;
    return branches.filter((b) => b.accountId === accountId);
  },
  async addBranch(
    input: Pick<Branch, "accountId" | "name"> &
      Partial<Pick<Branch, "id" | "code" | "timezone" | "city" | "country" | "status">>,
  ): Promise<Branch> {
    await reloadBranchesFromDisk();
    const normalizedAccountId = input.accountId.trim();
    const normalizedName = input.name.trim();
    const desiredId = (input.id ?? "").trim();
    const id =
      desiredId ||
      `br-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    if (!normalizedAccountId) {
      throw new Error("accountId is required");
    }
    if (!normalizedName) {
      throw new Error("name is required");
    }
    if (branches.some((b) => b.accountId === normalizedAccountId && b.id === id)) {
      throw new Error("branch id already exists in account");
    }
    const code = (input.code ?? normalizedName.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24)).trim() || "BRANCH";
    const branch: Branch = {
      id,
      accountId: normalizedAccountId,
      name: normalizedName,
      code,
      timezone: input.timezone ?? "America/New_York",
      city: input.city ?? "",
      country: input.country ?? "",
      status: input.status ?? "active",
      devicesOnline: 0,
      devicesTotal: 0,
    };
    branches = [branch, ...branches];
    await persistBranchesToDisk();
    return branch;
  },
  async ensureBranchesLoaded(): Promise<void> {
    await reloadBranchesFromDisk();
  },
  async persistBranches(): Promise<void> {
    await persistBranchesToDisk();
  },

  // ─── DEVICES ────────────────────────────────────────────────────────────────

  async getDevices(accountId?: string): Promise<Device[]> {
    await reloadDevicesFromDisk();
    if (!accountId) return devices;
    return devices.filter((d) => d.accountId === accountId);
  },
  async addDevice(input: Omit<Device, "id" | "accountId" | "lastSeen" | "lastHeartbeat"> & Partial<Pick<Device, "platform" | "health" | "capabilities" | "accountId">>): Promise<Device> {
    await reloadDevicesFromDisk();
    const now = new Date().toISOString();
    const device: Device = {
      name: input.name,
      branchId: input.branchId,
      type: input.type,
      status: input.status,
      ipAddress: input.ipAddress,
      agentVersion: input.agentVersion ?? "1.0.0",
      currentSourceId: input.currentSourceId,
      volume: input.volume ?? 50,
      platform: input.platform ?? "windows",
      health: input.health ?? "ok",
      capabilities: input.capabilities ?? ["supportsPlay", "supportsStop", "supportsVolume", "supportsResume"],
      id: `dev-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      accountId: input.accountId ?? demoAccount.id,
      lastSeen: now,
      lastHeartbeat: now,
    };
    devices = [device, ...devices];
    await persistDevicesToDisk();
    return device;
  },
  async ensureDevicesLoaded(): Promise<void> {
    await reloadDevicesFromDisk();
  },
  async persistDevices(): Promise<void> {
    await persistDevicesToDisk();
  },

  // ─── SOURCES ────────────────────────────────────────────────────────────────

  async getSources(accountId?: string): Promise<Source[]> {
    await reloadSourcesFromDisk();
    if (!accountId) return sources;
    return sources.filter((s) => s.accountId === accountId);
  },
  async addSource(input: Omit<Source, "id" | "accountId"> & Partial<Pick<Source, "accountId">>): Promise<Source> {
    await reloadSourcesFromDisk();
    const target = input.target ?? (input as Source & { uriOrPath?: string }).uriOrPath ?? "";
    const source: Source = {
      ...input,
      target,
      uriOrPath: target,
      provider: input.provider,
      playerMode: input.playerMode,
      id: `src-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      accountId: input.accountId ?? demoAccount.id,
    };
    sources = [source, ...sources];
    await persistSourcesToDisk();
    return source;
  },
  async deleteSource(id: string): Promise<boolean> {
    await reloadSourcesFromDisk();
    const before = sources.length;
    sources = sources.filter((s) => s.id !== id);
    await persistSourcesToDisk();
    return sources.length < before;
  },
  async updateSource(id: string, data: Partial<Source>): Promise<Source | null> {
    await reloadSourcesFromDisk();
    const idx = sources.findIndex((s) => s.id === id);
    if (idx < 0) return null;
    sources[idx] = { ...sources[idx], ...data };
    await persistSourcesToDisk();
    return sources[idx];
  },
  async ensureSourcesLoaded(): Promise<void> {
    await reloadSourcesFromDisk();
  },
  async persistSources(): Promise<void> {
    await persistSourcesToDisk();
  },

  // ─── SCHEDULES ──────────────────────────────────────────────────────────────

  getSchedules(accountId?: string): Schedule[] {
    if (!accountId) return schedules;
    return schedules.filter((s) => s.accountId === accountId);
  },
  /** Lookup by id only (trimmed). Used when URL id must match persisted id regardless of minor encoding/whitespace issues. */
  findScheduleById(id: string): Schedule | null {
    const nid = id.trim();
    return schedules.find((s) => s.id.trim() === nid) ?? null;
  },
  getSchedule(id: string, accountId?: string): Schedule | null {
    const nid = id.trim();
    const list = accountId
      ? schedules.filter((s) => (s.accountId ?? "").trim() === accountId.trim())
      : schedules;
    return list.find((s) => s.id.trim() === nid) ?? null;
  },
  addSchedule(input: Omit<Schedule, "id" | "accountId"> & Partial<Pick<Schedule, "targetType" | "targetId" | "accountId">>): Schedule {
    const targetType = input.targetType ?? "SOURCE";
    const targetId = input.targetId ?? input.sourceId ?? "";
    const now = new Date().toISOString();
    const rawEnd = input.endTimeLocal;
    const endTimeLocal =
      typeof rawEnd === "string" && rawEnd.trim().length > 0 ? rawEnd : "23:59";
    const schedule: Schedule = {
      ...input,
      endTimeLocal,
      targetType,
      targetId,
      sourceId: input.sourceId ?? (targetType === "SOURCE" ? targetId : undefined),
      createdAt: input.createdAt ?? now,
      updatedAt: now,
      id: `sch-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      accountId: input.accountId ?? demoAccount.id,
    };
    schedules = [schedule, ...schedules];
    return schedule;
  },
  updateSchedule(id: string, data: Partial<Schedule>): Schedule | null {
    const nid = id.trim();
    const idx = schedules.findIndex((s) => s.id.trim() === nid);
    if (idx < 0) return null;
    const merged = { ...schedules[idx], ...data };
    let endRaw = merged.endTimeLocal;
    if (endRaw === undefined || endRaw === null) {
      endRaw = schedules[idx].endTimeLocal;
    }
    const endTimeLocal =
      typeof endRaw === "string" && endRaw.trim().length > 0 ? endRaw : "23:59";
    const updated: Schedule = {
      ...merged,
      endTimeLocal,
      id: schedules[idx].id,
      accountId: schedules[idx].accountId,
      updatedAt: new Date().toISOString(),
    };
    schedules[idx] = updated;
    return updated;
  },
  deleteSchedule(id: string): boolean {
    const nid = id.trim();
    const before = schedules.length;
    schedules = schedules.filter((s) => s.id.trim() !== nid);
    return schedules.length < before;
  },
  async ensureSchedulesLoaded(): Promise<void> {
    await reloadSchedulesFromDisk();
  },
  async persistSchedules(): Promise<void> {
    await persistSchedulesToDisk();
  },

  // ─── ANNOUNCEMENTS ──────────────────────────────────────────────────────────

  async getAnnouncements(): Promise<Announcement[]> {
    await reloadAnnouncementsFromDisk();
    return announcements;
  },
  async addAnnouncement(input: Omit<Announcement, "id" | "accountId">): Promise<Announcement> {
    await reloadAnnouncementsFromDisk();
    const announcement: Announcement = {
      ...input,
      id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      accountId: demoAccount.id,
    };
    announcements = [announcement, ...announcements];
    await persistAnnouncementsToDisk();
    return announcement;
  },
  async ensureAnnouncementsLoaded(): Promise<void> {
    await reloadAnnouncementsFromDisk();
  },
  async persistAnnouncements(): Promise<void> {
    await persistAnnouncementsToDisk();
  },

  // ─── LOGS (in-memory only — non-critical for pilot) ─────────────────────────

  getLogs(): LogEntry[] {
    return logs;
  },
  addLog(entry: Omit<LogEntry, "id" | "accountId">): LogEntry {
    const log: LogEntry = {
      ...entry,
      id: `log-${Date.now()}`,
      accountId: demoAccount.id,
    };
    logs = [log, ...logs];
    return log;
  },
};

