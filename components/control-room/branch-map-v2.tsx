"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LAND_RINGS } from "@/lib/control-room-land";
import { REGION_DRAW_ORDER, regionForPoint, type RegionId } from "@/lib/control-room-regions";
import { cityLngLat } from "@/lib/control-room-geo";
import { REGION_BORDERS } from "@/lib/control-room-region-borders";
import { REGION_SHAPES } from "@/lib/control-room-region-shapes";
import { useMgmt } from "@/lib/i18n/use-mgmt";
import { markerLook, STATUS_KEY, LED_FILL, type MapBranch, type MapRegions } from "@/components/control-room/branch-map";
import { Marquee } from "@/components/control-room/marquee";

/** owner 2026-10-20: NO dashed lines on the map for now (neither the borders between the regions nor the outline on hover) — flip to true to bring them back (the generated borders + shapes are all still in place). */
const SHOW_REGION_LINES = false;

/**
 * CONTROL ROOM — the network map, v2 (owner 2026-10-19). The classic map (`branch-map.tsx`) is untouched and one switch away
 * (`localStorage.setItem("syncbiz:crMap", "classic")`, see network-map.tsx). Same props, same data, same projection. What is new:
 *  - the outlines are ROUNDED (Douglas–Peucker + corner rounding on land and regions) — no needle tips, long borders stay straight;
 *  - zooming into a region = a camera zoom: the other regions stay where they are on the map (they leave the frame with it) and fade, so only the region remains;
 *    going back zooms out and they fade in again;
 *  - no native tooltip. Resting on a branch for a moment opens a white, Apple-style bubble: the branch name (top left), the song that
 *    is playing there in a square with its running time and a play mark, or the branch's status when nothing plays.
 * Everything is one small SVG (no tiles, no network traffic) like the classic map.
 */

const W = 420;
const H = 720; // a portrait box: the Control Room map is a tall column on the right (Israel is tall) — it uses the whole height
const PAD = 22; // the land nearly touches the box edges: the map is as BIG as its column allows
const MIN_SPAN_LAT = 0.35;
const MAX_PULSING = 30;
const SMOOTH_TOL = 2.2; // Douglas–Peucker tolerance for the smooth outlines (map units)
const DOT_REF_R = 7; // the dot is drawn at this radius and scaled to its real size (so the size can glide)
const HOVER_MS = 380; // rest on a branch this long → the bubble

type LngLat = readonly [number, number];
type Pt = [number, number];

function landBounds(): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of LAND_RINGS) for (const [x, y] of r) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  return [minX, minY, maxX, maxY];
}
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
  return ([lng, lat]: LngLat): Pt => [offX + (lng - minLng) * kx * scale, offY + (maxLat - lat) * scale];
}

/** Douglas–Peucker on an OPEN chain (iterative, tolerance in map units) */
function simplifyChain(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1; keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let maxD = 0, idx = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1e-9;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (idx >= 0 && maxD > tol) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  const out: Pt[] = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
  return out;
}
/** Douglas–Peucker on a closed ring: the ring is cut at the point farthest from its start (a ring whose last point equals its first has a zero-length base, which made the
 *  plain version keep everything — the coastline noise the owner called "spikes"), each half is simplified, and they are joined again */
function simplify(ringIn: Pt[], tol: number): Pt[] {
  if (ringIn.length < 8) return ringIn;
  const closed = ringIn[0][0] === ringIn[ringIn.length - 1][0] && ringIn[0][1] === ringIn[ringIn.length - 1][1];
  const pts = closed ? ringIn.slice(0, -1) : ringIn;
  let m = 0, md = 0;
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]); if (d > md) { md = d; m = i; } }
  const first = simplifyChain(pts.slice(0, m + 1), tol);
  const second = simplifyChain(pts.slice(m).concat([pts[0]]), tol);
  const out = [...first.slice(0, -1), ...second.slice(0, -1)];
  return out.length >= 3 ? out : ringIn;
}

