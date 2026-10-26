"use client";

/**
 * Control Room — a brand's logo drawn well inside its SQUARE tile (owner 2026-10-20: the real Shufersal-group logos are wide, have white margins, or carry their own colour).
 * The image is read once (same-origin, small canvas) and classified:
 *   • white background  → trimmed to its content, shown on a white tile (with a little air)
 *   • one solid colour all round (e.g. a yellow banner) → trimmed, the TILE takes that colour so a wide logo fills it edge to edge
 *   • a rounded colour plate on white (an app icon) → cut to the plate, the tile takes the plate's colour (the icon IS the tile)
 *   • mixed (red + white halves …) → shown whole on white
 * Anything unreadable (another origin, a decode error) → null → the plain image, exactly as before. Presentation only; the stored file is never changed.
 */
import { useEffect, useState } from "react";

/**
 * owner 2026-10-20 ("instead of a square — and instead of the text — we already know these logos: show each one AS IT IS, with its own shape, no background"):
 * the logo is drawn in its natural proportions on NO tile, its outer background (white page, yellow banner …) knocked out to transparent.
 * The owner tried it and said NO ("bring back the squares; only the brand strip is logo-only, WITH its background") → OFF. The knock-out code stays for later.
 */
export const LOGO_AS_IS = false;

export type LogoFit = { src: string; bg: string; bleed: boolean; /** width / height of `src` */ aspect: number; /** drawn as it is (transparent background, own aspect) */ asis?: boolean; /** a lot of dark ink — needs a light edge on a dark page */ dark?: boolean };

const DONE = new Map<string, LogoFit | null>();
const PENDING = new Map<string, Promise<LogoFit | null>>();

type RGB = [number, number, number];
const dist = (a: RGB, b: RGB) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
const isWhite = (c: RGB) => c[0] > 236 && c[1] > 236 && c[2] > 236;
const css = (c: RGB) => `rgb(${c[0]},${c[1]},${c[2]})`;


