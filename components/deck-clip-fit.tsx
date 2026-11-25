"use client";

import { useEffect } from "react";

/**
 * DeckClipFit — a song whose video is NOT a full-frame picture (an "Official Audio" / album-art video: a square cover floating in a white or black 16:9 frame, or an old 4:3 clip) used to show as a small box with a
 * gap at the deck's edge (owner 2026-11-25: "the video is cut, pull it to the side, a square video should sit differently"). This measures the video's thumbnail ONCE per song (a 64×36 canvas), finds where the
 * picture really is, and — only when it covers clearly less than the whole frame — publishes where to put it: scale it up to the deck's height and push it flush to the deck's outer edge.
 * A normal full-frame video measures as "full" and is never touched. DISPLAY ONLY: it reads the page, writes five CSS variables + one attribute on the deck, and never touches playback, state or the iframe itself
 * (the CSS in app/globals.css does the moving). Renders null. If the thumbnail cannot be read nothing changes.
 */

type Box = { x0: number; x1: number; y0: number; y1: number };
const cache = new Map<string, Box | null>();

function videoIdOf(src: string): string | null {
  const m = /\/embed\/([\w-]{11})/.exec(src);
  return m ? m[1] : null;
}

/** PURE: the picture's box (fractions of the frame) in an RGBA pixel grid, or null when it fills (nearly) the whole frame width / there is none */
export function pictureBox(d: ArrayLike<number>, W: number, H: number): Box | null {
  const px = (x: number, y: number) => {
    const i = (y * W + x) * 4;
    return [d[i], d[i + 1], d[i + 2]];
  };
  const edge = px(0, Math.floor(H / 2));
  const dist = (a: number[], b: number[]) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
  // a column / row belongs to the PICTURE when a good part of it differs from the frame colour — a title or a logo in the frame's corner (a few pixels per column) must not widen the box
  const colDiffers = (x: number) => {
    let n = 0;
    for (let y = 2; y < H - 2; y++) if (dist(px(x, y), edge) > 40) n++;
    return n >= 0.3 * (H - 4);
  };
  const rowDiffers = (y: number) => {
    let n = 0;
    for (let x = 2; x < W - 2; x++) if (dist(px(x, y), edge) > 40) n++;
    return n >= 0.3 * (W - 4);
  };
  let x0 = 0, x1 = W - 1, y0 = 0, y1 = H - 1;
  while (x0 < W && !colDiffers(x0)) x0++;
  while (x1 > 0 && !colDiffers(x1)) x1--;
  while (y0 < H && !rowDiffers(y0)) y0++;
  while (y1 > 0 && !rowDiffers(y1)) y1--;
  if (x1 <= x0 || y1 <= y0) return null;
  const box = { x0: x0 / W, x1: (x1 + 1) / W, y0: y0 / H, y1: (y1 + 1) / H };
  // a picture that fills most of the frame width is a normal video: leave it alone
  return box.x1 - box.x0 > 0.82 ? null : box;
}

/** the picture's box in the thumbnail as fractions (0–1) of the frame, or null when it fills (nearly) the whole frame or cannot be read */
function measure(id: string): Promise<Box | null> {
  if (cache.has(id)) return Promise.resolve(cache.get(id) ?? null);
  return new Promise((resolve) => {
    const done = (b: Box | null) => {
      cache.set(id, b);
      resolve(b);
    };
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onerror = () => done(null);
    img.onload = () => {
      try {
        const W = 64, H = 36;
        const c = document.createElement("canvas");
        c.width = W;
        c.height = H;
        const g = c.getContext("2d");
        if (!g) return done(null);
        g.drawImage(img, 0, 0, W, H);
        done(pictureBox(g.getImageData(0, 0, W, H).data, W, H));
      } catch {
        done(null); // tainted / unreadable → no change
      }
    };
    img.src = `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
  });
}

function clear(deck: HTMLElement) {
  if (deck.hasAttribute("data-sb-clip-fit")) {
    deck.removeAttribute("data-sb-clip-fit");
    for (const k of ["--sb-clip-tx", "--sb-clip-ty", "--sb-clip-z", "--sb-clip-w"]) deck.style.removeProperty(k);
  }
}

export function DeckClipFit() {
  useEffect(() => {
    let lastId = "";
    let alive = true;
    const tick = () => {
      const deck = document.querySelector<HTMLElement>(".audio-player-library-deck");
      const f = deck?.querySelector<HTMLIFrameElement>(".sb-deck-video-bg iframe");
      if (!deck || !f || f.dataset.sbShown !== "1") {
        if (deck) clear(deck);
        lastId = "";
        return;
      }
      const id = videoIdOf(f.src);
      if (!id) {
        clear(deck);
        return;
      }
      if (id !== lastId) {
        lastId = id;
        clear(deck);
      }
      void measure(id).then((box) => {
        if (!alive || !box || lastId !== id || !deck.isConnected) return;
        const w = f.offsetWidth, h = f.offsetHeight; // layout size (a transform does not change it)
        if (w <= 0 || h <= 0) return;
        const z = Math.min(1.7, Math.max(1, 1 / (box.y1 - box.y0)));
        const rtl = getComputedStyle(deck).direction === "rtl";
        const cy = (box.y0 + box.y1) / 2;
        const tx = rtl ? -w / 2 - z * w * (box.x0 - 0.5) : w / 2 - z * w * (box.x1 - 0.5); // the picture's OUTER edge flush to the deck's outer edge
        const ty = -z * h * (cy - 0.5); // the picture centred vertically
        const pw = z * w * (box.x1 - box.x0); // the picture's width on screen
        // how much of the (moved, enlarged) frame is inside the deck, measured from the deck's outer edge: the deck's edge-fade is anchored on this, so the frame's own edge melts instead of showing as a line
        const bgW = f.offsetParent instanceof HTMLElement ? f.offsetParent.offsetWidth : w;
        const vis = rtl ? f.offsetLeft + w / 2 + (z * w) / 2 + tx : bgW - (f.offsetLeft + w / 2 - (z * w) / 2 + tx);
        const set = (k: string, v: string) => {
          if (deck.style.getPropertyValue(k) !== v) deck.style.setProperty(k, v);
        };
        set("--sb-clip-tx", `${Math.round(tx)}px`);
        set("--sb-clip-ty", `${Math.round(ty)}px`);
        set("--sb-clip-z", z.toFixed(3));
        set("--sb-clip-w", `${Math.round(Math.max(pw + 20, Math.min(vis, pw + 260)))}px`); // the fade starts at the frame's own edge (at most 260px beyond the picture), so the frame melts into the deck and the picture stays solid
        if (!deck.hasAttribute("data-sb-clip-fit")) deck.setAttribute("data-sb-clip-fit", "1");
      });
    };
    const id = window.setInterval(tick, 1500);
    tick();
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);
  return null;
}
