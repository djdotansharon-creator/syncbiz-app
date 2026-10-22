"use client";

import { useEffect, useState } from "react";

/**
 * Cover "white surround" fix (owner 2026-10-18): some uploads carry a light frame baked into the artwork itself
 * (a few px of near-white on every side), which shows as a pale ring on the library tile and on the player cover.
 * This reads the picture on a canvas (YouTube thumbnails allow cross-origin reads), finds a uniform LIGHT frame
 * that ends in a clear step to the picture, and returns a blob URL of the picture without it. No frame / unreadable
 * (CORS) → null and the original URL is used unchanged. Results are cached per URL; display-only.
 *
 * Conservative on purpose: a frame is at most 6% of a side, must be bright and flat, must END in a visible step
 * (so a plain white background or a bright sky is never "trimmed"), and at least two sides must have one.
 */
const done = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

const MAX_FRAME = 0.06;
const MIN_PX = 2;
const BRIGHT = 0.78;
const FLAT_SD = 0.1;
const STEP = 0.12;
const ANALYSIS_MAX = 720;

type Side = "left" | "right" | "top" | "bottom";

function lum(d: Uint8ClampedArray, i: number): number {
  return (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
}

function lineStats(d: Uint8ClampedArray, w: number, h: number, side: Side, k: number): { mean: number; sd: number } {
  const horizontal = side === "top" || side === "bottom";
  const len = horizontal ? w : h;
  const a = Math.floor(len * 0.1);
  const b = Math.ceil(len * 0.9);
  let sum = 0;
  let sum2 = 0;
  let n = 0;
  for (let t = a; t < b; t++) {
    let x: number;
    let y: number;
    if (side === "left") (x = k), (y = t);
    else if (side === "right") (x = w - 1 - k), (y = t);
    else if (side === "top") (x = t), (y = k);
    else (x = t), (y = h - 1 - k);
    const v = lum(d, (y * w + x) * 4);
    sum += v;
    sum2 += v * v;
    n++;
  }
  const mean = sum / n;
  return { mean, sd: Math.sqrt(Math.max(0, sum2 / n - mean * mean)) };
}

function frameThickness(d: Uint8ClampedArray, w: number, h: number, side: Side): number {
  const span = side === "left" || side === "right" ? w : h;
  const maxK = Math.floor(span * MAX_FRAME);
  let k = 0;
  let frameSum = 0;
  while (k < maxK) {
    const s = lineStats(d, w, h, side, k);
    if (s.mean >= BRIGHT && s.sd <= FLAT_SD) {
      frameSum += s.mean;
      k++;
    } else break;
  }
  if (k < MIN_PX || k >= maxK) return 0; // none, or it never ended (a white background, not a frame)
  const inner = lineStats(d, w, h, side, k);
  if (frameSum / k - inner.mean < STEP && inner.sd < FLAT_SD) return 0; // no visible step into the picture
  return k;
}

function analyse(img: HTMLImageElement): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const nw = img.naturalWidth;
      const nh = img.naturalHeight;
      if (!nw || !nh) return resolve(null);
      const scale = Math.min(1, ANALYSIS_MAX / Math.max(nw, nh));
      const w = Math.round(nw * scale);
      const h = Math.round(nh * scale);
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      if (!ctx) return resolve(null);
      ctx.drawImage(img, 0, 0, w, h);
      const d = ctx.getImageData(0, 0, w, h).data;
      const t = {
        left: frameThickness(d, w, h, "left"),
        right: frameThickness(d, w, h, "right"),
        top: frameThickness(d, w, h, "top"),
        bottom: frameThickness(d, w, h, "bottom"),
      };
      const sides = (Object.values(t) as number[]).filter((v) => v > 0).length;
      if (sides < 2) return resolve(null);
      const pad = 1; // a hair more than measured, to lose the anti-aliased edge
      const cut = (v: number) => (v > 0 ? v + pad : 0);
      const [l, r, tp, bt] = [cut(t.left), cut(t.right), cut(t.top), cut(t.bottom)];
      const sw = w - l - r;
      const sh = h - tp - bt;
      if (sw < w * 0.8 || sh < h * 0.8) return resolve(null);
      const out = document.createElement("canvas");
      out.width = sw;
      out.height = sh;
      const octx = out.getContext("2d");
      if (!octx) return resolve(null);
      octx.drawImage(c, l, tp, sw, sh, 0, 0, sw, sh);
      out.toBlob((blob) => resolve(blob ? URL.createObjectURL(blob) : null), "image/jpeg", 0.92);
    } catch {
      resolve(null); // tainted canvas or decode trouble → keep the original
    }
  });
}

