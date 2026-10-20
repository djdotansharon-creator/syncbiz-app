/**
 * CONTROL ROOM — the list / map / counters filter (owner 2026-10-11 / 2026-10-12): Brand → Search → Status → Region, all
 * together (none replaces another). Pure, so the exact behaviour is unit-tested. Broadcast keeps the BRAND scope only
 * (`brandRows`).
 */
import type { RegionId } from "./control-room-regions";

/**
 * A branch's operational status — ONE derived value, computed by the caller from live data (kept distinct on purpose):
 *  - "install": no station installed yet (from the DB)
 *  - "offline": a station exists but is not connected
 *  - "idle":    the station is connected, the player is not playing ("Online but not playing")
 *  - "playing": connected and playing
 *  - "unknown": live status not available yet
 * A future Dashboard "Needs attention" evaluator can read the same value (+ a since-timestamp) — nothing here assumes
 * a UI.
 */
export type BranchStatus = "playing" | "idle" | "offline" | "install" | "unknown";
/** the KPI / status filter: "online" = connected (playing or idle) */
export type StatusFilter = "all" | "playing" | "online" | "offline" | "install";
export const STATUS_FILTERS: ReadonlyArray<StatusFilter> = ["all", "playing", "online", "offline", "install"];

export function matchesStatus(s: BranchStatus, f: StatusFilter): boolean {
  if (f === "all") return true;
  if (f === "online") return s === "playing" || s === "idle";
  return s === f;
}

export type FilterableRow = {
  name: string;
  branchNumber: string | null;
  city: string;
  formattedAddress: string | null;
  brandId: string | null;
  regionId: RegionId | null;
  regionReason: "ok" | "no_location" | "outside";
};

/** search: branch name, number, city or address — case-insensitive, every word must match */
export function matchesBranchSearch(r: Pick<FilterableRow, "name" | "branchNumber" | "city" | "formattedAddress">, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [r.name, r.branchNumber ?? "", r.city, r.formattedAddress ?? ""].join(" ").toLowerCase();
  return q.split(/\s+/).every((t) => hay.includes(t));
}

export function applyControlRoomFilters<T extends FilterableRow>(
  rows: T[],
  f: { brand: string; query: string; region: RegionId | null; status?: StatusFilter; statusOf?: (r: T) => BranchStatus },
) {
  const status: StatusFilter = f.status && f.statusOf ? f.status : "all";
  const statusOf = f.statusOf ?? (() => "unknown" as BranchStatus);
  const brandRows = f.brand === "all" ? rows : rows.filter((r) => r.brandId === f.brand);
  const query = f.query.trim();
  const searchRows = query ? brandRows.filter((r) => matchesBranchSearch(r, query)) : brandRows;
  // the KPI counters: brand + search + region, NOT the status (so every KPI keeps its own number while one is chosen)
  const scopeRows = f.region ? searchRows.filter((r) => r.regionId === f.region) : searchRows;
  const statusCounts: Record<StatusFilter, number> = { all: scopeRows.length, playing: 0, online: 0, offline: 0, install: 0 };
  for (const r of scopeRows) { const s = statusOf(r); for (const k of STATUS_FILTERS) if (k !== "all" && matchesStatus(s, k)) statusCounts[k]++; }
  const statusRows = status === "all" ? searchRows : searchRows.filter((r) => matchesStatus(statusOf(r), status));
  const visibleRows = f.region ? statusRows.filter((r) => r.regionId === f.region) : statusRows;
  // region hover counts follow brand + search + status
  const regionCounts: Partial<Record<RegionId, number>> = {};
  for (const r of statusRows) if (r.regionId) regionCounts[r.regionId] = (regionCounts[r.regionId] ?? 0) + 1;
  return {
    brandRows,
    searchRows,
    visibleRows,
    regionCounts,
    statusCounts,
    noLocationCount: statusRows.filter((r) => r.regionReason === "no_location").length,
    outsideCount: statusRows.filter((r) => r.regionReason === "outside").length,
    filtersActive: f.brand !== "all" || !!query || !!f.region || status !== "all",
  };
}
