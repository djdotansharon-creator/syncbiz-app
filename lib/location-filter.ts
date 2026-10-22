/**
 * CONTROL ROOM F3a — the ONE shared operational filter resolver (PURE, OFFLINE in F3a — no runtime importer yet).
 *
 * Filter expression = { brandIds, regionIds, groupIds, tagIds, locationIds, zoneIds, zoneTypes } (each optional).
 * Within a dimension values are OR-ed; different dimensions are AND-ed; an array of expressions is a UNION; an empty
 * expression means "all active". The same location matcher (`matchLocation`) is used by the MemberScope evaluator
 * (lib/authz-scope.ts) for BRAND / LOCATION / REGION / GROUP, so a filter and a permission scope can never mean different
 * things — EXCEPT tags: a Tag is an operational annotation only (owner-locked 2026-10-07). The scope evaluator never
 * passes tagIds, so a Tag can never grant or restrict access.
 *
 * Archived Regions / Groups / Tags never match; a Location without a Region never matches a Region constraint;
 * a NULL Branch.brandId is the workspace default Brand (F1 compatibility); archived Locations / Zones are excluded.
 */
import type { HierarchyIndex } from "@/lib/authz-scope";

export type LocationCriteria = {
  brandIds?: readonly string[];
  regionIds?: readonly string[];
  groupIds?: readonly string[];
  /** Operational filtering ONLY — never supplied by the permission evaluator. */
  tagIds?: readonly string[];
  locationIds?: readonly string[];
};

export type FilterExpression = LocationCriteria & {
  zoneIds?: readonly string[];
  zoneTypes?: readonly string[];
};

const ARCHIVED = "archived";
const has = (a: readonly string[] | undefined): a is readonly string[] => Array.isArray(a) && a.length > 0;

function activeIds(rows: { id: string; status: string }[] | undefined): Set<string> {
  return new Set((rows ?? []).filter((r) => r.status !== ARCHIVED).map((r) => r.id));
}

/** PURE: does Location `locId` satisfy every PRESENT location-level dimension? */
export function matchLocation(c: LocationCriteria, h: HierarchyIndex, locId: string): boolean {
  const loc = h.locations.find((l) => l.id === locId);
  if (!loc || loc.status === ARCHIVED) return false;
  if (has(c.locationIds) && !c.locationIds.includes(loc.id)) return false;
  if (has(c.brandIds) && !c.brandIds.includes(loc.brandId ?? h.defaultBrandId ?? "")) return false;
  if (has(c.regionIds)) {
    const live = activeIds(h.regions);
    if (!loc.regionId || !live.has(loc.regionId) || !c.regionIds.includes(loc.regionId)) return false;
  }
  if (has(c.groupIds)) {
    const live = activeIds(h.groups);
    if (!(loc.groupIds ?? []).some((g) => live.has(g) && c.groupIds!.includes(g))) return false;
  }
  if (has(c.tagIds)) {
    const live = activeIds(h.tags);
    if (!(loc.tagIds ?? []).some((t) => live.has(t) && c.tagIds!.includes(t))) return false;
  }
  return true;
}

/** PURE: does zone `zoneId` satisfy the zone-level dimensions (zoneIds / zoneTypes)? */
export function matchZone(e: { zoneIds?: readonly string[]; zoneTypes?: readonly string[] }, h: HierarchyIndex, zoneId: string): boolean {
  const z = h.zones.find((x) => x.id === zoneId);
  if (!z || z.status === ARCHIVED) return false;
  if (has(e.zoneIds) && !e.zoneIds.includes(z.id)) return false;
  if (has(e.zoneTypes) && !e.zoneTypes.includes(z.zoneTypeCode)) return false;
  return true;
}

/**
 * PURE: resolve filter expression(s) to concrete Locations and Zones (sorted, de-duplicated).
 * A Location is included when it matches the location dimensions AND (no zone dimension OR ≥ 1 of its zones matches);
 * zones are the matching active zones of included Locations.
 */
export function resolveFilter(expressions: FilterExpression | FilterExpression[], h: HierarchyIndex): { locationIds: string[]; zoneIds: string[] } {
  const list = Array.isArray(expressions) ? (expressions.length ? expressions : [{}]) : [expressions];
  const locs = new Set<string>();
  const zones = new Set<string>();
  for (const e of list) {
    const zoneLimited = has(e.zoneIds) || has(e.zoneTypes);
    for (const l of h.locations) {
      if (!matchLocation(e, h, l.id)) continue;
      const zs = h.zones.filter((z) => z.branchId === l.id && matchZone(e, h, z.id)).map((z) => z.id);
      if (zoneLimited && zs.length === 0) continue;
      locs.add(l.id);
      for (const z of zs) zones.add(z);
    }
  }
  return { locationIds: [...locs].sort(), zoneIds: [...zones].sort() };
}