/** the logo with its OUTER background removed (flood-filled from the corners — white inside a red block etc. is never touched), trimmed to its content */
function knockOut(img: HTMLImageElement): LogoFit | null {
  const nw = img.naturalWidth, nh = img.naturalHeight;
  if (!nw || !nh) return null;
  const k = Math.min(1, 440 / Math.max(nw, nh));
  const w = Math.max(8, Math.round(nw * k)), h = Math.max(8, Math.round(nh * k));
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);
  let im: ImageData;
  try { im = ctx.getImageData(0, 0, w, h); } catch { return null; }
  const d = im.data;
  const rgb = (x: number, y: number): RGB => { const i = (y * w + x) * 4; const a = d[i + 3] / 255; return [Math.round(d[i] * a + 255 * (1 - a)), Math.round(d[i + 1] * a + 255 * (1 - a)), Math.round(d[i + 2] * a + 255 * (1 - a))]; };

  // seeds: the white corners; or all four corners when they agree on one colour (a yellow banner)
  const cs: Array<[number, number]> = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]];
  const cols = cs.map(([x, y]) => rgb(x, y));
  const agree = cols.every((c) => dist(c, cols[0]) < 60);
  const whiteSeeds = cs.filter((_, i) => isWhite(cols[i]));
  const useWhite = whiteSeeds.length > 0 && !(agree && !isWhite(cols[0]));
  const seeds = useWhite ? whiteSeeds : agree ? cs : [];
  const matte: RGB = useWhite ? [255, 255, 255] : cols[0];
  const same = useWhite
    ? (c: RGB) => Math.min(c[0], c[1], c[2]) >= 205
    : (c: RGB) => dist(c, matte) <= 64;

  const gone = new Uint8Array(w * h);
  if (seeds.length) {
    const stack: number[] = [];
    for (const [x, y] of seeds) { const i = y * w + x; if (!gone[i] && same(rgb(x, y))) { gone[i] = 1; stack.push(i); } }
    while (stack.length) {
      const i = stack.pop()!; const x = i % w, y = (i - x) / w;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (!gone[j] && same(rgb(nx, ny))) { gone[j] = 1; stack.push(j); }
      }
    }
    // the edge: pixels next to the removed area keep only the part that is not matte (a soft, un-matted rim — no light fringe on a dark page)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (gone[i]) { d[i * 4 + 3] = 0; continue; }
      let edge = false;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) { if (nx >= 0 && ny >= 0 && nx < w && ny < h && gone[ny * w + nx]) { edge = true; break; } }
      if (!edge) continue;
      const c = rgb(x, y);
      const a = useWhite ? Math.max(0, Math.min(1, (255 - Math.min(c[0], c[1], c[2])) / 90)) : Math.max(0, Math.min(1, dist(c, matte) / 130));
      if (a >= 1) continue;
      const aa = Math.max(a, 0.04);
      for (let q = 0; q < 3; q++) d[i * 4 + q] = Math.max(0, Math.min(255, Math.round((c[q] - matte[q] * (1 - aa)) / aa)));
      d[i * 4 + 3] = Math.round(aa * 255);
    }
  }
  ctx.putImageData(im, 0, 0);

  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 12) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const padX = Math.round((x1 - x0) * 0.015), padY = Math.round((y1 - y0) * 0.015);
  x0 = Math.max(0, x0 - padX); y0 = Math.max(0, y0 - padY); x1 = Math.min(w - 1, x1 + padX); y1 = Math.min(h - 1, y1 + padY);
  const ow = x1 - x0 + 1, oh = y1 - y0 + 1;
  const oc = document.createElement("canvas");
  oc.width = ow; oc.height = oh;
  const octx = oc.getContext("2d");
  if (!octx) return null;
  octx.drawImage(cv, x0, y0, ow, oh, 0, 0, ow, oh);
  // how much of the ink is dark (a grey word on a dark page needs a light edge)
  let ink = 0, darkInk = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = (y * w + x) * 4; if (d[i + 3] < 200) continue; ink++; const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]); if (mx - mn < 45 && 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2] < 110) darkInk++; } // grey / black ink only — a saturated crimson is fine on dark
  return { src: oc.toDataURL("image/png"), bg: "transparent", bleed: false, asis: true, aspect: ow / oh, dark: ink > 0 && darkInk / ink > 0.16 };
}

