"use client";

import { useEffect, useState } from "react";

/**
 * Average color of an image, for the card hover halo (2026-07-17 tile design)
 * and for contrast-aware controls over artwork.
 *
 * Sampling uses a DETACHED Image with crossOrigin — the displayed <img> is never
 * touched (adding crossOrigin to it would break covers from non-CORS hosts).
 * Hosts without CORS simply fall back to `null` (callers use a neutral halo).
 */
const cache = new Map<string, { r: number; g: number; b: number } | null>();

function sample(src: string): Promise<{ r: number; g: number; b: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = 8;
        c.height = 8;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, 8, 8);
        const d = ctx.getImageData(0, 0, 8, 8).data;
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] < 32) continue;
          r += d[i];
          g += d[i + 1];
          b += d[i + 2];
          n++;
        }
        if (!n) return resolve(null);
        resolve({ r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) });
      } catch {
        resolve(null); // tainted canvas / decode issue — neutral fallback
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Relative luminance 0..1 — pick black vs white controls over this color. */
export function rgbLuminance(c: { r: number; g: number; b: number }): number {
  return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
}

export function useDominantColor(src: string | null | undefined): { r: number; g: number; b: number } | null {
  const [color, setColor] = useState<{ r: number; g: number; b: number } | null>(() =>
    src ? (cache.get(src) ?? null) : null,
  );
  useEffect(() => {
    let alive = true;
    /* Async on purpose — the lint rule forbids synchronous setState in effects. */
    const resolveCached = (v: { r: number; g: number; b: number } | null) => {
      void Promise.resolve().then(() => {
        if (alive) setColor(v);
      });
    };
    if (!src) {
      resolveCached(null);
    } else if (cache.has(src)) {
      resolveCached(cache.get(src) ?? null);
    } else {
      void sample(src).then((c) => {
        cache.set(src, c);
        if (alive) setColor(c);
      });
    }
    return () => {
      alive = false;
    };
  }, [src]);
  return color;
}
