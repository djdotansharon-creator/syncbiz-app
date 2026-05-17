/**
 * Stage 6D-Lite — parse a pasted plain-text tracklist into resolver rows.
 *
 * Operator pastes lines like:
 *   1. Artist — Title
 *   02) Artist - Title
 *   Artist | Title
 *   Just a Title
 *
 * Each surviving line becomes one `M3uUnresolvedImportRow` that the existing
 * bulk YouTube resolver modal (in `create_youtube_only` mode) can search,
 * narrow, and pick a YouTube candidate for. No audio, no Spotify, no OAuth.
 *
 * Hard cap: `PASTED_TRACKLIST_MAX` rows. Excess lines are dropped and the
 * caller is told via `truncated: true` so it can show a warning.
 */

import type { M3uUnresolvedImportRow } from "@/lib/m3u-youtube-resolve-shared";

export const PASTED_TRACKLIST_MAX = 50;

export type ParsedTracklistRow = { artist: string; title: string };

export type ParsedTracklist = {
  rows: ParsedTracklistRow[];
  totalLines: number;
  truncated: boolean;
};

/**
 * Strip `1.` / `01.` / `1)` / `12)` prefixes (up to three digits). Defensive
 * upper bound — operators sometimes paste `100.` from large exports. Leaves
 * everything else (parentheticals, brackets, key tags) intact so the resolver
 * search query still resembles the original line.
 */
const LEADING_NUMBERING_RE = /^\s*\d{1,3}[.)]\s+/;

/**
 * Separator priority. Em-dash wins over en-dash wins over plain hyphen so a
 * line like `Foo — Bar - Baz` splits into `Foo` / `Bar - Baz` (artist holds
 * the em-dash boundary; the rest stays in the title). The hyphen variant is
 * intentionally `" - "` with surrounding spaces so timestamps like `1-2-3`
 * inside a title don't trigger a split.
 */
const SEPARATORS: readonly string[] = [" — ", " – ", " - ", " | ", " · ", "\t"];

function splitArtistTitle(line: string): ParsedTracklistRow {
  for (const sep of SEPARATORS) {
    const idx = line.indexOf(sep);
    if (idx > 0) {
      const artist = line.slice(0, idx).trim();
      const title = line.slice(idx + sep.length).trim();
      if (artist && title) return { artist, title };
    }
  }
  return { artist: "", title: line.trim() };
}

export function parsePastedTracklist(raw: string): ParsedTracklist {
  const text = (raw ?? "").replace(/\r\n?/g, "\n");
  const rawLines = text.split("\n");

  const cleaned: string[] = [];
  for (const lineRaw of rawLines) {
    const trimmed = lineRaw.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#")) continue;
    const stripped = trimmed.replace(LEADING_NUMBERING_RE, "").trim();
    if (!stripped) continue;
    cleaned.push(stripped);
  }

  const totalLines = cleaned.length;
  const truncated = totalLines > PASTED_TRACKLIST_MAX;
  const kept = truncated ? cleaned.slice(0, PASTED_TRACKLIST_MAX) : cleaned;

  const rows = kept.map((line) => splitArtistTitle(line));
  return { rows, totalLines, truncated };
}

export function pastedTracklistRowsToUnresolvedRows(
  rows: readonly ParsedTracklistRow[],
): M3uUnresolvedImportRow[] {
  return rows.map((row, idx) => {
    const artist = row.artist.trim();
    const title = row.title.trim();
    const display = artist ? `${artist} — ${title}` : title;
    const search = (artist ? `${artist} ${title}` : title).replace(/\s+/g, " ").trim();
    return {
      ref: display.slice(0, 256),
      reason: "pasted_tracklist",
      playlistOrder: idx,
      displayTitle: display || null,
      durationSec: null,
      suggestedSearchQuery: search,
    };
  });
}
