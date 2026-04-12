import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DesktopRuntimeConfig } from "../shared/mvp-types";

const CONFIG_NAME = "syncbiz-player-runtime.json";

function newDeviceId(): string {
  return `dsk-${randomUUID()}`;
}

export function defaultRuntimeConfig(): DesktopRuntimeConfig {
  return {
    deviceId: newDeviceId(),
    branchId: "default",
    workspaceLabel: "",
    apiBaseUrl: "http://localhost:3000",
    wsUrl: "ws://localhost:3001",
    wsToken: "",
    lastAuthEmail: undefined,
    desktopTokenExpiresAtIso: undefined,
  };
}

export function loadRuntimeConfig(userData: string): DesktopRuntimeConfig {
  const dir = userData;
  const path = join(dir, CONFIG_NAME);
  if (!existsSync(path)) {
    const fresh = defaultRuntimeConfig();
    saveRuntimeConfig(userData, fresh);
    return fresh;
  }
  try {
    const raw = readFileSync(path, "utf-8");
    const data = JSON.parse(raw) as Partial<DesktopRuntimeConfig>;
    const base = defaultRuntimeConfig();
    const merged: DesktopRuntimeConfig = {
      deviceId: typeof data.deviceId === "string" && data.deviceId.trim() ? data.deviceId.trim() : base.deviceId,
      branchId: typeof data.branchId === "string" && data.branchId.trim() ? data.branchId.trim() : base.branchId,
      workspaceLabel: typeof data.workspaceLabel === "string" ? data.workspaceLabel : "",
      apiBaseUrl:
        typeof data.apiBaseUrl === "string" && data.apiBaseUrl.trim()
          ? data.apiBaseUrl.trim()
          : base.apiBaseUrl,
      wsUrl: typeof data.wsUrl === "string" && data.wsUrl.trim() ? data.wsUrl.trim() : base.wsUrl,
      wsToken: typeof data.wsToken === "string" ? data.wsToken : "",
      lastAuthEmail:
        typeof data.lastAuthEmail === "string" && data.lastAuthEmail.trim()
          ? data.lastAuthEmail.trim()
          : undefined,
      desktopTokenExpiresAtIso:
        typeof data.desktopTokenExpiresAtIso === "string" && data.desktopTokenExpiresAtIso.trim()
          ? data.desktopTokenExpiresAtIso.trim()
          : undefined,
    };
    return merged;
  } catch {
    const fresh = defaultRuntimeConfig();
    saveRuntimeConfig(userData, fresh);
    return fresh;
  }
}

export function saveRuntimeConfig(userData: string, config: DesktopRuntimeConfig): void {
  mkdirSync(userData, { recursive: true });
  const path = join(userData, CONFIG_NAME);
  writeFileSync(path, JSON.stringify(config, null, 2), "utf-8");
}

export function patchRuntimeConfig(
  userData: string,
  current: DesktopRuntimeConfig,
  patch: Partial<DesktopRuntimeConfig>,
): DesktopRuntimeConfig {
  let next: DesktopRuntimeConfig = {
    ...current,
    ...patch,
    deviceId: typeof patch.deviceId === "string" && patch.deviceId.trim() ? patch.deviceId.trim() : current.deviceId,
    branchId: typeof patch.branchId === "string" && patch.branchId.trim() ? patch.branchId.trim() : current.branchId,
    workspaceLabel: patch.workspaceLabel !== undefined ? patch.workspaceLabel : current.workspaceLabel,
    apiBaseUrl:
      typeof patch.apiBaseUrl === "string" && patch.apiBaseUrl.trim()
        ? patch.apiBaseUrl.trim()
        : current.apiBaseUrl,
    wsUrl: typeof patch.wsUrl === "string" && patch.wsUrl.trim() ? patch.wsUrl.trim() : current.wsUrl,
    wsToken: patch.wsToken !== undefined ? patch.wsToken : current.wsToken,
    lastAuthEmail: patch.lastAuthEmail !== undefined ? patch.lastAuthEmail : current.lastAuthEmail,
    desktopTokenExpiresAtIso:
      patch.desktopTokenExpiresAtIso !== undefined
        ? patch.desktopTokenExpiresAtIso
        : current.desktopTokenExpiresAtIso,
  };
  if (!next.deviceId.trim()) {
    next = { ...next, deviceId: newDeviceId() };
  }
  if (!next.branchId.trim()) {
    next = { ...next, branchId: "default" };
  }
  saveRuntimeConfig(userData, next);
  return next;
}
