/**
 * CONTROL ROOM — automatic region of a branch from its stored latitude / longitude (owner 2026-10-11; no DB, no manual
 * field). Regions = Israel's six administrative districts (real boundaries, lib/control-room-regions-data.ts) used as VONO
 * operational regions. A branch added through Google Location gets its region automatically from its coordinates.
 *
 *  - inside a district polygon → that region
 *  - a COASTAL point just outside the ~120 m-simplified outline (off the land silhouette, ≤ 5 km from the nearest
 *    district edge) → the nearest district (simplification tolerance only — never a guessed region far away). A point ON
 *    land that is in no district (Judea & Samaria, e.g. Modiin Illit ~2 km past the Green Line) only snaps within 0.4 km
 *    (the slivers simplification leaves along shared district borders) — never into a district from outside it.
 *  - anything else (Judea & Samaria, abroad) → null ("Outside regions")
 *  - no coordinates → null with reason "no_location" (the UI says so; the branch never disappears)
 */
import { REGIONS_DATA, type RegionData } from "./control-room-regions-data";
import { LAND_RINGS } from "./control-room-land";

export type RegionId = "north" | "haifa" | "tel-aviv" | "center" | "jerusalem" | "south";
export const REGIONS: ReadonlyArray<RegionData & { id: RegionId }> = REGIONS_DATA as ReadonlyArray<RegionData & { id: RegionId }>;
/** max distance from a district edge for the COASTAL fallback (point off the land silhouette) */
export const REGION_SNAP_KM = 5;
/** on land, only the simplification slivers along shared district borders (~120 m tolerance) are snapped */
export const REGION_SNAP_ON_LAND_KM = 0.4;

type Pt = readonly [number, number];

function inRing(p: Pt, ring: ReadonlyArray<Pt>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** distance in km from a point to a segment (local equirectangular — fine at this scale) */
function segKm(p: Pt, a: Pt, b: Pt): number {
  const k = Math.cos((p[1] * Math.PI) / 180) * 111.32, ky = 110.57;
  const px = p[0] * k, py = p[1] * ky, ax = a[0] * k, ay = a[1] * ky, bx = b[0] * k, by = b[1] * ky;
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function regionForPoint(lng: number, lat: number): RegionId | null {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  const p: Pt = [lng, lat];
  for (const r of REGIONS) if (r.rings.some((ring) => inRing(p, ring))) return r.id;
  const onLand = LAND_RINGS.some((ring) => inRing(p, ring)); // on land but in no district = Outside regions (except slivers)
  let best: { id: RegionId; km: number } | null = null;
  for (const r of REGIONS) for (const ring of r.rings) for (let i = 1; i < ring.length; i++) {
    const km = segKm(p, ring[i - 1], ring[i]);
    if (!best || km < best.km) best = { id: r.id, km };
  }
  return best && best.km <= (onLand ? REGION_SNAP_ON_LAND_KM : REGION_SNAP_KM) ? best.id : null;
}

export type BranchRegion = { regionId: RegionId | null; reason: "ok" | "no_location" | "outside" };
export function branchRegion(latitude: number | null | undefined, longitude: number | null | undefined): BranchRegion {
  if (typeof latitude !== "number" || typeof longitude !== "number") return { regionId: null, reason: "no_location" };
  const id = regionForPoint(longitude, latitude);
  return id ? { regionId: id, reason: "ok" } : { regionId: null, reason: "outside" };
}

export function regionName(id: RegionId): string {
  return REGIONS.find((r) => r.id === id)?.name ?? id;
}
