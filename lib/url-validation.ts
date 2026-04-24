/** Check if a string is a valid stream/radio URL. */
export function isValidStreamUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== "string") return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  try {
    const u = new URL(trimmed);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Check if a string is a valid playback URL (http/https or youtu.be). */
export function isValidPlaybackUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== "string") return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  try {
    const u = new URL(trimmed);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * True for absolute paths/URIs the desktop MPV path can load (not sent as http).
 * Windows drive, UNC, optional file://, or Unix absolute — matches mpv-input-normalize heuristics.
 */
export function isValidLocalFilePlaybackPath(url: string | null | undefined): boolean {
  if (!url || typeof url !== "string") return false;
  const t = url.trim();
  if (!t || t.startsWith("local://")) return false;
  if (t.toLowerCase().startsWith("file:")) {
    try {
      return new URL(t).protocol === "file:";
    } catch {
      return false;
    }
  }
  if (/^[a-zA-Z]:[\\/]/.test(t) || t.startsWith("\\\\")) return true;
  if (t.length > 1 && t.startsWith("/") && !t.startsWith("//")) return true;
  return false;
}
