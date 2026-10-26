/**
 * cleanSongTitle — the search lists show a song as a clean TITLE with the artist on the line below (owner 2026-10-18:
 * "fix the titles of every song in the search"). YouTube/library titles carry noise — "(Official Video)", "[HD]",
 * "(Prod. by …)", "קליפ רשמי", a repeated "Artist - " prefix — which is stripped for DISPLAY only (the stored title and the
 * playback title are untouched). "Artist - Song" → { artist, title }.
 */

const NOISE =
  /\b(official|video|audio|lyrics?|lyric\s*video|music\s*video|visuali[sz]er|clip|hd|hq|4k|1080p|720p|remaster(?:ed)?|prod\.?|produced)\b|קליפ|רשמי|הקליפ|מילים|פרוד|הפקה/i;

function stripNoise(s: string): string {
  // bracketed groups that are only noise: (Official Video) [HD] (Prod. by X) (קליפ רשמי)
  let out = s.replace(/\s*[([{]([^)\]}]*)[)\]}]/g, (m, inner: string) => (NOISE.test(inner) ? "" : m));
  // trailing " - Official Video" / " | Lyrics"
  out = out.replace(/\s+[-–—|]\s*(official\s+(music\s+)?(video|audio)|lyrics?(\s*video)?|audio|hd|4k)\s*$/i, "");
  // trailing " - Topic" auto-channel suffix
  out = out.replace(/\s+-\s+Topic\s*$/i, "");
  return out.replace(/\s{2,}/g, " ").trim();
}

export function cleanSongTitle(raw: string): { title: string; artist: string | null } {
  const base = String(raw ?? "").trim();
  if (!base) return { title: "", artist: null };
  const s = stripNoise(base);
  const m = s.match(/^(.{2,48}?)\s+[-–—|]\s+(.{2,})$/);
  if (m) {
    const artist = m[1]!.trim();
    const title = stripNoise(m[2]!.trim());
    if (title) return { title, artist };
  }
  return { title: s || base, artist: null };
}
