import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { DesktopRuntimeConfig } from "../shared/mvp-types";

const CONFIG_NAME = "syncbiz-player-runtime.json";

/**
 * Known music-library locations to auto-adopt when the operator hasn't picked one.
 * Ordered by preference: the PlaylistPro standard Dropbox library first, then the
 * OS Music folder. This is what makes M3U import (and local playback) work out of
 * the box on a fresh player PC — no "Music folder is not configured" wall. The
 * operator can still change it or add more folders in Settings.
 */
function candidateDefaultMusicFolders(): string[] {
  return [
    "D:\\Playlistpro\\Dropbox\\MUSIC",
    join(homedir(), "Music"),
  ];
}

/** First known music location that actually exists on this machine, or undefined. */
export function resolveDefaultMusicFolder(): string | undefined {
  for (const candidate of candidateDefaultMusicFolders()) {
    try {
      if (candidate && existsSync(candidate)) return candidate;
    } catch {
      /* unreadable candidate — skip */
    }
  }
  return undefined;
}

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
    musicFolderPath: resolveDefaultMusicFolder(),
  };
}

/** The exact legacy localhost defaults earlier VONO builds persisted. Only these are auto-healed to prod. */
export const LEGACY_LOCAL_API_BASE_URL = "http://localhost:3000";
export const LEGACY_LOCAL_WS_URL = "ws://localhost:3001";

/**
 * Packaged-only production endpoint defaults + legacy self-heal (PURE — no electron import, so it is unit-
 * testable). In a packaged build, an EMPTY or exactly-legacy-localhost apiBaseUrl/wsUrl is replaced with the
 * production endpoints; a deliberate custom endpoint (anything else, e.g. a staging URL) is preserved untouched.
 * In dev/non-packaged mode nothing changes (localhost behavior kept). Returns the config + whether it changed so
 * the caller can persist the correction once.
 */
export function normalizeEndpointsForPackaged(
  cfg: DesktopRuntimeConfig,
  opts: { packaged: boolean; prodApiBaseUrl: string; prodWsUrl: string },
): { config: DesktopRuntimeConfig; changed: boolean } {
  if (!opts.packaged) return { config: cfg, changed: false };
  let changed = false;
  let apiBaseUrl = cfg.apiBaseUrl;
  let wsUrl = cfg.wsUrl;
  const api = (apiBaseUrl ?? "").trim();
  if ((api === "" || api === LEGACY_LOCAL_API_BASE_URL) && apiBaseUrl !== opts.prodApiBaseUrl) {
    apiBaseUrl = opts.prodApiBaseUrl;
    changed = true;
  }
  const ws = (wsUrl ?? "").trim();
  if ((ws === "" || ws === LEGACY_LOCAL_WS_URL) && wsUrl !== opts.prodWsUrl) {
    wsUrl = opts.prodWsUrl;
    changed = true;
  }
  return changed ? { config: { ...cfg, apiBaseUrl, wsUrl }, changed: true } : { config: cfg, changed: false };
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
      musicFolderPath:
        typeof data.musicFolderPath === "string" && data.musicFolderPath.trim()
          ? data.musicFolderPath.trim()
          : undefined,
    };
    // Existing installs whose music folder was never picked (key absent/blank) adopt
    // the known default so import/local playback work without a manual Settings step.
    // A folder the operator explicitly set is preserved above; only the empty case defaults.
    if (!merged.musicFolderPath) {
      const fallback = resolveDefaultMusicFolder();
      if (fallback) {
        merged.musicFolderPath = fallback;
        saveRuntimeConfig(userData, merged);
      }
    }
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
    // Empty string clears; absent key preserves current value.
    musicFolderPath:
      patch.musicFolderPath === undefined
        ? current.musicFolderPath
        : typeof patch.musicFolderPath === "string" && patch.musicFolderPath.trim()
          ? patch.musicFolderPath.trim()
          : undefined,
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
