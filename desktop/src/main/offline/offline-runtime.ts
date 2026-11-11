/**
 * OFFLINE — the MAIN-process singleton (Music Bank Phase 2, stage C; owner-approved 2026-11-11).
 *
 * OFF unless `ProgramData\VONO\state\offline.json` says {"enabled": true} on THIS machine — then (after app ready):
 * DPAPI master key → vault → loopback server → background sync (30 s after start, every 30 min, and when a new
 * desktop token arrives). Any failure here leaves the resolver as the identity (the station streams exactly as before).
 */
import { readFileSync } from "node:fs";
import { loadOrCreateMasterKey, electronSafeStorageProtector } from "./vault-keys";
import { OfflineVault } from "./vault-store";
import { startVaultServer } from "./vault-server";
import { OfflineService } from "./offline-service";
import { vonoOfflineDir, vonoOfflineFlagPath } from "../vono-paths";

type Log = (level: "INFO" | "WARN", msg: string, data?: Record<string, unknown>) => void;

let service: OfflineService | null = null;
let starting = false;

export function offlineEnabledOnThisMachine(): boolean {
  try {
    const j = JSON.parse(readFileSync(vonoOfflineFlagPath(), "utf8")) as { enabled?: unknown };
    return j?.enabled === true;
  } catch {
    return false;
  }
}

export function initOfflineService(deps: {
  getConfig: () => { apiBaseUrl?: string | null; wsToken?: string | null };
  withToken: (url: string) => string;
  log: Log;
}): void {
  if (service || starting) return;
  if (!offlineEnabledOnThisMachine()) {
    deps.log("INFO", "OFFLINE_DISABLED_ON_THIS_MACHINE");
    return;
  }
  starting = true;
  void (async () => {
    try {
      const dir = vonoOfflineDir();
      const key = loadOrCreateMasterKey(dir, electronSafeStorageProtector());
      if (!key) {
        deps.log("WARN", "OFFLINE_KEY_UNAVAILABLE"); // DPAPI unavailable / another Windows user → stream only
        return;
      }
      const vault = new OfflineVault(dir, key.key);
      let svc: OfflineService | null = null;
      const server = await startVaultServer(vault, { onCorrupt: (opaqueId) => svc?.markCorrupt(opaqueId) });
      svc = new OfflineService({ dir, master: key.key, vault, server, getConfig: deps.getConfig, withToken: deps.withToken, log: deps.log });
      service = svc;
      deps.log("INFO", "OFFLINE_READY", { keyCreated: key.created, stored: vault.logicalIds().length, licensed: svc.readyCount(), port: server.port });
      setTimeout(() => void svc?.sync("start"), 30_000).unref?.();
      setInterval(() => void svc?.sync("tick"), 30 * 60_000).unref?.();
    } catch (e) {
      deps.log("WARN", "OFFLINE_INIT_FAILED", { err: (e as Error)?.message?.slice(0, 120) });
    } finally {
      starting = false;
    }
  })();
}

/** MpvManager.loadInternal hot path: the loopback URL for a stored + licensed song, else the URL unchanged. */
export function resolveOfflineUrl(url: string): string {
  return service ? service.resolve(url) : url;
}

/** A new desktop token (sign-in / refresh) → sync soon. */
export function refreshOffline(reason: string): void {
  void service?.sync(reason);
}
