/** Compact published label for library cards: e.g. `NOV 2025`, `OCT 2020` */
export function formatPublishedMonthYearCompact(isoOrTimestamp: string | number): string {
  const ms = typeof isoOrTimestamp === "string" ? Date.parse(isoOrTimestamp) : isoOrTimestamp;
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  const mon = d
    .toLocaleDateString("en-US", { month: "short" })
    .replace(".", "")
    .toUpperCase();
  return `${mon} ${d.getFullYear()}`;
}

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

/** Compact clock for chips: M:SS or H:MM:SS */
export function formatDurationClock(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "";
  const s = Math.floor(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/**
 * SyncBiz editorial curation for library chips: maps typical 1–10 store to SYNC n/5; values 1–5 stay on /5 scale.
 */
export function formatSyncBizCurationChip(r: number | null | undefined): string {
  if (r == null || !Number.isFinite(r) || r <= 0) return "—";
  const x = Math.round(r);
  const outOf5 = x > 5 ? Math.max(1, Math.min(5, Math.round(x / 2))) : Math.max(1, Math.min(5, x));
  return `SYNC ${outOf5}/5`;
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
