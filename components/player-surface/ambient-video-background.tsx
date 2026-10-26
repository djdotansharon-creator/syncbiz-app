"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useLibraryTheme } from "@/lib/library-theme-context";
import { extractCoverLightness } from "@/lib/song-accent";

/** Brand mark follows the cover's lightness (black on light fields). Off per owner (2026-10-14): white only. */
const LOGO_FOLLOWS_COVER = false;

/**
 * Display modes (2026-10-12): "black" | "white" | "song".
 *  - black: neutral graphite look, no blue cast, no ambient wash.
 *  - white: the pearl-light look (library theme), light page frame.
 *  - song : graphite surfaces turned translucent + the current track's artwork blurred
 *           into a colour field over the whole page (this component's portal).
 * The mode lives in localStorage and is mirrored to html[data-sb-display]; the ambient
 * layer additionally sets html[data-sb-ambient="on"] while a track is loaded in "song".
 * Presentational only — never touches playback.
 *
 * Why the artwork and not a second video for the wash: a second YouTube player per page
 * would compete with the playback chain; at this blur radius the two are indistinguishable.
 */
export type DisplayMode = "black" | "white" | "song";

const STORAGE_KEY = "syncbiz:displayMode";
const LEGACY_AMBIENT_KEY = "syncbiz:ambientBg";
const CHANGE_EVENT = "syncbiz:display-mode-change";
const DEFAULT_MODE: DisplayMode = "song";

export function readDisplayMode(): DisplayMode {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === "black" || v === "white" || v === "song") return v;
    if (window.localStorage.getItem(LEGACY_AMBIENT_KEY) === "off") return "black";
    return DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

