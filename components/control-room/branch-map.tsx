"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LAND_RINGS } from "@/lib/control-room-land";
import { REGIONS, type RegionId } from "@/lib/control-room-regions";
import { cityLngLat } from "@/lib/control-room-geo";

/**
 * CONTROL ROOM — the light network map (owner decision 2026-10-11): ONE small SVG, no tiles, no roads / POI / labels,
 * no zoom or pan controls, no network traffic, near-zero CPU / GPU. A dark land silhouette + one marker per branch at its
 * stored latitude / longitude (Google Places / geocoding = the source of truth), colored by live status, shown on the whole country (Control Room) or fitted to
 * the organization's branches; click → open the branch. Branches without coordinates fall back to their city (older
 * records) or are simply not drawn (they stay in the list).
 */

export type MapDotStatus = "playing" | "idle" | "offline" | "install" | "unknown";

export type MapBranch = {
  id: string; name: string; city: string; status: MapDotStatus; latitude?: number | null; longitude?: number | null;
  /** brand color (#rrggbb): the marker CENTER shows the brand, a RING around it shows the status. Absent → status-only dot. */
  brandColor?: string | null;
};

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

/** Region layer (Control Room only): Israel's six districts as VONO operational regions — hover lifts a region, click focuses it. */
export type MapRegions = {
  /** branches per region under the current brand / search filters (hover label) */
  counts: Partial<Record<RegionId, number>>;
  /** the focused region (the map zooms into it) or null = All Israel */
  focus: RegionId | null;
  onFocus: (id: RegionId) => void;
};

type ViewBox = { x: number; y: number; w: number; h: number };
const FULL_VIEW: ViewBox = { x: 0, y: 0, w: W, h: H };
const ZOOM_MS = 520;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Area centroid of a projected ring (label anchor that stays inside ordinary shapes). */
function centroid(pts: [number, number][]): [number, number] {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const f = pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
    a += f; cx += (pts[j][0] + pts[i][0]) * f; cy += (pts[j][1] + pts[i][1]) * f;
  }
  return a ? [cx / (3 * a), cy / (3 * a)] : pts[0];
}

