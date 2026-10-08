/**
 * P0 Gate 2d (owner rule 2026-10-09) — the station REMEMBERS its last playback source across shutdown / restart /
 * crash, with NO age limit, until someone changes it (manually, later via Control Room / Schedule):
 *   last source URL playlist → restart returns to that URL playlist (+ its Play Next queue);
 *   last source LOCAL       → restart returns to LOCAL (the renderer's own device-only snapshot holds the details).
 *
 * Stored in `C:\ProgramData\VONO\state\playback-source.json` next to the durable device id (atomic tmp + rename,
 * never a partial file). Only remote URLs + titles are stored — NEVER a local filesystem path (CLAUDE.md §12) — and
 * this file never leaves the machine.
 */
import { existsSync, readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { vonoStateDir } from "./vono-paths";

const SCHEMA_VERSION = 1;

export type SavedUrlItem = { id: string; title: string; cover: string | null; url: string; durationSeconds?: number };

export type SavedUrlSession = {
  items: SavedUrlItem[];
  index: number;
  shell: string | null;
  sourceId: string;
  origin?: "playlist" | "radio" | "source";
  sourceType?: string;
  sessionTitle: string | null;
  sessionPlaylistId: string | null;
  playNext: Array<SavedUrlItem & { qid: string }>;
};

export type PlaybackSourceRecord = {
  schemaVersion: number;
  kind: "url" | "local";
  updatedAt: number;
  url?: SavedUrlSession;
};

let pathOverride: string | null = null;
/** Tests only: redirect the store to a temp file (never the real ProgramData). */
export function setPlaybackSourcePathForTests(p: string | null): void {
  pathOverride = p;
}

export function playbackSourcePath(): string {
  return pathOverride ?? path.join(vonoStateDir(), "playback-source.json");
}

const isLocalOnly = (u: string) => u.startsWith("local://") || /^[a-zA-Z]:[\\/]/.test(u) || u.startsWith("\\\\") || u.startsWith("file:");

/** Read the last source. null = nothing saved / unreadable (→ the station behaves as before: LOCAL restore). */
export function readPlaybackSource(): PlaybackSourceRecord | null {
  const p = playbackSourcePath();
  try {
    if (!existsSync(p)) return null;
    const rec = JSON.parse(readFileSync(p, "utf-8")) as Partial<PlaybackSourceRecord>;
    if (rec?.kind !== "url" && rec?.kind !== "local") return null;
    if (rec.kind === "url") {
      const s = rec.url;
      if (!s || !Array.isArray(s.items) || s.items.length === 0) return null;
      const items = s.items.filter((i) => i && typeof i.url === "string" && i.url && !isLocalOnly(i.url));
      if (items.length === 0) return null;
      return {
        schemaVersion: SCHEMA_VERSION, kind: "url", updatedAt: Number(rec.updatedAt) || 0,
        url: { ...s, items: s.items, index: Math.max(0, Math.min(Number(s.index) || 0, s.items.length - 1)), playNext: Array.isArray(s.playNext) ? s.playNext.filter((q) => q && typeof q.url === "string" && !isLocalOnly(q.url)) : [] },
      };
    }
    return { schemaVersion: SCHEMA_VERSION, kind: "local", updatedAt: Number(rec.updatedAt) || 0 };
  } catch {
    return null;
  }
}

/** Atomically persist the last source. Never throws; never leaves a partial file. */
export function writePlaybackSource(rec: Omit<PlaybackSourceRecord, "schemaVersion" | "updatedAt">): boolean {
  const p = playbackSourcePath();
  const tmp = `${p}.tmp-${process.pid}-${Date.now()}`;
  try {
    const body: PlaybackSourceRecord = { schemaVersion: SCHEMA_VERSION, updatedAt: Date.now(), ...rec };
    if (body.url) {
      body.url = {
        ...body.url,
        items: body.url.items.map((i) => ({ ...i, url: isLocalOnly(i.url) ? "" : i.url })),
        playNext: body.url.playNext.filter((q) => !isLocalOnly(q.url)),
      };
    }
    writeFileSync(tmp, JSON.stringify(body), "utf-8");
    renameSync(tmp, p);
    return true;
  } catch {
    try { rmSync(tmp, { force: true }); } catch { /* ignore */ }
    return false;
  }
}