export function writeDisplayMode(mode: DisplayMode): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* private mode etc. — still works for this session */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribeMode(cb: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(CHANGE_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function useDisplayMode(): DisplayMode {
  return useSyncExternalStore(subscribeMode, readDisplayMode, () => DEFAULT_MODE);
}

/** The library visual theme that each display mode rides on. */
export function libraryThemeForMode(mode: DisplayMode): "graphite-black" | "pearl-light" {
  return mode === "white" ? "pearl-light" : "graphite-black";
}

const subscribeNoop = () => () => {};

/* Native fullscreen shows ONLY the fullscreen element and its descendants (over a black backdrop).
   The shell goes fullscreen (not <html>), so a body-level portal would vanish — host the colour
   field inside whatever element is fullscreen, and back on <body> when it ends. */
function subscribeFullscreen(cb: () => void): () => void {
  document.addEventListener("fullscreenchange", cb);
  document.addEventListener("webkitfullscreenchange", cb);
  return () => {
    document.removeEventListener("fullscreenchange", cb);
    document.removeEventListener("webkitfullscreenchange", cb);
  };
}
function readFullscreenHost(): HTMLElement | null {
  const d = document as Document & { webkitFullscreenElement?: Element | null };
  return (d.fullscreenElement ?? d.webkitFullscreenElement ?? null) as HTMLElement | null;
}

/**
 * The colour field as a tiny PRE-BLURRED canvas (96×54) that the GPU simply upscales — no CSS
 * blur on a full-screen layer any more (that was the single heaviest thing drawn every frame).
 * The blur/saturation run once, at draw time, on the canvas pixels. Browsers without canvas
 * filters (Safari) fall back to the old CSS filter on the element.
 */
/* Round 8 (owner: "when I pause and play — or leave the player window and come back — the background goes black like
   it is loading"): the finished 96×54 frame of every cover is kept as an ImageBitmap, so a (re)mounted canvas is painted
   synchronously in layout phase — there is never a black frame while the image loads again. */
const BITMAP_CACHE_MAX = 24;
const bitmapCache = new Map<string, ImageBitmap>();
const AMB_W = 96;
const AMB_H = 54;

function AmbientCanvas({ src, className }: { src: string; className?: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useLayoutEffect(() => {
    const c = ref.current;
    const bm = bitmapCache.get(src);
    if (!c || !bm) return;
    c.width = AMB_W;
    c.height = AMB_H;
    c.getContext("2d")?.drawImage(bm, 0, 0);
  }, [src]);
  useEffect(() => {
    const c = ref.current;
    if (!c || bitmapCache.has(src)) return;
    let cancelled = false;
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      if (cancelled) return;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      const W = AMB_W;
      const H = AMB_H;
      c.width = W;
      c.height = H;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      const canFilter = "filter" in ctx;
      if (canFilter) {
        ctx.filter = "blur(4px) saturate(1.8) brightness(0.95)"; // ≈ a 110px blur once upscaled
      } else {
        c.style.filter = "blur(28px) saturate(1.8) brightness(0.95)";
      }
      const sc = Math.max(W / (img.naturalWidth || W), H / (img.naturalHeight || H));
      const w = (img.naturalWidth || W) * sc;
      const h = (img.naturalHeight || H) * sc;
      ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
      if (canFilter && typeof createImageBitmap === "function") {
        void createImageBitmap(c)
          .then((bm) => {
            if (bitmapCache.size >= BITMAP_CACHE_MAX) {
              const first = bitmapCache.keys().next().value as string | undefined;
              if (first) {
                bitmapCache.get(first)?.close();
                bitmapCache.delete(first);
              }
            }
            bitmapCache.set(src, bm);
          })
          .catch(() => {});
      }
    };
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [src]);
  return <canvas ref={ref} className={className} aria-hidden />;
}

/* the cover last shown, kept across a remount of the player (leaving the window and coming back) */
let lastShownCover: string | null = null;
let unmountClear: ReturnType<typeof setTimeout> | null = null;
const HOLD_MS = 1600;

export function AmbientVideoBackground({
  cover,
  active,
}: {
  /** Artwork URL of the current track (thumbnail). */
  cover: string | null;
  /** True while a track is loaded (playing or paused). */
  active: boolean;
}) {
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);
  const fullscreenHost = useSyncExternalStore(subscribeFullscreen, readFullscreenHost, () => null);
  const mode = useDisplayMode();
  const { libraryTheme, setLibraryTheme } = useLibraryTheme();

  // Keep the library theme in step with the display mode (black/song → graphite, white → pearl).
  const wantTheme = libraryThemeForMode(mode);
  useEffect(() => {
    if (mounted && libraryTheme !== wantTheme) setLibraryTheme(wantTheme);
  }, [mounted, libraryTheme, wantTheme, setLibraryTheme]);

  useEffect(() => {
    if (!mounted) return;
    document.documentElement.setAttribute("data-sb-display", mode);
    // round 8: title block aligned with the disc by default; localStorage syncbiz:infoAlign = "top" restores the old height
    let info = "disc";
    try {
      if (window.localStorage.getItem("syncbiz:infoAlign") === "top") info = "top";
    } catch {
      /* ignore */
    }
    document.documentElement.setAttribute("data-sb-info", info);
  }, [mounted, mode]);

  /* The field is HELD through blips: pausing → playing passes through a ~100ms "loading" status (active=false) and a route
     change remounts the player — neither may blank the page. It goes only when the source is really gone (HOLD_MS) or the
     display mode changes; a new cover swaps in at once. */
  const target = mode === "song" && active && cover ? cover : null;
  const [held, setHeld] = useState<string | null>(() => target ?? lastShownCover);
  if (target && held !== target) setHeld(target);
  useEffect(() => {
    if (unmountClear) {
      clearTimeout(unmountClear);
      unmountClear = null;
    }
    return () => {
      unmountClear = setTimeout(() => {
        lastShownCover = null;
      }, 4000);
    };
  }, []);
  useEffect(() => {
    if (target) return;
    const t = setTimeout(() => {
      setHeld(null);
      lastShownCover = null;
    }, HOLD_MS);
    return () => clearTimeout(t);
  }, [target]);
  const current = mode === "song" ? (target ?? held) : null;
  useEffect(() => {
    if (current) lastShownCover = current;
  }, [current]);

  // Crossfade: remember the previous artwork so it stays underneath while the new one fades
  // in ("store information from previous renders" pattern — no refs in render, no setState in effects).
  const [slots, setSlots] = useState<{ cur: string | null; prev: string | null }>({ cur: current, prev: null });
  if (slots.cur !== current) {
    setSlots({ cur: current, prev: slots.cur });
  }
  const previous = slots.cur === current ? slots.prev : slots.cur;

  const on = mounted && current !== null;
  // Brand-mark contrast: html[data-sb-logo] = "light" (white mark on a dark field) | "dark" (black
  // mark on a light field), from the cover's lightness under the mark, with hysteresis so it never
  // flaps; the mark's CSS eases the colour change. White mode is always dark; no field → light.
  useEffect(() => {
    if (!mounted) return;
    const html = document.documentElement;
    if (!LOGO_FOLLOWS_COVER) {
      /* owner, 2026-10-14: the mark stays white for now; the flip below is kept for when it returns */
      html.setAttribute("data-sb-logo", "light");
      return;
    }
    if (mode === "white") {
      html.setAttribute("data-sb-logo", "dark");
      return;
    }
    if (!on || !current) {
      html.setAttribute("data-sb-logo", "light");
      return;
    }
    let alive = true;
    void extractCoverLightness(current).then((y) => {
      if (!alive || y == null) return;
      const prev = html.getAttribute("data-sb-logo");
      const next = y > 0.38 ? "dark" : y < 0.28 ? "light" : prev === "dark" ? "dark" : "light"; // hysteresis: no flapping
      html.setAttribute("data-sb-logo", next);
    });
    return () => {
      alive = false;
    };
  }, [mounted, mode, on, current]);
  useEffect(() => {
    document.documentElement.setAttribute("data-sb-ambient", on ? "on" : "off");
    return () => {
      document.documentElement.removeAttribute("data-sb-ambient");
    };
  }, [on]);

  if (!on) return null;
  return createPortal(
    <div className="sb-ambient" aria-hidden>
      {previous && previous !== current ? <AmbientCanvas key={previous} src={previous} className="sb-ambient-img" /> : null}
      <AmbientCanvas key={current!} src={current!} className="sb-ambient-img is-new" />
      <div className="sb-ambient-veil" />
    </div>,
    fullscreenHost ?? document.body,
  );
}