/** closed ring → smooth blob: Douglas–Peucker (a coarse tolerance drops the fine coastline noise), then three rounds of Chaikin corner cutting — no needle tips, no hard corners anywhere (owner 2026-10-20: "no spikes") */
function smoothPath(ringIn: Pt[]): string {
  let ring = simplify(ringIn, SMOOTH_TOL).filter((p, i, a) => i === 0 || Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) > 0.05);
  if (ring.length < 3) return "";
  for (let it = 0; it < 3; it++) {
    const next: Pt[] = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      next.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    ring = next;
  }
  return "M" + ring.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("L") + "Z";
}

/** open polyline → smooth line (3× Chaikin, the two ends stay put) */
function smoothOpen(pts: Pt[]): string {
  let p = pts;
  for (let it = 0; it < 3 && p.length >= 3; it++) {
    const n: Pt[] = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1];
      n.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    n.push(p[p.length - 1]);
    p = n;
  }
  return "M" + p.map((q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join("L");
}

/** "#rrggbb" / "#rgb" → [r,g,b]; anything else → null (the dot then keeps a flat fill) */
function parseHex(c: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split("").map((x) => x + x).join("") : m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
const mixHex = (c: [number, number, number], to: [number, number, number], t: number) =>
  `rgb(${Math.round(c[0] + (to[0] - c[0]) * t)},${Math.round(c[1] + (to[1] - c[1]) * t)},${Math.round(c[2] + (to[2] - c[2]) * t)})`;

type ViewBox = { x: number; y: number; w: number; h: number };
const FULL_VIEW: ViewBox = { x: 0, y: 0, w: W, h: H };
const ZOOM_MS = 1050;
const MIN_VIEW_W = W / 14;
const ZOOM_STEP = 1.6;
function clampView(v: ViewBox): ViewBox {
  const cx = Math.max(0, Math.min(W, v.x + v.w / 2)), cy = Math.max(0, Math.min(H, v.y + v.h / 2));
  return { x: cx - v.w / 2, y: cy - v.h / 2, w: v.w, h: v.h };
}
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2); // gentle start, gentle landing (owner 2026-10-20: it used to leap in the first tenth of a second)

function centroid(pts: Pt[]): Pt {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const f = pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
    a += f; cx += (pts[j][0] + pts[i][0]) * f; cy += (pts[j][1] + pts[i][1]) * f;
  }
  return a ? [cx / (3 * a), cy / (3 * a)] : pts[0];
}
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, Math.floor(s % 60))).padStart(2, "0")}`;

export function BranchMapV2({
  branches, selectedId, onSelect, height, fit = "country", regions, controlsSlot, colorMode = "calm", pinnedId = null,
}: {
  branches: MapBranch[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  height?: number | string;
  fit?: "country" | "branches";
  regions?: MapRegions;
  controlsSlot?: HTMLElement | null;
  /** "brand": the dots carry the brand's colour (a branch that still needs its station gets a thin amber ring); "calm": one colour per STATUS */
  colorMode?: "brand" | "calm";
  /** a branch whose white bubble stays OPEN (the branch screen is showing it) — it rides inside the SVG, so it follows every zoom / pan by itself */
  pinnedId?: string | null;
}) {
  const L = useMgmt();
  const placed = useMemo(
    () =>
      branches
        .map((b) => {
          const at: LngLat | null = typeof b.latitude === "number" && typeof b.longitude === "number" ? [b.longitude, b.latitude] : cityLngLat(b.city);
          return at ? { ...b, at, region: regionForPoint(at[0], at[1]) as RegionId | null } : null;
        })
        .filter((d): d is MapBranch & { at: LngLat; region: RegionId | null } => d !== null),
    [branches],
  );
  const fitKey = placed.map((d) => `${d.at[0].toFixed(4)},${d.at[1].toFixed(4)}`).sort().join("|");
  const project = useMemo(() => {
    if (fit === "country" || !placed.length) return fitProjection(landBounds());
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const d of placed) { minX = Math.min(minX, d.at[0]); maxX = Math.max(maxX, d.at[0]); minY = Math.min(minY, d.at[1]); maxY = Math.max(maxY, d.at[1]); }
    return fitProjection([minX, minY, maxX, maxY]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fitKey captures the positions
  }, [fit, fitKey]);
  const landRings = useMemo(() => LAND_RINGS.map((r) => smoothPath(r.map((p) => project(p)))), [project]);
  // the borders BETWEEN the regions (generated, see lib/control-room-region-borders.ts), projected and smoothed
  const borderPaths = useMemo(() => REGION_BORDERS.map((c) => smoothOpen(c.map((p) => project(p)))), [project]);
  const pulsing = placed.filter((d) => d.status === "playing").length <= MAX_PULSING;

  const regionShapes = useMemo(() => {
    if (!regions) return [];
    return REGION_DRAW_ORDER.map((id) => {
      // ONE soft blob per region (generated, see lib/control-room-region-shapes.ts) — the raw region polygons are unions of many pieces and read as lumps
      const rings = (REGION_SHAPES[id] ?? []).map((ring) => ring.map((pt) => project(pt as [number, number])));
      const d = rings.map((ring) => smoothPath(ring)).join("");
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const ring of rings) for (const [x, y] of ring) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
      const area = (ring: Pt[]) => { let a = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]; return Math.abs(a); };
      const main = rings.reduce((a, b) => (area(b) > area(a) ? b : a), rings[0]);
      // a small region (Gush Dan, Haifa …): its name goes beside the blob, not on top of its branches
      const side = maxX - minX < 80 && maxY - minY < 110;
      return { id, d, bbox: { minX, minY, maxX, maxY }, label: centroid(main), side };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- shapes depend only on the projection
  }, [project, !!regions]);

  const focus = regions?.focus ?? null;
  const focusShape = focus ? regionShapes.find((r) => r.id === focus) ?? null : null;
  const target = useMemo<ViewBox>(() => {
    const sh = focusShape;
    if (!sh) return FULL_VIEW;
    const b = { ...sh.bbox };
    for (const d of placed) { if (d.region !== focus) continue; const [x, y] = project(d.at); b.minX = Math.min(b.minX, x); b.maxX = Math.max(b.maxX, x); b.minY = Math.min(b.minY, y); b.maxY = Math.max(b.maxY, y); }
    const pad = 14;
    let w = b.maxX - b.minX + 2 * pad, h = b.maxY - b.minY + 2 * pad;
    if (w / h > W / H) h = (w * H) / W; else w = (h * W) / H;
    const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
    return { x: cx - w / 2, y: cy - h / 2, w, h };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fitKey captures where the branches are
  }, [focus, regionShapes, fitKey]);

  // every region that is NOT focused flies outward from the focused one (a vector per region, computed once per focus)
  const fly = useMemo(() => {
    const out = new Set<RegionId>();
    if (!focusShape) return out;
    for (const r of regionShapes) if (r.id !== focus) out.add(r.id);
    return out;
  }, [focus, focusShape, regionShapes]);

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
    const to = goal;
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / ZOOM_MS), e = ease(t);
      // a true camera zoom: the WIDTH changes by a constant factor per moment (the zoom feels even), and the centre travels so the target comes straight at you
      const w = from.w * Math.pow(to.w / from.w, e);
      const h = (w * from.h) / from.w;
      const fx = Math.abs(to.w - from.w) > 0.01 ? (1 / w - 1 / from.w) / (1 / to.w - 1 / from.w) : e;
      const cx = from.x + from.w / 2 + (to.x + to.w / 2 - (from.x + from.w / 2)) * fx;
      const cy = from.y + from.h / 2 + (to.y + to.h / 2 - (from.y + from.h / 2)) * fx;
      setView({ x: cx - w / 2, y: cy - h / 2, w, h });
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [goal, instant]);

  const zoomAt = (factor: number, cx: number, cy: number, inst: boolean) => {
    const v = viewRef.current;
    const w = Math.max(MIN_VIEW_W, Math.min(W, v.w / factor));
    if (w >= W - 0.5 && !focus) { setManual(null); return; }
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
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const zoomedIn = view.w < W - 0.5;
  const k = W / view.w;

  const [hover, setHover] = useState<RegionId | null>(null);
  const hoveredId = !focus ? hover : null; // one persistent highlight (no overlay that mounts / unmounts on every move — that flickered)

  // ── dot size (owner 2026-10-20: "all the circles the same size — if two are close and need to be small, all the others shrink with them") ──
  // ONE radius for every dot: the base follows the COUNT (few branches → bigger, many → smaller) and is then capped by the CLOSEST pair on screen, so no two dots
  // sit on top of each other and nothing is bigger than its neighbours allow. Zooming in (or focusing a region) frees room and the dots grow; the size glides.
  const minNearest = useMemo(() => {
    const pts = placed.filter((d) => !focus || d.region === focus).map((d) => project(d.at));
    let best = Infinity;
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) best = Math.min(best, Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]));
    return best;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fitKey captures where the branches are
  }, [fitKey, focus, project]);
  const countInView = focus ? placed.filter((d) => d.region === focus).length : placed.length;
  const baseR = countInView <= 8 ? 7.2 : countInView <= 16 ? 6.2 : countInView <= 30 ? 5.2 : countInView <= 60 ? 4.4 : 3.6;
  const dotRadius = minNearest === Infinity ? baseR : Math.min(baseR, Math.max(4.4, (minNearest * k) / 2 - 0.3));
  // the vertical span of the land (the dark gradient runs along it: dark grey in the north → black in the south)
  const landSpan = useMemo(() => {
    let top = Infinity, bot = -Infinity;
    for (const r of regionShapes) { top = Math.min(top, r.bbox.minY); bot = Math.max(bot, r.bbox.maxY); }
    return top === Infinity ? ([0, H] as const) : ([top, bot] as const);
  }, [regionShapes]);
  // one soft sphere gradient per distinct dot colour
  const dotLooks = placed.map((d) => {
    const m = markerLook(d.status, d.brandColor);
    const brand = colorMode === "brand" && d.brandColor;
    const base = brand ? d.brandColor! : m.fill;
    const opacity = brand ? (d.status === "install" ? 0.5 : d.status === "offline" ? 0.38 : d.status === "unknown" ? 0.6 : 1) : m.opacity;
    const rgb = parseHex(base);
    return { id: d.id, base, opacity, rgb, gid: rgb ? `vono-dot-${rgb.join("-")}` : null, breathing: brand ? d.status === "playing" : m.breathing };
  });
  const dotGrads = new Map<string, [number, number, number]>();
  for (const l of dotLooks) if (l.gid && l.rgb) dotGrads.set(l.gid, l.rgb);
  // the focused region's outline (to tell a click INSIDE it from a click beside it)
  const focusPath = useRef<SVGPathElement | null>(null);

  // ── the long-hover bubble ──
  const [bubble, setBubble] = useState<{ id: string; x: number; y: number } | null>(null);
  const bubbleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // owner 2026-10-20: a region stays marked while the pointer is on the sea, the title or the controls — it clears only when the pointer leaves the whole map rectangle (`.cr-map`)
  useEffect(() => {
    const el = svgRef.current;
    const box: Element | null = el ? el.closest(".cr-map") ?? el.parentElement : null;
    if (!box) return;
    const leave = () => setHover(null);
    box.addEventListener("mouseleave", leave);
    return () => box.removeEventListener("mouseleave", leave);
  }, []);
  const hideBubble = () => { if (bubbleTimer.current) { clearTimeout(bubbleTimer.current); bubbleTimer.current = null; } setBubble(null); };
  const armBubble = (id: string, x: number, y: number) => {
    if (id === pinnedId) return; // its bubble is already pinned open
    if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
    bubbleTimer.current = setTimeout(() => {
      const m = svgRef.current?.getScreenCTM();
      if (!m) return;
      const p = new DOMPoint(x, y).matrixTransform(m);
      setBubble({ id, x: p.x, y: p.y });
    }, HOVER_MS);
  };
  useEffect(() => () => { if (bubbleTimer.current) clearTimeout(bubbleTimer.current); }, []);
  // a moving camera moves the dots — close the bubble
  const viewKey = `${view.x.toFixed(1)}|${view.y.toFixed(1)}|${view.w.toFixed(1)}`;
  const lastViewKey = useRef(viewKey);
  useEffect(() => { if (lastViewKey.current !== viewKey) { lastViewKey.current = viewKey; if (bubble) setBubble(null); } }, [viewKey, bubble]);
  const bubbleBranch = bubble ? placed.find((d) => d.id === bubble.id) ?? null : null;
  // ── the PINNED bubble (the branch screen is open): exactly the hover bubble, kept open. Its screen position is re-read every frame (the camera glides, the window resizes, the page
  //    scrolls — a change of more than half a pixel updates it), so it always sits on the dot like the hover one does ──
  const pinned = pinnedId ? placed.find((d) => d.id === pinnedId) ?? null : null;
  const [pinPos, setPinPos] = useState<{ x: number; y: number } | null>(null);
  const pinAt = pinned ? project(pinned.at) : null;
  const pinX = pinAt ? pinAt[0] : null, pinY = pinAt ? pinAt[1] : null;
  useEffect(() => {
    if (pinX === null || pinY === null) return;
    let raf = 0;
    let last: { x: number; y: number } | null = null;
    const tick = () => {
      const m = svgRef.current?.getScreenCTM();
      if (m) {
        const p = new DOMPoint(pinX, pinY).matrixTransform(m);
        if (!last || Math.abs(p.x - last.x) > 0.5 || Math.abs(p.y - last.y) > 0.5) { last = { x: p.x, y: p.y }; setPinPos(last); }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [pinX, pinY]);

  const svg = (
    <svg
      ref={svgRef}
      viewBox={`${view.x.toFixed(2)} ${view.y.toFixed(2)} ${view.w.toFixed(2)} ${view.h.toFixed(2)}`}
      className={`w-full overflow-hidden ${zoomable && zoomedIn ? "cursor-grab active:cursor-grabbing" : ""}`}
      style={{ height: height ?? "100%", maxHeight: height ?? 560, touchAction: zoomable && zoomedIn ? "none" : undefined }}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={L.t("map.aria")}
      onMouseLeave={hideBubble}
      onPointerDown={zoomable ? (e) => { hideBubble(); if (e.button === 0 && zoomedIn) drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false }; } : undefined}
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
      onClick={zoomable && focus ? (e) => {
        // a click beside the focused region (on the empty map) goes back to the whole country; a click inside the region itself does nothing
        const at = toSvg(e.clientX, e.clientY);
        const path = focusPath.current;
        if (at && path && path.isPointInFill(new DOMPoint(at[0], at[1]))) return;
        hideBubble();
        regions?.onFocus(null);
      } : undefined}
    >
      <defs>
        {/* ONE land colour: dark grey in the north → black in the south (owner 2026-10-20). The regions are told apart by thin dashed lines inside it, not by colour or outline. */}
        <linearGradient id="vono-land-fill" gradientUnits="userSpaceOnUse" x1="0" y1={landSpan[0]} x2="0" y2={landSpan[1]}>
          <stop offset="0" stopColor="#2e2e34" />
          <stop offset="1" stopColor="#0b0b0e" />
        </linearGradient>
        {/* the dashed region lines are clipped to the land (the smoothed coast can differ from the raw border ends by a hair) */}
        <clipPath id="vono-land-clip">{landRings.map((d, i) => <path key={i} d={d} />)}</clipPath>
        {[...dotGrads.entries()].map(([gid, c]) => (
          <radialGradient key={gid} id={gid} cx="34%" cy="30%" r="80%">
            <stop offset="0" stopColor={mixHex(c, [255, 255, 255], 0.62)} />
            <stop offset="0.42" stopColor={mixHex(c, [255, 255, 255], 0.1)} />
            <stop offset="1" stopColor={mixHex(c, [0, 0, 0], 0.22)} />
          </radialGradient>
        ))}
        {[...dotGrads.entries()].map(([gid, c]) => (
          <radialGradient key={`${gid}-glow`} id={`${gid}-glow`}>
            <stop offset="0.3" stopColor={`rgb(${c[0]},${c[1]},${c[2]})`} stopOpacity="0.5" />
            <stop offset="1" stopColor={`rgb(${c[0]},${c[1]},${c[2]})`} stopOpacity="0" />
          </radialGradient>
        ))}
      </defs>
      {/* land: one soft silhouette under the regions (it also closes the hairline gaps between them), it fades out when a region is focused */}
      <g style={{ opacity: focus ? 0 : 1, transition: "opacity 700ms ease" }}>{landRings.map((d, i) => <path key={i} d={d} fill="url(#vono-land-fill)" />)}</g>
      {regionShapes.map((r) => {
        const isFocus = r.id === focus;
        const away = fly.has(r.id);
        return (
          <g
            key={r.id}
            style={{
              opacity: away ? 0 : 1,
              transition: "opacity 800ms ease",
              pointerEvents: away || isFocus ? "none" : undefined,
            }}
          >
            <path
              d={r.d}
              fill={isFocus ? "url(#vono-land-fill)" : hoveredId === r.id ? "rgba(255,255,255,0.17)" : "transparent"}
              ref={isFocus ? focusPath : undefined}
              className={focus ? undefined : "cursor-pointer"}
              style={{ pointerEvents: focus ? "none" : "auto", transition: "fill 220ms ease, stroke 220ms ease", outline: "none" }}
              role={focus ? undefined : "button"}
              tabIndex={focus ? -1 : 0}
              aria-label={focus ? undefined : `${L.region(r.id)}, ${L.branches(regions?.counts[r.id] ?? 0)}`}
              onMouseEnter={() => setHover(r.id)}
              onFocus={() => setHover(r.id)}
              onBlur={() => setHover(null)}
              onClick={(e) => { (e.currentTarget as SVGPathElement).blur(); hideBubble(); regions?.onFocus(r.id); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); regions?.onFocus(r.id); } }}
            />
            {/* the dashed outline that appears around the region under the pointer (owner 2026-10-20; off — see SHOW_REGION_LINES) */}
            {SHOW_REGION_LINES ? (
              <path d={r.d} fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth={1.4 / k} strokeDasharray={`${5 / k} ${3.6 / k}`} strokeLinecap="round" strokeLinejoin="round"
                style={{ pointerEvents: "none", opacity: hoveredId === r.id ? 1 : 0, transition: "opacity 220ms ease" }} aria-hidden />
            ) : null}
          </g>
        );
      })}
      {/* the borders between the regions: thin dashed lines (owner 2026-10-20: ONE land, the regions only told apart by dashes; off for now — see SHOW_REGION_LINES) — they fade when a region is focused */}
      {SHOW_REGION_LINES ? (
      <g clipPath="url(#vono-land-clip)" style={{ pointerEvents: "none", opacity: focus ? 0 : 1, transition: "opacity 500ms ease" }} aria-hidden>
        {borderPaths.map((d, i) => (
          <path key={i} d={d} fill="none" stroke="rgba(255,255,255,0.34)" strokeWidth={1.15 / k} strokeDasharray={`${4.5 / k} ${3.6 / k}`} strokeLinecap="round" strokeLinejoin="round" />
        ))}
      </g>
      ) : null}
      {placed.map((d, idx) => {
        const [x, y] = project(d.at);
        const selected = d.id === selectedId;
        const s = 1 / k;
        const hidden = !!focus && d.region !== focus;
        const look = dotLooks[idx]!;
        const fill = look.gid ? `url(#${look.gid})` : look.base;
        const R = dotRadius;
        return (
          <g
            key={d.id}
            className="cursor-pointer"
            transform={`translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${s})`}
            style={{ opacity: hidden ? 0 : 1, transition: "opacity 800ms ease", pointerEvents: hidden ? "none" : undefined }}
            onClick={(e) => { e.stopPropagation(); hideBubble(); onSelect(d.id); }}
            onPointerEnter={() => armBubble(d.id, x, y)}
            onPointerLeave={hideBubble}
          >
            {/* a generous invisible hit area so the dot is easy to rest on */}
            <circle r={Math.max(11, R + 6)} fill="transparent" />
            {/* the selected branch: a soft dark halo (no outline) */}
            {selected ? <circle r={R + 4.5} fill="rgba(14,14,18,0.28)" /> : null}
            {/* the dot: a whole sphere — no outline, a soft shadow under it, a light from the upper left. Its size glides when the common radius changes; a NEW dot pops in with a soft ring. */}
            <g className="cr-dot-size" style={{ transform: `scale(${(R / DOT_REF_R).toFixed(4)})` }}>
              <g className="cr-dot-pop" style={{ ["--d" as string]: `${Math.min(idx, 14) * 70}ms` } as React.CSSProperties}>
                <circle className="cr-dot-halo" r={DOT_REF_R} fill="none" stroke={look.base} style={{ ["--d" as string]: `${Math.min(idx, 14) * 70}ms` } as React.CSSProperties} />
                {look.gid ? <circle r={DOT_REF_R * 2.3} fill={`url(#${look.gid}-glow)`} className={`cr-dot-glow${look.breathing && pulsing ? " cr-dot-glow--live" : ""}`} opacity={look.opacity} /> : null}
                <circle cy={1.4} r={DOT_REF_R} fill="rgba(0,0,0,0.22)" opacity={look.opacity} />
                <circle r={DOT_REF_R} fill={fill} fillOpacity={look.opacity} />
                <ellipse cx={-2.3} cy={-2.8} rx={2.7} ry={1.8} fill="rgba(255,255,255,0.55)" opacity={look.opacity} />
              </g>
            </g>
          </g>
        );
      })}
      {regionShapes.map((r) => {
        const lx = r.side ? r.bbox.minX - 9 / k : r.label[0];
        const ly = r.side ? (r.bbox.minY + r.bbox.maxY) / 2 - 2 / k : r.label[1];
        const anchor = r.side ? "end" : "middle";
        return (
          <g key={`lbl-${r.id}`} style={{ pointerEvents: "none", opacity: hoveredId === r.id ? 1 : 0, transition: "opacity 200ms ease" }}>
            <text x={lx} y={ly} textAnchor={anchor} fontSize={13 / k} fontWeight={600} fill="#f5f5f7" stroke="rgba(10,10,12,0.85)" strokeWidth={3 / k} paintOrder="stroke">{L.region(r.id)}</text>
            <text x={lx} y={ly + 16 / k} textAnchor={anchor} fontSize={11 / k} fill="#a1a1a6" stroke="rgba(10,10,12,0.85)" strokeWidth={3 / k} paintOrder="stroke">{L.branches(regions?.counts[r.id] ?? 0)}</text>
          </g>
        );
      })}
    </svg>
  );

  // the bubble (a portal: it must not be clipped by the map card)
  const bubbleEl =
    typeof document === "undefined"
      ? null
      : bubble && bubbleBranch
        ? createPortal(<MapBubble b={bubbleBranch} x={bubble.x} y={bubble.y} statusLabel={L.t(STATUS_KEY[bubbleBranch.status])} />, document.body)
        : pinned && pinPos
          ? createPortal(<MapBubble key={pinned.id} b={pinned} x={pinPos.x} y={pinPos.y} statusLabel={L.t(STATUS_KEY[pinned.status])} />, document.body)
          : null;

  if (!zoomable) return <>{svg}{bubbleEl}</>;
  const atMin = view.w <= MIN_VIEW_W + 0.5;
  const fitted = goal === target && Math.abs(view.w - target.w) < 0.5 && Math.abs(view.x - target.x) < 0.5 && Math.abs(view.y - target.y) < 0.5;
  const inSlot = !!controlsSlot;
  const cls = "cr-zoom-btn";
  const controls = (
    <div className={inSlot ? "cr-zoom" : "cr-zoom cr-zoom--float"} role="group" aria-label={L.t("map.zoomAria")} dir="ltr">
      <button type="button" className={cls} onClick={() => zoomStep(1)} disabled={atMin} aria-label={L.t("map.zoomIn")}>
        <svg className="h-[17px] w-[17px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>
      </button>
      <button type="button" className={cls} onClick={() => zoomStep(-1)} disabled={!zoomedIn} aria-label={L.t("map.zoomOut")}>
        <svg className="h-[17px] w-[17px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M5 12h14" /></svg>
      </button>
      <button type="button" className={cls} onClick={() => setManual(null)} disabled={fitted} aria-label={L.t(focus ? "map.fitRegion" : "map.fitAll")}>
        <svg className="h-[17px] w-[17px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
      </button>
    </div>
  );
  return (
    <div className="relative flex h-full w-full items-center justify-center" dir="ltr">
      {svg}
      {inSlot ? createPortal(controls, controlsSlot!) : controls}
      {bubbleEl}
    </div>
  );
}

