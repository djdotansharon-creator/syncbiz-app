/**
 * Read common audio tags in the Electron main process (music-metadata, no upload).
 */

import { parseFile } from "music-metadata";
import type { LocalAudioTagFields } from "../shared/mvp-types";

const LOG = "[SyncBiz:desktop:local-tags]";

function joinGenre(v: unknown): string | null {
  if (v == null) return null;
  if (Array.isArray(v)) {
    const s = v.map((x) => String(x).trim()).filter(Boolean);
    return s.length ? s.join(", ") : null;
  }
  const t = String(v).trim();
  return t || null;
}

function joinComment(v: unknown): string | null {
  if (v == null) return null;
  if (Array.isArray(v)) {
    const s = v.map((x) => String(x).trim()).filter(Boolean);
    return s.length ? s.join(" · ") : null;
  }
  const t = String(v).trim();
  return t || null;
}

function formatYear(year: unknown, date: unknown): string | null {
  if (typeof year === "number" && Number.isFinite(year) && year >= 1000 && year <= 9999) {
    return String(Math.trunc(year));
  }
  if (typeof date === "string" && date.length >= 4) {
    const y = date.slice(0, 4);
    if (/^\d{4}$/.test(y)) return y;
  }
  return null;
}

export async function extractLocalAudioTagFields(absolutePath: string): Promise<LocalAudioTagFields> {
  const p = (absolutePath ?? "").trim();
  if (!p) {
    return {
      artist: null,
      title: null,
      album: null,
      genre: null,
      year: null,
      comment: null,
      durationSec: null,
    };
  }
  try {
    const meta = await parseFile(p, {
      duration: true,
      skipCovers: true,
    });
    const c = meta.common;
    const chunks: string[] = [];
    if (Array.isArray(c.artists)) chunks.push(...c.artists.map((x) => String(x).trim()).filter(Boolean));
    const legacyArtist = typeof (c as { artist?: string }).artist === "string" ? (c as { artist?: string }).artist!.trim() : "";
    if (legacyArtist && !chunks.includes(legacyArtist)) chunks.unshift(legacyArtist);
    const artist = chunks.length ? [...new Set(chunks)].join(" / ") : null;
    const durationSec =
      typeof meta.format.duration === "number" && Number.isFinite(meta.format.duration) && meta.format.duration >= 0
        ? meta.format.duration
        : null;
    return {
      artist,
      title: c.title?.trim() || null,
      album: c.album?.trim() || null,
      genre: joinGenre(c.genre),
      year: formatYear(c.year, c.date),
      comment: joinComment(c.comment),
      durationSec,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(LOG, "unreadable or missing tags", { path: p.slice(0, 120), msg });
    return {
      artist: null,
      title: null,
      album: null,
      genre: null,
      year: null,
      comment: null,
      durationSec: null,
    };
  }
}
