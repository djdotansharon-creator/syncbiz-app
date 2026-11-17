"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { toneFromPixels } from "@/lib/schedules-timeline";
import { useMobileFleet } from "@/lib/mobile-fleet";
import { nameHue } from "@/components/vm/vm-parts";

/**
 * THE SONG'S COLOURS (owner 2026-11-17: "why isn't the background in the colours of the song?") — the Now Playing sheet, the mini-player and a branch's screen
 * take the colour of the cover that plays, like Apple Music. A small copy of the picture is read (the same reading the Schedules Studio uses for its blocks:
 * `toneFromPixels` = the picture's most vivid hue; a grey picture gives a calm grey). When the picture cannot be read (a server that does not allow it), or there is none,
 * the colour comes from the name — the same one the cover's tile wears — so there is never a "no colour" state. The colour glides on a change (CSS `@property` in mobile-app.css).
 */
export type Hs = { h: number; s: number };

const cache = new Map<string, Promise<Hs | null>>();

function hexToHs(hex: string): Hs | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return null;
  const r = parseInt(m[1]!, 16) / 255;
  const g = parseInt(m[2]!, 16) / 255;
  const b = parseInt(m[3]!, 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: ((h * 60) % 360 + 360) % 360, s };
}

/** the hue / saturation of a picture, read once per picture; null when it cannot be read */
function sampleHs(url: string): Promise<Hs | null> {
  const hit = cache.get(url);
  if (hit) return hit;
  const p = new Promise<Hs | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.referrerPolicy = "no-referrer";
    let timer = 0;
    const done = (v: Hs | null) => {
      window.clearTimeout(timer);
      resolve(v);
    };
    timer = window.setTimeout(() => done(null), 8000);
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = 24;
        c.height = 24;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        if (!ctx) return done(null);
        ctx.drawImage(img, 0, 0, 24, 24);
        const tone = toneFromPixels(ctx.getImageData(0, 0, 24, 24).data);
        done(tone ? hexToHs(tone.c2) : null);
      } catch {
        done(null);
      }
    };
    img.onerror = () => done(null);
    img.src = url;
  });
  cache.set(url, p);
  return p;
}

const nameHs = (name: string): Hs => ({ h: nameHue(name || "·"), s: 0.42 });

/** the two colours the dark backgrounds are drawn from: a deeper (top) and a darker (bottom) shade of the song's hue */
export function toneVars(hs: Hs): CSSProperties {
  const s = Math.min(0.7, Math.max(0.06, hs.s));
  return {
    ["--vm-t1" as string]: `hsl(${Math.round(hs.h)} ${Math.round(s * 85)}% 30%)`,
    ["--vm-t2" as string]: `hsl(${Math.round(hs.h)} ${Math.round(s * 72)}% 15%)`,
  } as CSSProperties;
}

/**
 * The colour of a cover as CSS variables (`--vm-t1`, `--vm-t2`). While a new picture is being read the previous colour stays (then glides), so a track change is one
 * smooth move, not a flash through the name's colour. `calm` = nothing plays: a quiet, nearly neutral tint of the name.
 */
export function useCoverTone(cover: string | null | undefined, name: string, calm = false): CSSProperties {
  const [got, setGot] = useState<Hs | null>(null);
  useEffect(() => {
    let alive = true;
    void (cover ? sampleHs(cover) : Promise.resolve(null)).then((hs) => {
      if (alive) setGot(hs ?? nameHs(name));
    });
    return () => {
      alive = false;
    };
  }, [cover, name]);
  if (calm) return toneVars({ h: nameHue(name || "·"), s: 0.1 });
  return toneVars(got ?? nameHs(name));
}

/** the colour of what the SELECTED branch plays now (for the dock's mini-player, the Now Playing sheet, a branch's screen) */
export function useNowTone(): CSSProperties {
  const f = useMobileFleet();
  const b = f.selected;
  const s = f.display.shown;
  const cover = s?.currentTrack?.cover ?? s?.currentSource?.cover ?? null;
  const title = s?.currentTrack?.title || s?.currentSource?.title || "";
  const quiet = !b || !b.online || !s || s.status === "idle" || s.status === "stopped";
  return useCoverTone(quiet ? null : cover, title || b?.name || "", quiet);
}
