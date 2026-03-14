/**
 * Paths for persistent data (playlists, radio, deleted-sources).
 * On Railway: mount volume to /app/data; RAILWAY_VOLUME_MOUNT_PATH is set automatically.
 * Locally: backward compatible with playlists/, radio/, data/.
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

export function getRadioDir(): string {
  const vol = getVolumePath();
  return vol ? join(vol, "radio") : join(cwd(), "radio");
}

export function getDataDir(): string {
  const vol = getVolumePath();
  return vol ?? join(cwd(), "data");
}
