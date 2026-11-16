import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { DesktopRuntimeConfig } from "../shared/mvp-types";
import { identityTokenCipher, type TokenCipher } from "./token-at-rest";

const CONFIG_NAME = "syncbiz-player-runtime.json";

/**
 * C6b (2026-11-14): the `wsToken` is sealed at rest through this cipher. Default cannot seal (no protection) so,
 * unwired, a NEW token is never written in cleartext (the save preserves what is on disk). VONO MAIN injects the
 * DPAPI cipher at startup via `setTokenCipher`, before any token save. The in-memory config always holds the
 * PLAINTEXT token — only the on-disk JSON carries the sealed form; server verification is unchanged.
 */
let tokenCipher: TokenCipher = identityTokenCipher();
export function setTokenCipher(cipher: TokenCipher): void {
  tokenCipher = cipher;
}

/**
 * C6b: a minimal WARN sink so the config service (a pure, electron-free module) can report at-rest anomalies WITHOUT
 * the token value. Default is a no-op; VONO MAIN wires it to the file logger via `setConfigWarnLogger`.
 */
let warnLog: (message: string, data?: Record<string, unknown>) => void = () => {};
export function setConfigWarnLogger(fn: (message: string, data?: Record<string, unknown>) => void): void {
  warnLog = fn;
}

/** Outcome of a save, so callers can tell whether a NEW token was actually persisted (never reported falsely). */
export type SaveRuntimeConfigResult = {
  /** true when the token on disk now reflects the requested token (sealed, or an intentional clear). */
  tokenPersisted: boolean;
  /** true when a legacy cleartext token remains on disk because it could not be sealed. */
  legacyPlaintextRemains: boolean;
};

/** The raw stored `wsToken` as it currently sits on disk (sealed / legacy-plaintext / "" / absent). Never throws. */
function readStoredWsToken(file: string): string {
  try {
    if (!existsSync(file)) return "";
    const data = JSON.parse(readFileSync(file, "utf-8")) as { wsToken?: unknown };
    return typeof data.wsToken === "string" ? data.wsToken : "";
  } catch {
    return "";
  }
}

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
      wsToken: typeof data.wsToken === "string" ? tokenCipher.open(data.wsToken) : "",
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

export function saveRuntimeConfig(userData: string, config: DesktopRuntimeConfig): SaveRuntimeConfigResult {
  mkdirSync(userData, { recursive: true });
  const file = join(userData, CONFIG_NAME);

  // C6b: decide the on-disk token form. The in-memory `config` keeps the PLAINTEXT token; only the JSON is sealed.
  const token = config.wsToken ?? "";
  let onDiskToken: string;
  let tokenPersisted = true;
  let legacyPlaintextRemains = false;
  if (!token) {
    onDiskToken = ""; // intentional clear
  } else {
    const sealed = tokenCipher.seal(token); // string | null — NEVER plaintext
    if (sealed !== null) {
      onDiskToken = sealed; // encrypted-only
    } else {
      // Encryption unavailable / failed → NEVER write cleartext. Preserve the existing on-disk token (sealed or
      // legacy); if nothing is there, store "" (no token). The in-memory token stays valid for this session.
      const existing = readStoredWsToken(file);
      onDiskToken = existing;
      tokenPersisted = false;
      legacyPlaintextRemains = existing !== "" && !tokenCipher.isSealed(existing);
      warnLog("C6b token-at-rest: encryption unavailable — NEW token NOT persisted (no cleartext written)", {
        legacyPlaintextRemains,
      });
    }
  }

  const onDisk: DesktopRuntimeConfig = { ...config, wsToken: onDiskToken };
  // Atomic write (crash/partial-write safe): write a temp file then rename over the target, so a reader never sees a
  // half-written file and a write failure leaves the PREVIOUS file (and its token) intact.
  const tmp = `${file}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(onDisk, null, 2), "utf-8");
    renameSync(tmp, file);
  } catch (err) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* best-effort tmp cleanup */
    }
    throw err; // existing file is untouched (atomic); surface the failure — never report a save that did not happen
  }
  return { tokenPersisted, legacyPlaintextRemains };
}

/**
 * C6b: one-time migration — if the stored token is LEGACY PLAINTEXT and OS protection is now available, re-save it
 * so it becomes sealed. Idempotent (already-sealed or absent → no-op). Never throws; a failure just leaves the file
 * untouched (the token still works via the legacy-plaintext open path). Returns true when a migration write happened.
 */
export function migrateTokenAtRestIfNeeded(userData: string): boolean {
  try {
    const file = join(userData, CONFIG_NAME);
    if (!existsSync(file)) return false;
    const stored = readStoredWsToken(file);
    if (!stored || tokenCipher.isSealed(stored)) return false; // absent or already sealed → nothing to migrate
    if (!tokenCipher.available()) {
      // A legacy cleartext token remains because protection is unavailable. Record it EXPLICITLY — never the value.
      warnLog("C6b token-at-rest: legacy cleartext token remains on disk — encryption unavailable, not migrated", {});
      return false;
    }
    // Legacy plaintext + protection available → load (plaintext in memory) and re-save (seals). Confirm it persisted.
    return saveRuntimeConfig(userData, loadRuntimeConfig(userData)).tokenPersisted;
  } catch {
    return false;
  }
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
