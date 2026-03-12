/** Format view count for display (e.g. 1.2M, 500K) */
export function formatViewCount(count: number): string {
  if (!Number.isFinite(count) || count < 0) return "";
  if (count >= 1_000_000_000) return `${(count / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(count);
}

/** Parse YouTube ISO 8601 duration (e.g. PT1H2M3S) to seconds */
export function parseIso8601Duration(iso: string): number {
  if (!iso || typeof iso !== "string") return 0;
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i);
  if (!match) return 0;
  const h = parseInt(match[1] ?? "0", 10);
  const m = parseInt(match[2] ?? "0", 10);
  const s = parseInt(match[3] ?? "0", 10);
  return h * 3600 + m * 60 + s;
}

/** Format duration in seconds to display (e.g. 3h 22m, 45m, 1m 30s) */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (sec > 0 || parts.length === 0) parts.push(`${sec}s`);
  // Omit trailing "0s" when we have hours or minutes for cleaner display (e.g. "3h 22m" not "3h 22m 0s")
  if (parts.length > 1 && parts[parts.length - 1] === "0s") parts.pop();
  return parts.join(" ");
}
