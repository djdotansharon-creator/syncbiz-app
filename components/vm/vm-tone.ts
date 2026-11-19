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

/**
 * REMEMBERED COLOURS (owner 2026-11-19: "when I load the player it shows the branch's colour first and only then the song's — I want the song's colour at once"). The colour of a picture is read from
 * the picture, which needs the picture to load — a second or two after the page. So every colour that was read is remembered on the phone (per picture, and "the last one shown"): the next open paints the
 * song's colour on the FIRST frame. And while a colour is being read, nothing is made up from a NAME any more (that was the "branch colour" first, then another, then the song's).
 */
const TONE_KEY = "vono-mobile-tone-v1:";
const LAST_TONE_KEY = "vono-mobile-tone-last-v1";
function readHs(key: string): Hs | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Hs>;
    return typeof v.h === "number" && typeof v.s === "number" && Number.isFinite(v.h) && Number.isFinite(v.s) ? { h: v.h, s: v.s } : null;
  } catch {
    return null;
  }
}
function writeHs(key: string, hs: Hs): void {
  try {
    localStorage.setItem(key, JSON.stringify({ h: Math.round(hs.h), s: Math.round(hs.s * 100) / 100 }));
  } catch {
    /* only a help */
  }
}
/** the colour remembered for this picture (null = never read) */
export function rememberedTone(url: string | null | undefined): Hs | null {
  return url ? readHs(TONE_KEY + url) : null;
}
/** the last colour any song showed on this phone (null = none yet) */
export function lastTone(): Hs | null {
  return readHs(LAST_TONE_KEY);
}

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
  const known = readHs(TONE_KEY + url);
  if (known) {
    const done = Promise.resolve<Hs | null>(known);
    cache.set(url, done);
    return done;
  }
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
        const hs = tone ? hexToHs(tone.c2) : null;
        if (hs) writeHs(TONE_KEY + url, hs);
        done(hs);
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
export function toneVars(hs: Hs, deep = false): CSSProperties {
  const s = Math.min(0.7, Math.max(0.06, hs.s));
  // `deep` = a darker shade of the same hue (a person's page: "more dark") — the song's own background stays as it is
  return {
    ["--vm-t1" as string]: `hsl(${Math.round(hs.h)} ${Math.round(s * 85)}% ${deep ? 21 : 30}%)`,
    ["--vm-t2" as string]: `hsl(${Math.round(hs.h)} ${Math.round(s * 72)}% ${deep ? 10 : 15}%)`,
  } as CSSProperties;
}

/**
 * The colour of a cover as CSS variables (`--vm-t1`, `--vm-t2`). While a new picture is being read the previous colour stays (then glides), so a track change is one
 * smooth move, not a flash through the name's colour. `calm` = nothing plays: a quiet, nearly neutral tint of the name.
 */
export function useCoverTone(cover: string | null | undefined, name: string, calm = false, /** this is the colour of what the branch PLAYS (not a picture in a list): remembered as "the last song's colour" for the next open */ nowPlaying = false): CSSProperties {
  // the first frame: the colour remembered for THIS picture, else the last song's colour — read after mount (the server renders without a phone's storage); `null` = the neutral dark, never a colour made from a name
  const [got, setGot] = useState<Hs | null>(null);
  const [settled, setSettled] = useState(false); // true once the picture's own answer is in (a colour, or "cannot be read")
  useEffect(() => {
    let alive = true;
    const quick = rememberedTone(cover) ?? (nowPlaying ? lastTone() : null);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the remembered colour of a phone's storage, read once the picture is known
    if (quick) setGot((cur) => cur ?? quick);
    setSettled(false);
    void (cover ? sampleHs(cover) : Promise.resolve(null)).then((hs) => {
      if (!alive) return;
      if (hs) {
        setGot(hs);
        if (nowPlaying) writeHs(LAST_TONE_KEY, hs);
      }
      setSettled(true);
    });
    return () => {
      alive = false;
    };
  }, [cover, nowPlaying]);
  if (calm) return toneVars({ h: nameHue(name || "·"), s: 0.1 });
  // a colour is made from the NAME only when the picture has really answered "no colour" (none, or it cannot be read) and nothing was remembered — never while it is still loading
  return toneVars(got ?? (settled ? nameHs(name) : NEUTRAL_HS));
}

/** the neutral dark of the app before any colour is known (the same one the CSS starts from) */
const NEUTRAL_HS: Hs = { h: 240, s: 0.06 };

/** the colour of what the SELECTED branch plays now (for the dock's mini-player, the Now Playing sheet, a branch's screen) */
export function useNowTone(): CSSProperties {
  const f = useMobileFleet();
  const b = f.selected;
  const s = f.display.shown;
  const cover = s?.currentTrack?.cover ?? s?.currentSource?.cover ?? null;
  const title = s?.currentTrack?.title || s?.currentSource?.title || "";
  // the phone is still connecting (the branch's state has not arrived): the song that played last stays — its colour, at once — instead of a "branch colour" that is replaced a moment later
  const connecting = !!b && (b.status === "unknown" || (b.online && !s));
  const quiet = !b || (!b.online && !connecting) || !s || s.status === "idle" || s.status === "stopped";
  return useCoverTone(quiet ? null : cover, title || b?.name || "", quiet && !connecting, true);
}
