/**
 * Paths for persistent data (playlists, catalog, radio, deleted-sources).
 * On Railway: mount volume to /app/data; RAILWAY_VOLUME_MOUNT_PATH is set automatically.
 * Locally: backward compatible with playlists/, catalog/, radio/, data/.
 */
import { join } from "path";
import { existsSync } from "fs";

const cwd = () => process.cwd();

function getVolumePath(): string | null {
  const v = process.env.RAILWAY_VOLUME_MOUNT_PATH;
  return typeof v === "string" && v.trim() ? v.trim().replace(/\/$/, "") : null;
}

function resolvePersistentDir(subdir: "playlists" | "catalog" | "radio"): string {
  const vol = getVolumePath();
  if (!vol) return join(cwd(), subdir);

  const preferred = join(vol, subdir);
  const legacy = join(cwd(), subdir);

  // Production safety (Railway):
  // - When a volume mount is configured, always use <volume>/<subdir>.
  // - This prevents accidental reads/writes from image-bundled legacy dirs (`./playlists`, etc.)
  //   that are non-persistent across redeploys.
  if (process.env.RAILWAY_VOLUME_MOUNT_PATH) return preferred;

  // Non-Railway migration safety:
  // - New layout: <volume>/<subdir>
  // - Legacy layout: <app_root>/<subdir>
  // Prefer volume when present; if only legacy exists, keep reading it.
  if (existsSync(preferred)) return preferred;
  if (existsSync(legacy)) return legacy;
  return preferred;
}

export function getPlaylistsDir(): string {
  return resolvePersistentDir("playlists");
}

/** Catalog items (Phase 1): one JSON file per item under this directory. */
export function getCatalogDir(): string {
  return resolvePersistentDir("catalog");
}

export function getRadioDir(): string {
  return resolvePersistentDir("radio");
}

export function getDataDir(): string {
  const vol = getVolumePath();
  return vol ?? join(cwd(), "data");
}

/** Path to users.json for persistent user/membership data. */
export function getUsersDataPath(): string {
  return join(getDataDir(), "users.json");
}

/** Path to schedules.json — persisted schedule blocks (API + dev survival across restarts). */
export function getSchedulesDataPath(): string {
  return join(getDataDir(), "schedules.json");
}
