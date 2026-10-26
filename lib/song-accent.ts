"use client";

import { useEffect, useState } from "react";

/**
 * The "colour of the song": a vivid, readable accent derived from the track's cover art.
 * Client-only, display-only. Pixels are read from a 24×24 downscale on a canvas (YouTube
 * thumbnails allow cross-origin reads); vivid mid-tone pixels dominate the average, grey
 * covers return null so the UI can fall back to a neutral accent. Results are cached per URL.
 */
const cache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

export function extractSongAccent(url: string): Promise<string | null> {
  const hit = cache.get(url);
  if (hit !== undefined) return Promise.resolve(hit);
  const pending = inflight.get(url);
  if (pending) return pending;
  const p = new Promise<string | null>((resolve) => {
    const done = (v: string | null) => {
      cache.set(url, v);
      inflight.delete(url);
      resolve(v);
    };
    if (typeof document === "undefined") return done(null);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onerror = () => done(null);
    img.onload = () => {
      try {
        const S = 24;
        const c = document.createElement("canvas");
        c.width = S;
        c.height = S;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        if (!ctx) return done(null);
        ctx.drawImage(img, 0, 0, S, S);
        const d = ctx.getImageData(0, 0, S, S).data;
        let r = 0;
        let g = 0;
        let b = 0;
        let wsum = 0;
        for (let i = 0; i < d.length; i += 4) {
          const R = d[i] / 255;
          const G = d[i + 1] / 255;
          const B = d[i + 2] / 255;
          const [, s, l] = rgbToHsl(R, G, B);
          const w = s * s * Math.max(0, 1 - Math.abs(l - 0.5) * 1.6) + 0.004;
          r += R * w;
          g += G * w;
          b += B * w;
          wsum += w;
        }
        if (!wsum) return done(null);
        const [h, s0, l0] = rgbToHsl(r / wsum, g / wsum, b / wsum);
        if (s0 < 0.12) return done(null); // a grey cover has no "colour of the song"
        const s1 = Math.min(1, Math.max(0.6, s0 * 1.3));
        const l1 = Math.min(0.7, Math.max(0.56, l0));
        done(`hsl(${Math.round(h)} ${Math.round(s1 * 100)}% ${Math.round(l1 * 100)}%)`);
      } catch {
        done(null); // tainted canvas or decode trouble → neutral fallback
      }
    };
    img.src = url;
  });
  inflight.set(url, p);
  return p;
}

/** The song accent for a cover URL (null until known, or when the cover is grey/unreadable). */
export function useSongAccent(url: string | null | undefined): string | null {
  const [resolved, setResolved] = useState<{ url: string; accent: string | null } | null>(null);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    void extractSongAccent(url).then((accent) => {
      if (alive) setResolved({ url, accent });
    });
    return () => {
      alive = false;
    };
  }, [url]);
  if (!url) return null;
  const cached = cache.get(url);
  if (cached !== undefined) return cached;
  return resolved && resolved.url === url ? resolved.accent : null;
}

/* ── Cover lightness at the top-left (where the brand mark sits over the ambient field) ── */
const lightCache = new Map<string, number | null>();
const lightInflight = new Map<string, Promise<number | null>>();
function srgbToLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
/** Relative luminance (0–1) of the cover's top-left region, as the ambient layer shows it there. */
export function extractCoverLightness(url: string): Promise<number | null> {
  const hit = lightCache.get(url);
  if (hit !== undefined) return Promise.resolve(hit);
  const pending = lightInflight.get(url);
  if (pending) return pending;
  const p = new Promise<number | null>((resolve) => {
    const done = (v: number | null) => {
      lightCache.set(url, v);
      lightInflight.delete(url);
      resolve(v);
    };
    if (typeof document === "undefined") return done(null);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onerror = () => done(null);
    img.onload = () => {
      try {
        // exactly what the ambient layer shows: the cover COVER-FITTED into 16:9 (YouTube stills
        // carry black bars top/bottom that the field crops away), then the viewport's top-left —
        // the field is scaled 136% and offset -18%, so the mark sits over ≈(14%, 15%) of it
        const W = 32;
        const H = 18;
        const c = document.createElement("canvas");
        c.width = W;
        c.height = H;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        if (!ctx) return done(null);
        const sc = Math.max(W / (img.naturalWidth || W), H / (img.naturalHeight || H));
        const w = (img.naturalWidth || W) * sc;
        const h = (img.naturalHeight || H) * sc;
        ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
        const d = ctx.getImageData(2, 1, 6, 4).data;
        let y = 0;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) {
          y += 0.2126 * srgbToLinear(d[i] / 255) + 0.7152 * srgbToLinear(d[i + 1] / 255) + 0.0722 * srgbToLinear(d[i + 2] / 255);
          n += 1;
        }
        done(n ? (y / n) * 0.95 : null);
      } catch {
        done(null);
      }
    };
    img.src = url;
  });
  lightInflight.set(url, p);
  return p;
}
