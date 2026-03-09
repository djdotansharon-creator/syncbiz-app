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
  getBranches(): Branch[] {
    return branches;
  },
  getDevices(): Device[] {
    return devices;
  },
  getSources(): Source[] {
    return sources;
  },
  getSchedules(): Schedule[] {
    return schedules;
  },
  getAnnouncements(): Announcement[] {
    return announcements;
  },
  getLogs(): LogEntry[] {
    return logs;
  },
  addDevice(input: Omit<Device, "id" | "accountId" | "lastSeen" | "lastHeartbeat"> & Partial<Pick<Device, "platform" | "health" | "capabilities">>): Device {
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
      accountId: demoAccount.id,
      lastSeen: now,
      lastHeartbeat: now,
    };
    devices = [device, ...devices];
    return device;
  },
  addSource(input: Omit<Source, "id" | "accountId">): Source {
    const target = input.target ?? (input as Source & { uriOrPath?: string }).uriOrPath ?? "";
    const source: Source = {
      ...input,
      target,
      uriOrPath: target,
      id: `src-${String(sources.length + 1).padStart(3, "0")}`,
      accountId: demoAccount.id,
    };
    sources = [source, ...sources];
    return source;
  },
  addSchedule(input: Omit<Schedule, "id" | "accountId">): Schedule {
    const schedule: Schedule = {
      ...input,
      id: `sch-${String(schedules.length + 1).padStart(3, "0")}`,
      accountId: demoAccount.id,
    };
    schedules = [schedule, ...schedules];
    return schedule;
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

