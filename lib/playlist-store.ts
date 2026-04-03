/**
 * File-based playlist storage.
 * Stores each playlist as a JSON file in playlists/ folder.
 * JSON structure: { name, genre, cover, tracks: [{ title, type, url, cover }] }
 * Auto-creates playlists/covers/ and playlists/m3u/ for media assets.
 */

import { mkdir, readdir, readFile, writeFile, unlink } from "fs/promises";
import { join } from "path";
import { getPlaylistsDir } from "./data-path";
import type { Playlist, PlaylistCreateInput, PlaylistTrack } from "./playlist-types";

async function ensurePlaylistsDir(): Promise<void> {
  const dir = getPlaylistsDir();
  const coversDir = join(dir, "covers");
  const m3uDir = join(dir, "m3u");
  try {
    await mkdir(dir, { recursive: true });
    await mkdir(coversDir, { recursive: true });
    await mkdir(m3uDir, { recursive: true });
  } catch (e) {
    console.error("[playlist-store] Failed to create Playlists dir:", e);
    throw e;
  }
}

function playlistPath(id: string): string {
  return join(getPlaylistsDir(), `${id}.json`);
}

function generateId(): string {
  return `pl-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export async function listPlaylists(): Promise<Playlist[]> {
  await ensurePlaylistsDir();
  const dir = getPlaylistsDir();
  const files = await readdir(dir);
  const jsonFiles = files.filter((f) => f.endsWith(".json"));
  const playlists: Playlist[] = [];

  for (const file of jsonFiles) {
    try {
      const content = await readFile(join(dir, file), "utf-8");
      const data = JSON.parse(content) as Playlist & { cover?: string };
      if (data.id && data.name) {
        if (!data.thumbnail && data.cover) data.thumbnail = data.cover;
        playlists.push(data);
      }
    } catch (e) {
      console.warn("[playlist-store] Skipped invalid file:", file, e);
    }
  }

  return playlists.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

export async function listPlaylistsForTenant(tenantId: string): Promise<Playlist[]> {
  const all = await listPlaylists();
  const tid = (tenantId ?? "").trim();
  if (!tid) return [];
  if (tid === "tnt-default") {
    // Backward compatibility: legacy records without tenantId belong to demo tenant.
    return all.filter((p) => !p.tenantId || p.tenantId === tid);
  }
  return all.filter((p) => p.tenantId === tid);
}

export async function getPlaylist(id: string): Promise<Playlist | null> {
  await ensurePlaylistsDir();
  try {
    const content = await readFile(playlistPath(id), "utf-8");
    const data = JSON.parse(content) as Playlist & { cover?: string };
    if (!data.thumbnail && data.cover) data.thumbnail = data.cover;
    return data;
  } catch {
    return null;
  }
}

const DEFAULT_BRANCH_ID = "default";

export async function createPlaylist(input: PlaylistCreateInput): Promise<Playlist> {
  await ensurePlaylistsDir();
  const id = input.id ?? generateId();
  const thumbnail = (input.thumbnail ?? "").trim();
  const branchId = typeof input.branchId === "string" && input.branchId.trim()
    ? input.branchId.trim()
    : DEFAULT_BRANCH_ID;
  /** Persist at least one row so GET /api/playlists/[id] exposes tracks[] (not shell-only JSON). Mirrors getPlaylistTracks legacy single-URL shape. */
  const tracks: PlaylistTrack[] =
    input.tracks && input.tracks.length > 0
      ? input.tracks
      : [
          {
            id,
            name: input.name,
            type: input.type,
            url: input.url,
            cover: thumbnail || undefined,
          },
        ];
  const playlist: Playlist = {
    ...input,
    id,
    thumbnail,
    branchId,
    tenantId: input.tenantId?.trim() || undefined,
    createdAt: new Date().toISOString(),
    tracks,
  };
  const toWrite = { ...playlist, cover: thumbnail || undefined };
  await writeFile(playlistPath(id), JSON.stringify(toWrite, null, 2), "utf-8");
  return playlist;
}

export async function updatePlaylist(id: string, data: Partial<Playlist>): Promise<Playlist | null> {
  const existing = await getPlaylist(id);
  if (!existing) return null;
  const updated: Playlist = { ...existing, ...data, id };
  await writeFile(playlistPath(id), JSON.stringify(updated, null, 2), "utf-8");
  return updated;
}

export async function deletePlaylist(id: string): Promise<boolean> {
  await ensurePlaylistsDir();
  try {
    await unlink(playlistPath(id));
    return true;
  } catch {
    return false;
  }
}