function analyse(img: HTMLImageElement): LogoFit | null {
  if (LOGO_AS_IS) return knockOut(img);
  const nw = img.naturalWidth, nh = img.naturalHeight;
  if (!nw || !nh) return null;
  const k = Math.min(1, 220 / Math.max(nw, nh));
  const w = Math.max(8, Math.round(nw * k)), h = Math.max(8, Math.round(nh * k));
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);
  let data: Uint8ClampedArray;
  try { data = ctx.getImageData(0, 0, w, h).data; } catch { return null; } // tainted (another origin)
  const px = (x: number, y: number): RGB => { const i = (y * w + x) * 4; const a = data[i + 3] / 255; return [Math.round(data[i] * a + 255 * (1 - a)), Math.round(data[i + 1] * a + 255 * (1 - a)), Math.round(data[i + 2] * a + 255 * (1 - a))]; };

  // the background: the four CORNERS agree (white page, a yellow banner …) — or they do not (two-colour logo) and it is shown whole
  const corners = [px(1, 1), px(w - 2, 1), px(1, h - 2), px(w - 2, h - 2)];
  const agree = corners.every((c) => dist(c, corners[0]) < 60);
  const bg: RGB = corners[0];
  const share = agree ? 1 : 0;

  // the content box: everything that differs from the border colour
  const bbox = (against: RGB) => {
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (dist(px(x, y), against) > 60) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
  };
  const out = (x0: number, y0: number, x1: number, y1: number, bgc: RGB, bleed: boolean): LogoFit | null => {
    const sx = (x0 / w) * nw, sy = (y0 / h) * nh, sw = ((x1 - x0) / w) * nw, sh = ((y1 - y0) / h) * nh;
    if (sw < 4 || sh < 4) return null;
    const m = Math.min(1, 320 / Math.max(sw, sh));
    const oc = document.createElement("canvas");
    oc.width = Math.max(1, Math.round(sw * m)); oc.height = Math.max(1, Math.round(sh * m));
    const octx = oc.getContext("2d");
    if (!octx) return null;
    octx.drawImage(img, sx, sy, sw, sh, 0, 0, oc.width, oc.height);
    return { src: oc.toDataURL("image/png"), bg: css(bgc), bleed, aspect: oc.width / oc.height };
  };

  if (share >= 0.7 && isWhite(bg)) {
    // white background → trim to the content (+ a little air)
    const b = bbox(bg);
    if (!b) return null;
    const padX = Math.max(1, Math.round((b.x1 - b.x0) * 0.03)), padY = Math.max(1, Math.round((b.y1 - b.y0) * 0.03));
    const x0 = Math.max(0, b.x0 - padX), y0 = Math.max(0, b.y0 - padY), x1 = Math.min(w, b.x1 + padX), y1 = Math.min(h, b.y1 + padY);
    // an app icon: a coloured plate on white — the sides of the box are one colour
    const bw = b.x1 - b.x0, bh = b.y1 - b.y0;
    const inset = (fx: number, fy: number) => px(Math.round(b.x0 + bw * fx), Math.round(b.y0 + bh * fy));
    const sides = [inset(0.06, 0.5), inset(0.94, 0.5), inset(0.5, 0.06), inset(0.5, 0.94)];
    const plate = sides[0];
    if (!isWhite(plate) && sides.every((c) => dist(c, plate) < 110) && bw / bh > 0.8 && bw / bh < 1.25) {
      const ix = Math.round(bw * 0.035), iy = Math.round(bh * 0.035);
      return out(b.x0 + ix, b.y0 + iy, b.x1 - ix, b.y1 - iy, plate, true);
    }
    return out(x0, y0, x1, y1, [255, 255, 255], false);
  }
  if (share >= 0.7) {
    // one solid colour all round → the tile takes it
    const b = bbox(bg);
    if (!b) return null;
    const padX = Math.max(1, Math.round((b.x1 - b.x0) * 0.04)), padY = Math.max(1, Math.round((b.y1 - b.y0) * 0.06));
    return out(Math.max(0, b.x0 - padX), Math.max(0, b.y0 - padY), Math.min(w, b.x1 + padX), Math.min(h, b.y1 + padY), bg, true);
  }
  // mixed border (two colours): shown whole on white
  return out(0, 0, w, h, [255, 255, 255], false);
}

export function loadLogoFit(url: string): Promise<LogoFit | null> {
  const hit = PENDING.get(url);
  if (hit) return hit;
  const p = new Promise<LogoFit | null>((resolve) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => { let r: LogoFit | null = null; try { r = analyse(img); } catch { r = null; } DONE.set(url, r); resolve(r); };
    img.onerror = () => { DONE.set(url, null); resolve(null); };
    img.src = url;
  });
  PENDING.set(url, p);
  return p;
}

/** the fitted logo for a URL: `undefined` while it is being read, `null` when it cannot be read (the caller then shows the plain image), else the fit */
export function useLogoFit(url: string | null | undefined): LogoFit | null | undefined {
  const [loaded, setLoaded] = useState<{ url: string; fit: LogoFit | null } | null>(null);
  useEffect(() => {
    if (!url || DONE.has(url)) return;
    let off = false;
    void loadLogoFit(url).then((fit) => { if (!off) setLoaded({ url, fit }); });
    return () => { off = true; };
  }, [url]);
  if (!url) return null;
  if (DONE.has(url)) return DONE.get(url) ?? null;
  return loaded && loaded.url === url ? loaded.fit : undefined;
}
