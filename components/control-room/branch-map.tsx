"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LAND_RINGS } from "@/lib/control-room-land";
import { REGION_DRAW_ORDER, regionDrawRings, regionForPoint, type RegionId } from "@/lib/control-room-regions";
import { cityLngLat } from "@/lib/control-room-geo";
import { useMgmt } from "@/lib/i18n/use-mgmt";
import type { MgmtKey } from "@/lib/i18n/management";

/**
 * CONTROL ROOM — the light network map (owner decision 2026-10-11): ONE small SVG, no tiles, no roads / POI / labels,
 * no network traffic, near-zero CPU / GPU. Control Room only: + / − / Fit, Ctrl/Cmd + scroll zoom, drag to pan while zoomed. A dark land silhouette + one marker per branch at its
 * stored latitude / longitude (Google Places / geocoding = the source of truth), colored by live status, shown on the whole country (Control Room) or fitted to
 * the organization's branches; click → open the branch. Branches without coordinates fall back to their city (older
 * records) or are simply not drawn (they stay in the list).
 */

export type MapDotStatus = "playing" | "idle" | "offline" | "install" | "unknown";

export type MapBranch = {
  id: string; name: string; city: string; status: MapDotStatus; latitude?: number | null; longitude?: number | null;
  /** brand color (#rrggbb): the marker IS the brand color; the status changes its brightness / motion (see MARKER). */
  brandColor?: string | null;
};

export const DOT_FILL: Record<MapDotStatus, string> = {
  playing: "var(--sb-accent)",
  idle: "#34d399",
  offline: "rgba(255,255,255,0.35)",
  install: "#fbbf24",
  unknown: "rgba(255,255,255,0.2)",
};

/**
 * MARKER (owner decision 2026-10-12, final): ONE clean circle per branch — no rings, no badges (300+ branches).
 *  - Online:  the brand color, clear
 *  - Playing: like Online + a slow, gentle breathing (CSS, off for reduced motion) — never a blink, never a ring
 *  - Offline: the brand color, dark / muted
 *  - Needs installation: amber
 * Without brands the marker uses one neutral light color with the same rules.
 */
export const INSTALL_COLOR = "#fbbf24";
export const NEUTRAL_MARKER = "#e5e5ea";
export const STATUS_KEY: Record<MapDotStatus, MgmtKey> = { playing: "status.playing", idle: "status.idle", offline: "status.offline", install: "status.install", unknown: "status.unknown" };
export function markerLook(status: MapDotStatus, brandColor?: string | null): { fill: string; opacity: number; breathing: boolean } {
  if (status === "install") return { fill: INSTALL_COLOR, opacity: 1, breathing: false };
  const fill = brandColor || NEUTRAL_MARKER;
  if (status === "offline") return { fill, opacity: 0.3, breathing: false };
  if (status === "unknown") return { fill, opacity: 0.55, breathing: false };
  return { fill, opacity: 1, breathing: status === "playing" };
}

