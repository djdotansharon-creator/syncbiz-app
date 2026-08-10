/**
 * Phase C — pure M3U/M3U8 tracklist reader (text → NormalizedTrack[]).
 *
 * This ONLY reads the playlist file's declared entries (#EXTINF title + the path/URL line).
 * It does NOT resolve local files against the desktop bank — that existing desktop-main flow
 * (import-local-m3u-playlist.ts) is untouched. Local paths are kept ONLY as an in-memory
 * `sourcePath` on the NormalizedTrack; the universal layer hashes them before persisting.
 */

import type { NormalizedTrack } from "@/lib/universal/universal-track";
import { splitArtists } from "@/lib/universal/normalize";

/** Split an "#EXTINF:duration,Artist - Title" display into artist + title. */
function parseExtinfTitle(display: string): { title: string; artist?: string } {
  const t = display.trim();
  const dash = t.match(/^(.*?)\s[-–—]\s(.*)$/);
  if (dash && dash[1].trim() && dash[2].trim()) {
    return { artist: dash[1].trim(), title: dash[2].trim() };
  }
  return { title: t };
}

/** Parse M3U/M3U8 text into normalized tracks (order preserved). */
export function parseM3uText(text: string): NormalizedTrack[] {
  const lines = (text ?? "").split(/\r?\n/);
  const out: NormalizedTrack[] = [];
  let pendingTitle: string | undefined;
  let pendingDurationSec: number | undefined;
  let pendingArtist: string | undefined;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("#EXTINF")) {
      const m = line.match(/^#EXTINF:\s*(-?\d+(?:\.\d+)?)?\s*,?(.*)$/i);
      const durSec = m?.[1] ? Number(m[1]) : undefined;
      pendingDurationSec = typeof durSec === "number" && Number.isFinite(durSec) && durSec > 0 ? durSec : undefined;
      const parsed = parseExtinfTitle(m?.[2] ?? "");
      pendingTitle = parsed.title || undefined;
      pendingArtist = parsed.artist;
      continue;
    }
    if (line.startsWith("#")) continue; // other directives (#EXTM3U, #PLAYLIST, …)

    // A content line (path or URL) → emit one track.
    const ref = line;
    const isUrl = /^https?:\/\//i.test(ref);
    const title = pendingTitle ?? filenameStem(ref);
    out.push({
      displayTitle: title,
      artists: pendingArtist
        ? splitArtists(pendingArtist).map((displayName, order) => ({ displayName, order, role: order === 0 ? "primary" : "featured" }))
        : [],
      durationMs: pendingDurationSec ? Math.round(pendingDurationSec * 1000) : undefined,
      providerRef: isUrl
        ? undefined
        : { provider: "local", externalId: ref }, // externalId holds the raw path; hashed later, never persisted raw
      raw: { ref, isUrl },
    });
    pendingTitle = undefined;
    pendingDurationSec = undefined;
    pendingArtist = undefined;
  }
  return out;
}

function filenameStem(p: string): string {
  const base = p.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? p;
  return base.replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[_]+/g, " ").trim() || base;
}
