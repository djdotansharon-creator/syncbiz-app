/**
 * File-based playlist storage.
 * Stores each playlist as a JSON file in playlists/ folder.
 * JSON structure: { name, genre, cover, tracks: [{ title, type, url, cover }] }
 * Auto-creates playlists/covers/ and playlists/m3u/ for media assets.
 */

import { mkdir, readdir, readFile, writeFile, unlink } from "fs/promises";
import { join } from "path";
import type { Playlist, PlaylistCreateInput } from "./playlist-types";

const PLAYLISTS_DIR = join(process.cwd(), "playlists");
const COVERS_DIR = join(PLAYLISTS_DIR, "covers");
const M3U_DIR = join(PLAYLISTS_DIR, "m3u");

async function ensurePlaylistsDir(): Promise<void> {
  try {
    await mkdir(PLAYLISTS_DIR, { recursive: true });
    await mkdir(COVERS_DIR, { recursive: true });
    await mkdir(M3U_DIR, { recursive: true });
  } catch (e) {
    console.error("[playlist-store] Failed to create Playlists dir:", e);
    throw e;
  }
}

function playlistPath(id: string): string {
  return join(PLAYLISTS_DIR, `${id}.json`);
}

function generateId(): string {
  return `pl-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export async function listPlaylists(): Promise<Playlist[]> {
  await ensurePlaylistsDir();
  const files = await readdir(PLAYLISTS_DIR);
  const jsonFiles = files.filter((f) => f.endsWith(".json"));
  const playlists: Playlist[] = [];

  for (const file of jsonFiles) {
    try {
      const content = await readFile(join(PLAYLISTS_DIR, file), "utf-8");
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

export async function createPlaylist(input: PlaylistCreateInput): Promise<Playlist> {
  await ensurePlaylistsDir();
  const id = input.id ?? generateId();
  const thumbnail = (input.thumbnail ?? "").trim();
  const playlist: Playlist = {
    ...input,
    id,
    thumbnail,
    createdAt: new Date().toISOString(),
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
