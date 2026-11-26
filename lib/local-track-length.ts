/**
 * A STATION READS THE LENGTH OF ITS OWN FILES (owner 2026-11-21: "files on the player's computer are not loaded with their real length — every song loaded from the computer must be
 * saved with how long it is. It must be so.").
 *
 * The server can never read a local file (its path never leaves the machine — CLAUDE.md §12), so the length is read HERE, in the renderer of the machine that owns the file, through the
 * desktop's existing `getLocalAudioTags` (the same call the My Music table already makes; MAIN only reads the file's tags, it never touches playback), and ONLY the numbers are sent back
 * — `POST /api/playlists/:id/track-durations { durations: { trackId: seconds } }` — never a path.
 *
 * Gentle on purpose (the station is playing music): one file at a time, a short breath between two files, nothing when the page is not the desktop's. A browser / phone has no such call —
 * `learnLocalLengths` then answers null and changes nothing.
 */

import type { Playlist } from "@/lib/playlist-types";
import { getPlaylistTracks } from "@/lib/playlist-types";
import { tracksMissingLength } from "@/lib/playlist-duration";

/** a short breath between two files so the station's own process always has room for the music */
const BREATH_MS = 20;
/** lengths are saved in chunks, so a window closed in the middle loses at most one chunk */
const CHUNK = 50;

export type SaveAnswer = { durationSeconds: number | null; applied: number; stillMissing: number };

/** true only inside the desktop app (it is the machine that owns the files) */
export function canReadLocalLengths(): boolean {
  return typeof window !== "undefined" && typeof window.syncbizDesktop?.getLocalAudioTags === "function";
}

/** the songs of a playlist that are local files with no length yet */
export function localTracksMissingLength(playlist: Playlist): { id: string; url: string }[] {
  return tracksMissingLength(getPlaylistTracks(playlist))
    .filter((t) => t.type === "local" && typeof t.url === "string" && t.url.trim().length > 0)
    .map((t) => ({ id: t.id, url: t.url }));
}

/** numbers only (track id -> seconds), never a path or an address; also used by the YouTube length reader (lib/youtube-track-length.ts) */
export async function saveLengths(playlistId: string, durations: Record<string, number>): Promise<SaveAnswer | null> {
  try {
    const res = await fetch(`/api/playlists/${encodeURIComponent(playlistId)}/track-durations`, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ durations }),
    });
    if (!res.ok) return null;
    return (await res.json()) as SaveAnswer;
  } catch {
    return null;
  }
}

async function readAndSave(playlist: Playlist): Promise<number | null> {
  const read = typeof window !== "undefined" ? window.syncbizDesktop?.getLocalAudioTags : undefined;
  if (typeof read !== "function") return null;
  const todo = localTracksMissingLength(playlist);
  if (todo.length === 0) return null;
  let total: number | null = null;
  let pending: Record<string, number> = {};
  const flush = async () => {
    if (Object.keys(pending).length === 0) return;
    const batch = pending;
    pending = {};
    const answer = await saveLengths(playlist.id, batch);
    if (answer) total = answer.durationSeconds;
  };
  for (const t of todo) {
    try {
      const r = await read(t.url);
      if (r.status === "ok" && typeof r.tags.durationSec === "number" && Number.isFinite(r.tags.durationSec) && r.tags.durationSec >= 1) pending[t.id] = Math.round(r.tags.durationSec);
    } catch {
      /* this file stays unknown (outside the approved music folders, moved, unreadable) */
    }
    if (Object.keys(pending).length >= CHUNK) await flush();
    await new Promise<void>((resolve) => window.setTimeout(resolve, BREATH_MS));
  }
  await flush();
  return total;
}

const running = new Map<string, Promise<number | null>>();

/**
 * Read the real length of the local songs of `playlist` that have none and save them. Answers the playlist's total length (seconds) when every song is known afterwards, else null.
 * One run per playlist at a time (a second caller shares the first). Never rejects.
 */
export function learnLocalLengths(playlist: Playlist): Promise<number | null> {
  const cur = running.get(playlist.id);
  if (cur) return cur;
  const p = readAndSave(playlist)
    .catch(() => null)
    .finally(() => running.delete(playlist.id));
  running.set(playlist.id, p);
  return p;
}
