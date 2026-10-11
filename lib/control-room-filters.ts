/**
 * CONTROL ROOM — the list / map / counters filter (owner 2026-10-11): Brand → Search → Region, all together (none
 * replaces another). Pure, so the exact behaviour is unit-tested. Broadcast keeps the BRAND scope only (`brandRows`).
 */
import type { RegionId } from "./control-room-regions";

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

export function applyControlRoomFilters<T extends FilterableRow>(rows: T[], f: { brand: string; query: string; region: RegionId | null }) {
  const brandRows = f.brand === "all" ? rows : rows.filter((r) => r.brandId === f.brand);
  const query = f.query.trim();
  const searchRows = query ? brandRows.filter((r) => matchesBranchSearch(r, query)) : brandRows;
  const visibleRows = f.region ? searchRows.filter((r) => r.regionId === f.region) : searchRows;
  const regionCounts: Partial<Record<RegionId, number>> = {};
  for (const r of searchRows) if (r.regionId) regionCounts[r.regionId] = (regionCounts[r.regionId] ?? 0) + 1;
  return {
    brandRows,
    searchRows,
    visibleRows,
    regionCounts,
    noLocationCount: searchRows.filter((r) => r.regionReason === "no_location").length,
    outsideCount: searchRows.filter((r) => r.regionReason === "outside").length,
    filtersActive: f.brand !== "all" || !!query || !!f.region,
  };
}