/* One analysis at a time, each in an idle moment — covers appear first, the tidy-up follows without ever competing with
   the page (a search result list or a library grid loads dozens of covers at once). */
let chain: Promise<void> = Promise.resolve();
function whenIdle(): Promise<void> {
  return new Promise((resolve) => {
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (ric) ric(() => resolve(), { timeout: 600 });
    else window.setTimeout(resolve, 30);
  });
}

export function trimCoverFrame(url: string): Promise<string | null> {
  if (done.has(url)) return Promise.resolve(done.get(url) ?? null);
  const pending = inflight.get(url);
  if (pending) return pending;
  const p = new Promise<string | null>((resolve) => {
    const finish = (v: string | null) => {
      done.set(url, v);
      inflight.delete(url);
      resolve(v);
    };
    if (typeof document === "undefined" || !/^https?:/i.test(url) || /\.svg(\?|$)/i.test(url)) return finish(null);
    try {
      if (localStorage.getItem("syncbiz:noCoverTrim") === "1") return finish(null); // diagnostic switch
    } catch {
      /* ignore */
    }
    chain = chain.then(async () => {
      await whenIdle();
      await new Promise<void>((next) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.decoding = "async";
        img.onerror = () => {
          finish(null);
          next();
        };
        img.onload = () =>
          void analyse(img).then((v) => {
            finish(v);
            next();
          });
        img.src = url;
      });
    });
  });
  inflight.set(url, p);
  return p;
}

/** The cover URL to display: the picture without a baked-in light frame once known, otherwise the original. */
export function useTrimmedCover<T extends string | null | undefined>(url: T): T | string {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!url || done.has(url)) return;
    let alive = true;
    void trimCoverFrame(url).then(() => {
      if (alive) bump((n) => n + 1);
    });
    return () => {
      alive = false;
    };
  }, [url]);
  if (!url) return url;
  return done.get(url) ?? url;
}

/* ── Pillarbox measure (round 8): art-track thumbnails are a square cover centred in a 16:9 frame with black bars left
   and right. The search layout aligns the singers' row with where the visible art begins. Returns the left bar's width as a
   fraction (0 – 0.4) of the picture; 0 when there is none / unreadable. Cached; same one-at-a-time idle chain. ── */
const barsDone = new Map<string, number>();
const barsInflight = new Map<string, Promise<number>>();

function measureBars(img: HTMLImageElement): number {
  try {
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    if (!nw || !nh) return 0;
    const scale = Math.min(1, 360 / Math.max(nw, nh));
    const w = Math.round(nw * scale);
    const h = Math.round(nh * scale);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return 0;
    ctx.drawImage(img, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    let k = 0;
    const maxK = Math.floor(w * 0.4);
    while (k < maxK) {
      const s = lineStats(d, w, h, "left", k);
      if (s.mean <= 0.07 && s.sd <= 0.06) k++;
      else break;
    }
    return k >= w * 0.03 && k < maxK ? k / w : 0;
  } catch {
    return 0;
  }
}

export function coverBarsLeft(url: string): Promise<number> {
  if (barsDone.has(url)) return Promise.resolve(barsDone.get(url) ?? 0);
  const pending = barsInflight.get(url);
  if (pending) return pending;
  const p = new Promise<number>((resolve) => {
    const finish = (v: number) => {
      barsDone.set(url, v);
      barsInflight.delete(url);
      resolve(v);
    };
    if (typeof document === "undefined" || !/^https?:/i.test(url)) return finish(0);
    chain = chain.then(async () => {
      await whenIdle();
      await new Promise<void>((next) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onerror = () => {
          finish(0);
          next();
        };
        img.onload = () => {
          finish(measureBars(img));
          next();
        };
        img.src = url;
      });
    });
  });
  barsInflight.set(url, p);
  return p;
}

/** Left black-bar fraction of a cover (0 until measured). */
export function useCoverBars(url: string | null | undefined): number {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!url || barsDone.has(url)) return;
    let alive = true;
    void coverBarsLeft(url).then(() => {
      if (alive) bump((n) => n + 1);
    });
    return () => {
      alive = false;
    };
  }, [url]);
  return url ? (barsDone.get(url) ?? 0) : 0;
}