export function BranchMap({
  branches,
  selectedId,
  onSelect,
  height,
  fit = "country",
  regions,
}: {
  branches: MapBranch[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** CSS height of the map box (default: fills its column up to 560 px) */
  height?: number;
  /** "country" (Control Room, owner 2026-10-11): always the whole country, the zoom never depends on the branches; "branches": fit to the markers (Add / Edit preview) */
  fit?: "country" | "branches";
  /** Control Room: the region layer (absent → the plain map, e.g. the Add / Edit preview) */
  regions?: MapRegions;
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

  // region shapes in the SAME projection as the land (static: built once per projection)
  const regionShapes = useMemo(() => {
    if (!regions) return [];
    return REGIONS.map((r) => {
      const rings = r.rings.map((ring) => ring.map((pt) => project(pt)));
      const d = rings.map((ring) => ring.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("") + "Z").join("");
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const ring of rings) for (const [x, y] of ring) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
      const main = rings.reduce((a, b) => (b.length > a.length ? b : a), rings[0]);
      return { id: r.id as RegionId, name: r.name, d, bbox: { minX, minY, maxX, maxY }, label: centroid(main) };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- shapes depend only on the projection
  }, [project, !!regions]);

  // focused region → animated zoom (viewBox interpolation; markers keep their on-screen size)
  const focus = regions?.focus ?? null;
  const target = useMemo<ViewBox>(() => {
    const sh = focus ? regionShapes.find((r) => r.id === focus) : null;
    if (!sh) return FULL_VIEW;
    const pad = 28;
    let w = sh.bbox.maxX - sh.bbox.minX + 2 * pad, h = sh.bbox.maxY - sh.bbox.minY + 2 * pad;
    if (w / h > W / H) h = (w * H) / W; else w = (h * W) / H; // keep the map's aspect ratio
    const cx = (sh.bbox.minX + sh.bbox.maxX) / 2, cy = (sh.bbox.minY + sh.bbox.maxY) / 2;
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  }, [focus, regionShapes]);
  const [view, setView] = useState<ViewBox>(target);
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    const from = viewRef.current;
    if (from.x === target.x && from.y === target.y && from.w === target.w) return;
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { setView(target); return; }
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / ZOOM_MS), e = ease(t);
      setView({ x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e, w: from.w + (target.w - from.w) * e, h: from.h + (target.h - from.h) * e });
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  const k = W / view.w; // zoom factor: divide sizes by k so markers / strokes keep their on-screen size

  const [hover, setHover] = useState<RegionId | null>(null);
  const hovered = !focus && hover ? regionShapes.find((r) => r.id === hover) ?? null : null;

  return (
    <svg
      viewBox={`${view.x.toFixed(2)} ${view.y.toFixed(2)} ${view.w.toFixed(2)} ${view.h.toFixed(2)}`}
      className="w-full overflow-hidden"
      style={{ height: height ?? "100%", maxHeight: height ?? 560 }}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Branch map"
      onMouseLeave={() => setHover(null)}
    >
      {regions ? (
        <defs>
          <filter id="vono-region-lift" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy={3 / k} stdDeviation={5 / k} floodColor="#000" floodOpacity="0.65" />
          </filter>
        </defs>
      ) : null}
      {/* land: one OPAQUE neutral silhouette, no stroke — overlapping rings never show internal borders */}
      <path d={land} fill="#1b1b1f" />
      {regionShapes.map((r) => {
        const isFocus = r.id === focus;
        const dim = !!focus && !isFocus;
        const count = regions?.counts[r.id] ?? 0;
        return (
          <path
            key={r.id}
            d={r.d}
            fill={isFocus ? "rgba(255,255,255,0.045)" : dim ? "rgba(0,0,0,0.25)" : "rgba(255,255,255,0.018)"}
            stroke={isFocus ? "rgba(255,255,255,0.42)" : dim ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.24)"}
            strokeWidth={(isFocus ? 1.4 : 1) / k}
            strokeLinejoin="round"
            className={focus ? undefined : "cursor-pointer"}
            style={{ pointerEvents: focus ? "none" : "auto", transition: "fill 160ms ease", outline: "none" }}
            role={focus ? undefined : "button"}
            tabIndex={focus ? -1 : 0}
            aria-label={focus ? undefined : `${r.name}, ${count} branch${count === 1 ? "" : "es"}`}
            onMouseEnter={() => setHover(r.id)}
            onFocus={() => setHover(r.id)}
            onBlur={() => setHover(null)}
            onClick={(e) => { (e.currentTarget as SVGPathElement).blur(); regions?.onFocus(r.id); }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); regions?.onFocus(r.id); } }}
          />
        );
      })}
      {/* hovered region lifted above the others: a gentle raise + shadow (All Israel only) */}
      {hovered ? (
        <path
          d={hovered.d}
          fill="rgba(255,255,255,0.075)"
          stroke="rgba(255,255,255,0.55)"
          strokeWidth={1.2 / k}
          strokeLinejoin="round"
          filter="url(#vono-region-lift)"
          style={{ transform: `translateY(${-3 / k}px)`, pointerEvents: "none", animation: "vono-region-rise 170ms ease-out" }}
        />
      ) : null}
      {placed.map((d) => {
        const [x, y] = project(d.at);
        const selected = d.id === selectedId;
        const s = 1 / k;
        return (
          <g key={d.id} className="cursor-pointer" onClick={(e) => { e.stopPropagation(); onSelect(d.id); }}>
            <title>{d.name}</title>
            {selected ? <circle cx={x} cy={y} r={(d.brandColor ? 12 : 10) * s} fill="none" stroke="#fff" strokeWidth={1.5 * s} /> : null}
            {d.status === "playing" && pulsing ? (
              <circle cx={x} cy={y} r={5 * s} fill={DOT_FILL.playing} opacity={0.35}>
                <animate attributeName="r" values={`${5 * s};${12 * s};${5 * s}`} dur="2.4s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.35;0;0.35" dur="2.4s" repeatCount="indefinite" />
              </circle>
            ) : null}
            {d.brandColor ? (
              <>
                <circle cx={x} cy={y} r={7.5 * s} fill="rgba(10,10,12,0.9)" stroke={DOT_FILL[d.status]} strokeWidth={2.4 * s} />
                <circle cx={x} cy={y} r={4.6 * s} fill={d.brandColor} />
              </>
            ) : (
              <circle cx={x} cy={y} r={5.5 * s} fill={DOT_FILL[d.status]} stroke="rgba(10,10,12,0.9)" strokeWidth={1.5 * s} />
            )}
          </g>
        );
      })}
      {hovered ? (
        <g style={{ pointerEvents: "none" }}>
          <text
            x={hovered.label[0]}
            y={hovered.label[1]}
            textAnchor="middle"
            fontSize={13 / k}
            fontWeight={600}
            fill="#f5f5f7"
            stroke="rgba(10,10,12,0.85)"
            strokeWidth={3 / k}
            paintOrder="stroke"
          >
            {hovered.name}
          </text>
          <text
            x={hovered.label[0]}
            y={hovered.label[1] + 16 / k}
            textAnchor="middle"
            fontSize={11 / k}
            fill="#a1a1a6"
            stroke="rgba(10,10,12,0.85)"
            strokeWidth={3 / k}
            paintOrder="stroke"
          >
            {`${regions?.counts[hovered.id] ?? 0} branch${(regions?.counts[hovered.id] ?? 0) === 1 ? "" : "es"}`}
          </text>
        </g>
      ) : null}
    </svg>
  );
}
