/**
 * Paths for persistent data (playlists, catalog, radio, deleted-sources).
 * On Railway: mount volume to /app/data; RAILWAY_VOLUME_MOUNT_PATH is set automatically.
 * Locally: backward compatible with playlists/, catalog/, radio/, data/.
 */
import { join } from "path";

const cwd = () => process.cwd();

function getVolumePath(): string | null {
  const v = process.env.RAILWAY_VOLUME_MOUNT_PATH;
  return typeof v === "string" && v.trim() ? v.trim().replace(/\/$/, "") : null;
}

export function getPlaylistsDir(): string {
  const vol = getVolumePath();
  return vol ? join(vol, "playlists") : join(cwd(), "playlists");
}

/** Catalog items (Phase 1): one JSON file per item under this directory. */
export function getCatalogDir(): string {
  const vol = getVolumePath();
  return vol ? join(vol, "catalog") : join(cwd(), "catalog");
}

export function getRadioDir(): string {
  const vol = getVolumePath();
  return vol ? join(vol, "radio") : join(cwd(), "radio");
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
