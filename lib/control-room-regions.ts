/**
 * CONTROL ROOM — VONO OPERATIONAL REGIONS (owner decisions 2026-10-12). NOT an official government division.
 * The region of a branch is computed from its stored latitude / longitude only (never from the city name, which Google
 * can spell many ways), against real polygons (lib/control-room-regions-data.ts):
 *
 *  1. a municipal EXCEPTION polygon (OpenStreetMap): Rishon LeZion → Gush Dan; Kfar Saba / Ra'anana / Hod HaSharon →
 *     Sharon & Shomron; Modi'in-Maccabim-Re'ut → Jerusalem & Modi'in
 *  2. the operational region built from Israel's official sub-districts (geoBoundaries)
 *  3. a point on land in no sub-district:
 *     - within 0.4 km of a region edge (simplification slivers along shared borders) → that region
 *     - Judea & Samaria: north of SHOMRON_SPLIT_LAT (Ariel, Karnei Shomron, Kedumim, Shilo, northern Jordan Valley) →
 *       Sharon & Shomron; south of it (Givat Ze'ev, Ma'ale Adumim, Modi'in Illit, Gush Etzion, Kiryat Arba, …) → the
 *       nearer of Jerusalem & Modi'in / South
 *     - anything else on Israel's land (data edges) → the nearest region within 10 km
 *  4. off land (coast): the nearest region within 5 km
 *  5. otherwise → Outside Israel; no coordinates → no_location (shown and explained, never hidden)
 * A branch in Israel therefore always gets a region.
 */
import { REGIONS_DATA, REGION_OVERRIDES_DATA, type RegionData } from "./control-room-regions-data";
import { LAND_RINGS } from "./control-room-land";

export type RegionId = "north" | "haifa" | "sharon-shomron" | "gush-dan" | "shfela" | "jerusalem-modiin" | "south";
export const REGIONS: ReadonlyArray<RegionData & { id: RegionId }> = REGIONS_DATA as ReadonlyArray<RegionData & { id: RegionId }>;
export const REGION_OVERRIDES = REGION_OVERRIDES_DATA as ReadonlyArray<(typeof REGION_OVERRIDES_DATA)[number] & { region: RegionId }>;

/** Judea & Samaria split (latitude): north → Sharon & Shomron, south → Jerusalem & Modi'in / South */
export const SHOMRON_SPLIT_LAT = 31.98;
/** Judea & Samaria bounding box (where rule 3b applies) */
const JS_BOX = { minLng: 34.88, maxLng: 35.6, minLat: 31.34, maxLat: 32.57 };
const SNAP_SLIVER_KM = 0.4;
const SNAP_COAST_KM = 5;
const SNAP_LAND_EDGE_KM = 10;

type Pt = readonly [number, number];

function inRing(p: Pt, ring: ReadonlyArray<Pt>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segKm(p: Pt, a: Pt, b: Pt): number {
  const k = Math.cos((p[1] * Math.PI) / 180) * 111.32, ky = 110.57;
  const px = p[0] * k, py = p[1] * ky, ax = a[0] * k, ay = a[1] * ky, bx = b[0] * k, by = b[1] * ky;
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function nearest(p: Pt, only?: ReadonlyArray<RegionId>): { id: RegionId; km: number } | null {
  let best: { id: RegionId; km: number } | null = null;
  for (const r of REGIONS) {
    if (only && !only.includes(r.id)) continue;
    for (const ring of r.rings) for (let i = 1; i < ring.length; i++) {
      const km = segKm(p, ring[i - 1], ring[i]);
      if (!best || km < best.km) best = { id: r.id, km };
    }
  }
  return best;
}

export type RegionMatch = { regionId: RegionId; via: "exception" | "subdistrict" | "border" | "shomron-rule" | "judea-rule" | "nearest" | "coast" };

export function matchRegion(lng: number, lat: number): RegionMatch | null {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  const p: Pt = [lng, lat];
  for (const o of REGION_OVERRIDES) if (o.rings.some((ring) => inRing(p, ring))) return { regionId: o.region, via: "exception" };
  for (const r of REGIONS) if (r.rings.some((ring) => inRing(p, ring))) return { regionId: r.id, via: "subdistrict" };
  const near = nearest(p);
  const onLand = LAND_RINGS.some((ring) => inRing(p, ring));
  if (onLand) {
    if (near && near.km <= SNAP_SLIVER_KM) return { regionId: near.id, via: "border" };
    if (lng >= JS_BOX.minLng && lng <= JS_BOX.maxLng && lat >= JS_BOX.minLat && lat <= JS_BOX.maxLat) {
      if (lat >= SHOMRON_SPLIT_LAT) return { regionId: "sharon-shomron", via: "shomron-rule" };
      const js = nearest(p, ["jerusalem-modiin", "south"]);
      if (js) return { regionId: js.id, via: "judea-rule" };
    }
    return near && near.km <= SNAP_LAND_EDGE_KM ? { regionId: near.id, via: "nearest" } : null;
  }
  return near && near.km <= SNAP_COAST_KM ? { regionId: near.id, via: "coast" } : null;
}

export function regionForPoint(lng: number, lat: number): RegionId | null {
  return matchRegion(lng, lat)?.regionId ?? null;
}

export type BranchRegion = { regionId: RegionId | null; reason: "ok" | "no_location" | "outside" };
/** "outside" = Outside Israel (a branch in Israel always gets a region) */
export function branchRegion(latitude: number | null | undefined, longitude: number | null | undefined): BranchRegion {
  if (typeof latitude !== "number" || typeof longitude !== "number") return { regionId: null, reason: "no_location" };
  const id = regionForPoint(longitude, latitude);
  return id ? { regionId: id, reason: "ok" } : { regionId: null, reason: "outside" };
}

export function regionName(id: RegionId): string {
  return REGIONS.find((r) => r.id === id)?.name ?? id;
}

/** draw order (exceptions are drawn with their region, AFTER the region they cut into) */
export const REGION_DRAW_ORDER: ReadonlyArray<RegionId> = ["north", "haifa", "shfela", "south", "jerusalem-modiin", "gush-dan", "sharon-shomron"];
/** all polygons a region is drawn with: its sub-districts + its municipal exceptions */
export function regionDrawRings(id: RegionId): ReadonlyArray<ReadonlyArray<Pt>> {
  const r = REGIONS.find((x) => x.id === id);
  return [...(r?.rings ?? []), ...REGION_OVERRIDES.filter((o) => o.region === id).flatMap((o) => o.rings)];
}
