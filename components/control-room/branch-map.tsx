"use client";

import { useMemo } from "react";
import { LAND_RINGS } from "@/lib/control-room-land";
import { cityLngLat } from "@/lib/control-room-geo";

/**
 * CONTROL ROOM — the light network map (owner decision 2026-10-11): ONE small SVG, no tiles, no roads / POI / labels,
 * no zoom or pan controls, no network traffic, near-zero CPU / GPU. A dark land silhouette + one marker per branch at its
 * stored latitude / longitude (Google Places / geocoding = the source of truth), colored by live status, shown on the whole country (Control Room) or fitted to
 * the organization's branches; click → open the branch. Branches without coordinates fall back to their city (older
 * records) or are simply not drawn (they stay in the list).
 */

export type MapDotStatus = "playing" | "idle" | "offline" | "install" | "unknown";

export type MapBranch = { id: string; name: string; city: string; status: MapDotStatus; latitude?: number | null; longitude?: number | null };

export const DOT_FILL: Record<MapDotStatus, string> = {
  playing: "var(--sb-accent)",
  idle: "#34d399",
  offline: "rgba(255,255,255,0.35)",
  install: "#fbbf24",
  unknown: "rgba(255,255,255,0.2)",
};

const W = 520;
const H = 560;
const PAD = 36;
/** never zoom closer than ~40 km of latitude (a single branch / one city keeps its coastline context) */
const MIN_SPAN_LAT = 0.35;
/** the playing pulse is an SVG animation — only while few branches pulse at once (CPU guard for big networks) */
const MAX_PULSING = 30;

type LngLat = readonly [number, number];

function landBounds(): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of LAND_RINGS) for (const [x, y] of r) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  return [minX, minY, maxX, maxY];
}

/** Equirectangular projection (longitude scaled by cos(latitude)) fitted to [minLng, minLat, maxLng, maxLat]. */
function fitProjection(b: [number, number, number, number]) {
  let [minLng, minLat, maxLng, maxLat] = b;
  if (maxLat - minLat < MIN_SPAN_LAT) { const c = (minLat + maxLat) / 2; minLat = c - MIN_SPAN_LAT / 2; maxLat = c + MIN_SPAN_LAT / 2; }
  const kx = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const minSpanLng = MIN_SPAN_LAT / kx;
  if (maxLng - minLng < minSpanLng) { const c = (minLng + maxLng) / 2; minLng = c - minSpanLng / 2; maxLng = c + minSpanLng / 2; }
  const spanX = (maxLng - minLng) * kx;
  const spanY = maxLat - minLat;
  const scale = Math.min((W - 2 * PAD) / spanX, (H - 2 * PAD) / spanY);
  const offX = (W - spanX * scale) / 2;
  const offY = (H - spanY * scale) / 2;
  return ([lng, lat]: LngLat): [number, number] => [offX + (lng - minLng) * kx * scale, offY + (maxLat - lat) * scale];
}

export function BranchMap({
  branches,
  selectedId,
  onSelect,
  height,
  fit = "country",
}: {
  branches: MapBranch[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** CSS height of the map box (default: fills its column up to 560 px) */
  height?: number;
  /** "country" (Control Room, owner 2026-10-11): always the whole country, the zoom never depends on the branches; "branches": fit to the markers (Add / Edit preview) */
  fit?: "country" | "branches";
}) {
  const placed = useMemo(
    () =>
      branches
        .map((b) => {
          const at: LngLat | null = typeof b.latitude === "number" && typeof b.longitude === "number" ? [b.longitude, b.latitude] : cityLngLat(b.city);
          return at ? { ...b, at } : null;
        })
        .filter((d): d is MapBranch & { at: LngLat } => d !== null),
    [branches],
  );
  // "branches": re-fit only when WHERE the branches are changes (live status updates never move the map)
  const fitKey = placed.map((d) => `${d.at[0].toFixed(4)},${d.at[1].toFixed(4)}`).sort().join("|");
  const project = useMemo(() => {
    if (fit === "country" || !placed.length) return fitProjection(landBounds());
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const d of placed) { minX = Math.min(minX, d.at[0]); maxX = Math.max(maxX, d.at[0]); minY = Math.min(minY, d.at[1]); maxY = Math.max(maxY, d.at[1]); }
    return fitProjection([minX, minY, maxX, maxY]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fitKey captures the positions
  }, [fit, fitKey]);
  const land = useMemo(
    () => LAND_RINGS.map((r) => r.map((p, i) => `${i ? "L" : "M"}${project(p).map((v) => v.toFixed(1)).join(",")}`).join("") + "Z").join(""),
    [project],
  );
  const pulsing = placed.filter((d) => d.status === "playing").length <= MAX_PULSING;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full overflow-hidden"
      style={{ height: height ?? "100%", maxHeight: height ?? 560 }}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Branch map"
    >
      {/* land: one OPAQUE neutral silhouette, no stroke — overlapping rings never show internal borders */}
      <path d={land} fill="#1b1b1f" />
      {placed.map((d) => {
        const [x, y] = project(d.at);
        const selected = d.id === selectedId;
        return (
          <g key={d.id} className="cursor-pointer" onClick={() => onSelect(d.id)}>
            <title>{d.name}</title>
            {selected ? <circle cx={x} cy={y} r={10} fill="none" stroke="#fff" strokeWidth={1.5} /> : null}
            {d.status === "playing" && pulsing ? (
              <circle cx={x} cy={y} r={5} fill={DOT_FILL.playing} opacity={0.35}>
                <animate attributeName="r" values="5;12;5" dur="2.4s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.35;0;0.35" dur="2.4s" repeatCount="indefinite" />
              </circle>
            ) : null}
            <circle cx={x} cy={y} r={5.5} fill={DOT_FILL[d.status]} stroke="rgba(10,10,12,0.9)" strokeWidth={1.5} />
          </g>
        );
      })}
    </svg>
  );
}