/** the white, Apple-style bubble: the branch name (top left); the song that plays there — its square, its name (a ticker when long), the 3-bar mark + the running time; or just the status */
function MapBubble({ b, x = 0, y = 0, statusLabel, pinned = false, caretX = 118, below = false }: { b: MapBranch & { at: LngLat }; x?: number; y?: number; statusLabel: string; /** drawn in place (inside the SVG) instead of floating at screen coordinates */ pinned?: boolean; caretX?: number; below?: boolean }) {
  const now = b.now ?? null;
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!now?.playing) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [now?.playing]);
  const elapsed = now ? Math.min(now.duration > 0 ? now.duration : Infinity, Math.max(0, now.position + (now.playing ? (nowMs - now.positionAt) / 1000 : 0))) : 0;
  const W_B = 236;
  const left = Math.max(12, Math.min(window.innerWidth - W_B - 12, x - W_B / 2));
  const above = y > 170;
  return (
    <div className={`cr-bubble${pinned ? " cr-bubble--pinned" : ""}`} data-below={(pinned ? below : !above) ? "1" : undefined} style={(pinned ? { width: W_B, ["--cr-caret" as string]: `${Math.max(22, Math.min(W_B - 22, caretX))}px` } : { left, top: above ? y - 16 : y + 18, width: W_B, ["--cr-caret" as string]: `${Math.max(22, Math.min(W_B - 22, x - left))}px` }) as React.CSSProperties}>
      <div className="cr-bubble-name">
        <span className="cr-bubble-led" style={{ background: LED_FILL[b.status] }} aria-hidden />
        <span dir="auto" className="truncate">{b.name}</span>
      </div>
      {now ? (
        <div className="cr-bubble-body">
          <div className="cr-bubble-art">
            {now.cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={now.cover} alt="" draggable={false} />
            ) : (
              <div className="cr-bubble-art-empty" aria-hidden>
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
              </div>
            )}
          </div>
          <div className="cr-bubble-meta">
            <Marquee className="cr-bubble-title" text={now.title} />
            <div className="cr-bubble-live">
              <span className={`cr-eq ${now.playing ? "is-playing" : ""}`} aria-hidden><i /><i /><i /></span>
              <span className="cr-bubble-time">{mmss(elapsed)}</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="cr-bubble-status">{statusLabel}</div>
      )}
    </div>
  );
}
