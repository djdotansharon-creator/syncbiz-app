/**
 * Read common audio tags in the Electron main process (music-metadata, no upload).
 */

import { parseFile } from "music-metadata";
import type { InspectLocalAudioTagsRawPayload, LocalAudioTagFields } from "../shared/mvp-types";

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

function pickBpm(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 0 && v < 1000) {
    return Math.round(v * 10) / 10;
  }
  if (typeof v === "string") {
    const n = Number(v.trim());
    if (Number.isFinite(n) && n > 0 && n < 1000) return Math.round(n * 10) / 10;
  }
  return null;
}

/**
 * music-metadata returns `common.rating` as `{ source?, rating }[]` with each `rating` in 0–1.
 * Average across sources, then rescale to a 0–5 stars value.
 */
function pickRating(v: unknown): number | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  const norms: number[] = [];
  for (const entry of v) {
    if (entry && typeof entry === "object" && "rating" in entry) {
      const r = (entry as { rating: unknown }).rating;
      if (typeof r === "number" && Number.isFinite(r) && r >= 0 && r <= 1) norms.push(r);
    }
  }
  if (norms.length === 0) return null;
  const avg = norms.reduce((a, b) => a + b, 0) / norms.length;
  return Math.round(avg * 5 * 10) / 10;
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
      bpm: null,
      rating: null,
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
      bpm: pickBpm((c as { bpm?: unknown }).bpm),
      rating: pickRating((c as { rating?: unknown }).rating),
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
      bpm: null,
      rating: null,
    };
  }
}

/**
 * Dev inspector: returns raw `common.*` values used by the parser, and logs once
 * to the main console. Triggered on demand from the renderer ("i" button) — not
 * on every tag read — so this stays quiet under normal use.
 */
export async function inspectLocalAudioTagsRaw(absolutePath: string): Promise<InspectLocalAudioTagsRawPayload> {
  const p = (absolutePath ?? "").trim();
  if (!p) {
    return {
      filePath: "",
      artist: null,
      artists: null,
      title: null,
      genre: null,
      year: null,
      date: null,
      titleFallbackUsed: true,
    };
  }
  try {
    const meta = await parseFile(p, { duration: false, skipCovers: true });
    const c = meta.common as {
      artist?: unknown;
      artists?: unknown;
      title?: unknown;
      genre?: unknown;
      year?: unknown;
      date?: unknown;
    };
    const artist = typeof c.artist === "string" ? c.artist : null;
    const artists = Array.isArray(c.artists)
      ? c.artists.map((x) => String(x)).filter((s) => s.length > 0)
      : null;
    const title = typeof c.title === "string" ? c.title : null;
    const genre = Array.isArray(c.genre)
      ? c.genre.map((x) => String(x)).filter((s) => s.length > 0)
      : typeof c.genre === "string"
        ? c.genre
        : null;
    const year = typeof c.year === "number" && Number.isFinite(c.year) ? c.year : null;
    const date = typeof c.date === "string" ? c.date : null;
    const titleFallbackUsed = !(typeof title === "string" && title.trim().length > 0);
    const payload: InspectLocalAudioTagsRawPayload = {
      filePath: p,
      artist,
      artists: artists && artists.length > 0 ? artists : null,
      title,
      genre,
      year,
      date,
      titleFallbackUsed,
    };
    console.log(LOG, "inspect raw", payload);
    return payload;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(LOG, "inspect failed", { path: p.slice(0, 120), msg });
    return {
      filePath: p,
      artist: null,
      artists: null,
      title: null,
      genre: null,
      year: null,
      date: null,
      titleFallbackUsed: true,
    };
  }
}
