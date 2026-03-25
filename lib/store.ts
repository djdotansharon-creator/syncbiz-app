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
  getBranches(accountId?: string): Branch[] {
    if (!accountId) return branches;
    return branches.filter((b) => b.accountId === accountId);
  },
  addBranch(
    input: Pick<Branch, "accountId" | "name"> &
      Partial<Pick<Branch, "id" | "code" | "timezone" | "city" | "country" | "status">>,
  ): Branch {
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
    return branch;
  },
  getDevices(accountId?: string): Device[] {
    if (!accountId) return devices;
    return devices.filter((d) => d.accountId === accountId);
  },
  getSources(accountId?: string): Source[] {
    if (!accountId) return sources;
    return sources.filter((s) => s.accountId === accountId);
  },
  getSchedules(accountId?: string): Schedule[] {
    if (!accountId) return schedules;
    return schedules.filter((s) => s.accountId === accountId);
  },
  getAnnouncements(): Announcement[] {
    return announcements;
  },
  getLogs(): LogEntry[] {
    return logs;
  },
  addDevice(input: Omit<Device, "id" | "accountId" | "lastSeen" | "lastHeartbeat"> & Partial<Pick<Device, "platform" | "health" | "capabilities" | "accountId">>): Device {
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
      id: `dev-${String(devices.length + 1).padStart(3, "0")}`,
      accountId: input.accountId ?? demoAccount.id,
      lastSeen: now,
      lastHeartbeat: now,
    };
    devices = [device, ...devices];
    return device;
  },
  addSource(input: Omit<Source, "id" | "accountId"> & Partial<Pick<Source, "accountId">>): Source {
    const target = input.target ?? (input as Source & { uriOrPath?: string }).uriOrPath ?? "";
    const source: Source = {
      ...input,
      target,
      uriOrPath: target,
      provider: input.provider,
      playerMode: input.playerMode,
      id: `src-${String(sources.length + 1).padStart(3, "0")}`,
      accountId: input.accountId ?? demoAccount.id,
    };
    sources = [source, ...sources];
    return source;
  },
  deleteSource(id: string): boolean {
    const before = sources.length;
    sources = sources.filter((s) => s.id !== id);
    return sources.length < before;
  },
  updateSource(id: string, data: Partial<Source>): Source | null {
    const idx = sources.findIndex((s) => s.id === id);
    if (idx < 0) return null;
    sources[idx] = { ...sources[idx], ...data };
    return sources[idx];
  },
  getSchedule(id: string, accountId?: string): Schedule | null {
    const list = accountId ? schedules.filter((s) => s.accountId === accountId) : schedules;
    return list.find((s) => s.id === id) ?? null;
  },
  addSchedule(input: Omit<Schedule, "id" | "accountId"> & Partial<Pick<Schedule, "targetType" | "targetId" | "accountId">>): Schedule {
    const targetType = input.targetType ?? "SOURCE";
    const targetId = input.targetId ?? input.sourceId ?? "";
    const now = new Date().toISOString();
    const schedule: Schedule = {
      ...input,
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
    const idx = schedules.findIndex((s) => s.id === id);
    if (idx < 0) return null;
    const updated: Schedule = {
      ...schedules[idx],
      ...data,
      id: schedules[idx].id,
      accountId: schedules[idx].accountId,
      updatedAt: new Date().toISOString(),
    };
    schedules[idx] = updated;
    return updated;
  },
  deleteSchedule(id: string): boolean {
    const before = schedules.length;
    schedules = schedules.filter((s) => s.id !== id);
    return schedules.length < before;
  },
  addAnnouncement(input: Omit<Announcement, "id" | "accountId">): Announcement {
    const announcement: Announcement = {
      ...input,
      id: `ann-${announcements.length + 1}`.padStart(7, "0"),
      accountId: demoAccount.id,
    };
    announcements = [announcement, ...announcements];
    return announcement;
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