/** the status mark in the list / legend / KPIs — the same single-circle language as the map (neutral color) */
export function StatusGlyph({ status, size = 12, color }: { status: MapDotStatus; size?: number; color?: string | null }) {
  const m = markerLook(status, color);
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" className="shrink-0 overflow-visible" aria-hidden>
      <circle cx="6" cy="6" r="4.4" fill={m.fill} fillOpacity={m.opacity} className={m.breathing ? "vono-breathe" : undefined} />
    </svg>
  );
}

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
/** manual zoom: closest = 1/14 of the full map; each + / − step = ×1.6 */
const MIN_VIEW_W = W / 14;
const ZOOM_STEP = 1.6;
/** keep the centre of a manual view over the map */
function clampView(v: ViewBox): ViewBox {
  const cx = Math.max(0, Math.min(W, v.x + v.w / 2)), cy = Math.max(0, Math.min(H, v.y + v.h / 2));
  return { x: cx - v.w / 2, y: cy - v.h / 2, w: v.w, h: v.h };
}
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
  height?: number | string;
  /** "country" (Control Room, owner 2026-10-11): always the whole country, the zoom never depends on the branches; "branches": fit to the markers (Add / Edit preview) */
  fit?: "country" | "branches";
  /** Control Room: the region layer (absent → the plain map, e.g. the Add / Edit preview) */
  regions?: MapRegions;
}) {
  const L = useMgmt();
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
    // operational regions: their sub-districts + municipal exceptions, in draw order (an exception is drawn with its
    // region, after the region it cuts into)
    return REGION_DRAW_ORDER.map((id) => {
      const rings = regionDrawRings(id).map((ring) => ring.map((pt) => project(pt)));
      const d = rings.map((ring) => ring.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("") + "Z").join("");
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const ring of rings) for (const [x, y] of ring) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
      const area = (ring: [number, number][]) => { let a = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]; return Math.abs(a); };
      const main = rings.reduce((a, b) => (area(b) > area(a) ? b : a), rings[0]);
      return { id, d, bbox: { minX, minY, maxX, maxY }, label: centroid(main) };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- shapes depend only on the projection
  }, [project, !!regions]);

  // focused region → animated zoom (viewBox interpolation; markers keep their on-screen size)
  const focus = regions?.focus ?? null;
  const target = useMemo<ViewBox>(() => {
    const sh = focus ? regionShapes.find((r) => r.id === focus) : null;
    if (!sh) return FULL_VIEW;
    const b = { ...sh.bbox };
    for (const d of placed) { if (regionForPoint(d.at[0], d.at[1]) !== focus) continue; const [x, y] = project(d.at); b.minX = Math.min(b.minX, x); b.maxX = Math.max(b.maxX, x); b.minY = Math.min(b.minY, y); b.maxY = Math.max(b.maxY, y); }
    const pad = 28;
    let w = b.maxX - b.minX + 2 * pad, h = b.maxY - b.minY + 2 * pad;
    if (w / h > W / H) h = (w * H) / W; else w = (h * W) / H; // keep the map's aspect ratio
    const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
    return { x: cx - w / 2, y: cy - h / 2, w, h };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fitKey captures where the branches are
  }, [focus, regionShapes, fitKey]);
  // manual zoom / pan on top of the target (whole country / focused region); a new focus drops the manual view
  const [manual, setManual] = useState<{ focus: RegionId | null; vb: ViewBox; instant: boolean } | null>(null);
  const goal = manual && manual.focus === focus ? manual.vb : target;
  const instant = !!manual && manual.focus === focus && manual.instant;
  const [view, setView] = useState<ViewBox>(target);
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    const from = viewRef.current;
    if (from.x === goal.x && from.y === goal.y && from.w === goal.w) return;
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce || instant) { setView(goal); return; }
    const target = goal;
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / ZOOM_MS), e = ease(t);
      setView({ x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e, w: from.w + (target.w - from.w) * e, h: from.h + (target.h - from.h) * e });
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [goal, instant]);

  /** zoom by `factor` (>1 = in) around the SVG point (cx, cy), from the view on screen now */
  const zoomAt = (factor: number, cx: number, cy: number, inst: boolean) => {
    const v = viewRef.current;
    const w = Math.max(MIN_VIEW_W, Math.min(W, v.w / factor));
    if (w >= W - 0.5 && !focus) { setManual(null); return; } // all the way out → the whole country
    const h = (w * H) / W;
    setManual({ focus, vb: clampView({ x: cx - (cx - v.x) * (w / v.w), y: cy - (cy - v.y) * (h / v.h), w, h }), instant: inst });
  };
  const zoomStep = (dir: 1 | -1) => { const v = viewRef.current; zoomAt(dir > 0 ? ZOOM_STEP : 1 / ZOOM_STEP, v.x + v.w / 2, v.y + v.h / 2, false); };
  const svgRef = useRef<SVGSVGElement | null>(null);
  const toSvg = (clientX: number, clientY: number): [number, number] | null => {
    const m = svgRef.current?.getScreenCTM();
    if (!m) return null;
    const pt = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    return [pt.x, pt.y];
  };
  // Ctrl / Cmd + scroll (and trackpad pinch) → zoom around the cursor; a plain scroll keeps scrolling the page
  const zoomAtRef = useRef(zoomAt);
  zoomAtRef.current = zoomAt;
  const zoomable = !!regions;
  useEffect(() => {
    const el = svgRef.current;
    if (!el || !zoomable) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const m = el.getScreenCTM();
      if (!m) return;
      const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
      zoomAtRef.current(Math.exp(-Math.max(-60, Math.min(60, e.deltaY)) * 0.006), pt.x, pt.y, true);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomable]);
  // drag to pan while zoomed in (a drag never counts as a click on a region / branch)
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const zoomedIn = view.w < W - 0.5;
  const k = W / view.w; // zoom factor: divide sizes by k so markers / strokes keep their on-screen size

  const [hover, setHover] = useState<RegionId | null>(null);
  const hovered = !focus && hover ? regionShapes.find((r) => r.id === hover) ?? null : null;

  const svg = (
    <svg
      ref={svgRef}
      viewBox={`${view.x.toFixed(2)} ${view.y.toFixed(2)} ${view.w.toFixed(2)} ${view.h.toFixed(2)}`}
      className={`w-full overflow-hidden ${zoomable && zoomedIn ? "cursor-grab active:cursor-grabbing" : ""}`}
      style={{ height: height ?? "100%", maxHeight: height ?? 560, touchAction: zoomable && zoomedIn ? "none" : undefined }}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={L.t("map.aria")}
      onMouseLeave={() => setHover(null)}
      onPointerDown={zoomable ? (e) => { if (e.button === 0 && zoomedIn) drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false }; } : undefined}
      onPointerMove={zoomable ? (e) => {
        const d = drag.current;
        if (!d || d.id !== e.pointerId) return;
        if (!d.moved) {
          if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) return;
          d.moved = true;
          try { (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
        }
        const a = toSvg(d.x, d.y), b = toSvg(e.clientX, e.clientY);
        d.x = e.clientX; d.y = e.clientY;
        if (!a || !b) return;
        const v = viewRef.current;
        setManual({ focus, vb: clampView({ ...v, x: v.x - (b[0] - a[0]), y: v.y - (b[1] - a[1]) }), instant: true });
      } : undefined}
      onPointerUp={zoomable ? (e) => {
        const d = drag.current;
        drag.current = null;
        if (!d?.moved) return;
        suppressClick.current = true;
        setTimeout(() => { suppressClick.current = false; }, 0);
        try { (e.currentTarget as SVGSVGElement).releasePointerCapture(e.pointerId); } catch { /* already released */ }
      } : undefined}
      onPointerCancel={zoomable ? () => { drag.current = null; } : undefined}
      onClickCapture={zoomable ? (e) => { if (suppressClick.current) { e.stopPropagation(); e.preventDefault(); } } : undefined}
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
          <g key={r.id}>
          <path d={r.d} fill="none" stroke={isFocus ? "rgba(255,255,255,0.55)" : dim ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.30)"} strokeWidth={(isFocus ? 2.6 : 2) / k} strokeLinejoin="round" style={{ pointerEvents: "none" }} />
          <path
            d={r.d}
            fill={isFocus ? "#24242a" : dim ? "#141417" : "#1f1f24"}
            stroke="none"
            className={focus ? undefined : "cursor-pointer"}
            style={{ pointerEvents: focus ? "none" : "auto", transition: "fill 160ms ease", outline: "none" }}
            role={focus ? undefined : "button"}
            tabIndex={focus ? -1 : 0}
            aria-label={focus ? undefined : `${L.region(r.id)}, ${L.branches(count)}`}
            onMouseEnter={() => setHover(r.id)}
            onFocus={() => setHover(r.id)}
            onBlur={() => setHover(null)}
            onClick={(e) => { (e.currentTarget as SVGPathElement).blur(); regions?.onFocus(r.id); }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); regions?.onFocus(r.id); } }}
          />
          </g>
        );
      })}
      {/* hovered region lifted above the others: a gentle raise + shadow (All Israel only) */}
      {hovered ? (
        <path
          d={hovered.d}
          fill="#2a2a31"
          stroke="rgba(255,255,255,0.6)"
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
            <title>{`${d.name} · ${L.t(STATUS_KEY[d.status])}`}</title>
            {/* selection outline (not a status) */}
            {selected ? <circle cx={x} cy={y} r={9.5 * s} fill="none" stroke="#fff" strokeWidth={1.5 * s} /> : null}
            {(() => {
              const m = markerLook(d.status, d.brandColor);
              return (
                <circle
                  cx={x}
                  cy={y}
                  r={5 * s}
                  fill={m.fill}
                  fillOpacity={m.opacity}
                  stroke="rgba(10,10,12,0.85)"
                  strokeWidth={1.3 * s}
                  className={m.breathing && pulsing ? "vono-breathe" : undefined}
                />
              );
            })()}
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
            {L.region(hovered.id)}
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
            {L.branches(regions?.counts[hovered.id] ?? 0)}
          </text>
        </g>
      ) : null}
    </svg>
  );
  if (!zoomable) return svg;
  const btn = "flex h-11 w-11 items-center justify-center text-[var(--sb-text-secondary)] transition-colors hover:bg-white/[0.06] hover:text-[var(--sb-text)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--sb-accent)] disabled:opacity-35 disabled:hover:bg-transparent";
  const atMin = view.w <= MIN_VIEW_W + 0.5;
  const fitted = goal === target && Math.abs(view.w - target.w) < 0.5 && Math.abs(view.x - target.x) < 0.5 && Math.abs(view.y - target.y) < 0.5;
  return (
    <div className="relative flex h-full w-full items-center justify-center" dir="ltr">
      {svg}
      <div className="absolute right-2 top-2 flex flex-row overflow-hidden rounded-xl border border-[color:var(--sb-border)] bg-[rgba(18,18,22,0.92)] shadow-lg" role="group" aria-label={L.t("map.zoomAria")}>
        <button type="button" className={btn} onClick={() => zoomStep(1)} disabled={atMin} aria-label={L.t("map.zoomIn")} title={L.t("map.zoomInTitle")}>
          <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>
        </button>
        <button type="button" className={`${btn} border-s border-[color:var(--sb-border)]`} onClick={() => zoomStep(-1)} disabled={!zoomedIn} aria-label={L.t("map.zoomOut")} title={L.t("map.zoomOut")}>
          <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M5 12h14" /></svg>
        </button>
        <button type="button" className={`${btn} border-s border-[color:var(--sb-border)]`} onClick={() => setManual(null)} disabled={fitted} aria-label={L.t(focus ? "map.fitRegion" : "map.fitAll")} title={L.t(focus ? "map.fitRegion" : "map.fitAll")}>
          <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
        </button>
      </div>
    </div>
  );
}
