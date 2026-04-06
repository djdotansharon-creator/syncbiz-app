import type { Playlist } from "@/lib/playlist-types";
import { resolveMediaBranchId } from "@/lib/media-scope-helpers";
import type { Source } from "@/lib/types";

export type ScheduleTargetRadio = { id: string; name: string; branchId?: string | null };

export function scheduleTargetKey(tt: string, id: string): string {
  return `${tt}:${id}`;
}

export function parseScheduleTargetKey(
  raw: string,
): { targetType: "SOURCE" | "PLAYLIST" | "RADIO"; targetId: string } | null {
  const [tt, ...rest] = raw.split(":");
  const id = rest.join(":");
  if (!id) return null;
  if (tt === "SOURCE" || tt === "PLAYLIST" || tt === "RADIO") return { targetType: tt, targetId: id };
  return null;
}

/** HTML time → HH:mm:ss for API and storage */
export function normalizeScheduleTimeLocal(raw: string): string {
  let s = raw.trim();
  if (!s) return "09:00:00";
  const dot = s.indexOf(".");
  if (dot >= 0) s = s.slice(0, dot);
  const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return s.length >= 5 ? s.slice(0, 8) : "09:00:00";
  const h = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const min = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  const sec = m[3] != null ? Math.min(59, Math.max(0, parseInt(m[3], 10))) : 0;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/**
 * Value for `<input type="time" step={1}>` — always 24h `HH:MM:SS` so Chrome/Edge apply predictably.
 */
export function scheduleTimeToHtmlInputValue(raw: string | undefined, fallback = "09:00:00"): string {
  return normalizeScheduleTimeLocal((raw ?? "").trim() || fallback);
}

export function resolveScheduleTargetBranchId(
  parsed: { targetType: "SOURCE" | "PLAYLIST" | "RADIO"; targetId: string },
  sources: Source[],
  playlists: Playlist[],
  radios: ScheduleTargetRadio[],
): string {
  if (parsed.targetType === "SOURCE") {
    const src = sources.find((x) => x.id === parsed.targetId);
    return (src?.branchId ?? "default").trim() || "default";
  }
  if (parsed.targetType === "PLAYLIST") {
    const p = playlists.find((x) => x.id === parsed.targetId);
    return resolveMediaBranchId(p ?? {});
  }
  if (parsed.targetType === "RADIO") {
    const r = radios.find((x) => x.id === parsed.targetId);
    return resolveMediaBranchId(r ?? {});
  }
  return "default";
}
