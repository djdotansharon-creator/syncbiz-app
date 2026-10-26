/**
 * The cover's MAIN colours for the display screen's background (owner 2026-10-25: "take strong colours that build the background", "the colours must match the song",
 * "a white cover should give a WHITE screen with black text"). Display-only and client-only: pixels are read ONCE from a 32×32 downscale on a canvas (the same way
 * lib/song-accent.ts does — YouTube thumbnails allow cross-origin reads) and counted by AREA: the hue that covers most of the picture leads, a second / third hue joins only
 * when it really is a big part of the cover, and a cover of one colour gets close neighbours of it. What is read is a `CoverInfo`:
 *   · the main hues (+ their saturation and share),
 *   · whether the cover is grey / black-and-white,
 *   · how bright the whole cover is (`light` → the display switches to its white look by itself).
 * A cover that is MOSTLY dark / grey (a charcoal cover with one bright title) is not built from its few bright pixels (that made a yellow title into an olive-green screen, owner 2026-10-26):
 * the screen becomes calm GRAPHITE in the cover's own tint, with only a faint touch of its accent colour (`tint`, `touchy()` below).
 * `paletteFor(info, theme)` then turns that into four glow colours for the dark or the light look (the dark look is kept dark enough for white text; the light look keeps the
 * colours bright and fresh for dark text). A cover that cannot be read (a host without CORS) gets colours seeded from the title. Results are cached per cover.
 */

export type Palette = [string, string, string, string];
export type Main = { hue: number; sat: number; share: number };
/** the tint of the neutral (dark / grey) part of a cover that is MOSTLY neutral — a charcoal cover with a yellow title has a cool slate tint and one bright accent */
export type Tint = { hue: number; sat: number };
export type CoverInfo = { main: Main[]; none: boolean; grey: boolean; lum: number; light: boolean; seed: string | null; tint?: Tint | null };

/** nothing playing / no cover yet: the two-colour yellow + orange set */
export const NO_COVER: CoverInfo = { main: [], none: true, grey: false, lum: 0.1, light: false, seed: null };

/** the display's colours when nothing is playing: TWO colours only — a warm yellow and an orange (owner: the old blue-purple set was "too AI") */
export const DEFAULT_PALETTE: Palette = ["hsl(40 96% 46%)", "hsl(12 88% 42%)", "hsl(26 94% 40%)", "hsl(36 90% 34%)"];
const DEFAULT_LIGHT: Palette = ["hsl(42 100% 56%)", "hsl(16 96% 60%)", "hsl(30 100% 58%)", "hsl(46 100% 62%)"];

/** a cover whose average brightness (relative luminance) is at least this is a "white" cover → the display goes light */
const LIGHT_LUM = 0.46;

const cache = new Map<string, CoverInfo>();
const inflight = new Map<string, Promise<CoverInfo>>();

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const lumOf = (rgb: [number, number, number]) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);

/**
 * One glow colour. Dark look: full strength, darkened only as far as white text needs (a yellow stays a GOLD — never darkened into olive mud).
 * Light look: bright and fresh, no darkening (the text on it is dark).
 */
function glow(h: number, s: number, l: number, light: boolean): string {
  const hue = ((h % 360) + 360) % 360;
  let level = l;
  if (!light) {
    const gold = hue >= 38 && hue <= 82; // yellows / ambers: keep them gold, accept a brighter glow
    const floor = gold ? 0.42 : 0.3;
    const maxLum = gold ? 0.4 : 0.27;
    let rgb = hslToRgb(hue, s, level);
    while (level > floor && lumOf(rgb) > maxLum) {
      level -= 0.02;
      rgb = hslToRgb(hue, s, level);
    }
  }
  return `hsl(${Math.round(hue)} ${Math.round(s * 100)}% ${Math.round(level * 100)}%)`;
}

/**
 * Four colours from the main ones: the biggest leads (and gets a deeper twin); the second joins only when it is a real part of the cover; a one-colour cover gets
 * close neighbours of its colour for the rest.
 */
/** the neighbouring hues of a one-colour cover: yellows drift toward AMBER (never toward lime / green — that is what made a yellow cover olive) */
const drift = (hue: number, d: number): number => hue + (d > 0 && hue >= 40 && hue <= 82 ? -d : d);

function build(m: Main[], light: boolean): Palette {
  const [p, q, r] = m;
  const base = p ?? { hue: 226, sat: 0.85, share: 1 };
  // the light look is for dark text, so its colours can be MUCH stronger than a pastel: mid-lightness, high saturation (owner 2026-10-26: "in the white look the colours are barely felt")
  const sat = (x: number) => (light ? Math.min(1, Math.max(0.78, x * 1.15)) : Math.min(0.95, Math.max(0.62, x * 1.1)));
  const L = light ? { a: 0.56, b: 0.6, c: 0.5, d: 0.64 } : { a: 0.48, b: 0.46, c: 0.34, d: 0.44 };
  const c1 = glow(base.hue, sat(base.sat), L.a, light);
  const c2 = q ? glow(q.hue, sat(q.sat), L.b, light) : glow(drift(base.hue, 14), sat(base.sat), light ? L.b : 0.42, light);
  const c3 = glow(drift(base.hue, -8), sat(base.sat), L.c, light);
  const c4 = r ? glow(r.hue, sat(r.sat), L.d, light) : q ? glow(q.hue, sat(q.sat), light ? L.d : 0.36, light) : glow(drift(base.hue, 26), sat(base.sat), L.d, light);
  return [c1, c2, c3, c4];
}

/** a cover that is mostly neutral keeps its cool / warm tint only a whisper; the accent colour (yellow title, red logo …) is a faint warm touch, a hair toward amber if it is a yellow */
const warm = (hue: number): number => (hue >= 40 && hue <= 80 ? hue - 5 : hue);
function touchy(tint: Tint, accent: Main | undefined, light: boolean): Palette {
  const H = tint.sat >= 0.05 ? tint.hue : 228; // a perfectly neutral cover gets a calm blue-graphite
  const a = accent ?? { hue: H, sat: 0.4, share: 1 };
  if (light) {
    const g = (dh: number, sat: number, l: number) => `hsl(${Math.round((H + dh + 360) % 360)} ${sat}% ${l}%)`;
    return [g(0, 9, 80), g(10, 11, 74), g(-5, 7, 85), `hsl(${Math.round(warm(a.hue))} 70% 66%)`];
  }
  const g = (dh: number, sat: number, l: number) => `hsl(${Math.round((H + dh + 360) % 360)} ${sat}% ${l}%)`;
  const touch = `hsl(${Math.round(warm(a.hue))} ${Math.round(Math.min(0.62, Math.max(0.42, a.sat * 0.85)) * 100)}% 25%)`;
  return [g(0, 10, 24), g(10, 12, 19), g(-5, 8, 27), touch];
}

/** a grey / black-and-white cover: soft graphite (dark look) or soft silver (light look) — never an invented colour */
function neutral(lum: number, light: boolean): Palette {
  if (light) {
    const l = Math.min(0.86, Math.max(0.7, 0.66 + lum * 0.2));
    const g = (dl: number, h: number) => `hsl(${h} 6% ${Math.round((l + dl) * 100)}%)`;
    return [g(-0.04, 222), g(-0.1, 214), g(0.02, 230), g(-0.14, 220)];
  }
  const l = Math.min(0.6, Math.max(0.26, 0.2 + Math.sqrt(lum) * 0.36));
  const g = (dl: number, h: number) => `hsl(${h} 7% ${Math.round((l + dl) * 100)}%)`;
  return [g(0.04, 222), g(-0.04, 214), g(0.09, 230), g(-0.08, 220)];
}

/** four colours from a text — for covers whose pixels the browser will not let us read */
function seeded(seed: string): Main[] {
  let x = 2166136261;
  for (let i = 0; i < seed.length; i++) x = Math.imul(x ^ seed.charCodeAt(i), 16777619);
  const h = Math.abs(x) % 360;
  return [
    { hue: h, sat: 0.82, share: 0.6 },
    { hue: h + 40, sat: 0.8, share: 0.3 },
  ];
}

/** The four glow colours of a cover for the dark or the light look. */
export function paletteFor(info: CoverInfo, theme: "dark" | "light"): Palette {
  const light = theme === "light";
  if (info.none) return light ? DEFAULT_LIGHT : DEFAULT_PALETTE;
  if (info.grey) return neutral(info.lum, light);
  if (info.tint) return touchy(info.tint, info.main[0], light);
  return build(info.main, light);
}

const BINS = 24;
/** a second / third hue must cover at least this much of the colourful part of the picture to count as a main colour */
const MIN_SHARE = 0.18;
/** a cover whose colourful pixels are fewer than this share of the picture is "mostly neutral" (graphite look + a faint touch of its accent). Measured on the owner's library: the charcoal cover with a
 *  yellow title has 4 %; covers with a real coloured subject have 15 % and more and keep their colours. */
const NEUTRAL_SHARE = 0.12;

function failed(seed: string, url: string): CoverInfo {
  return { main: seeded(seed || url), none: false, grey: false, lum: 0.2, light: false, seed: seed || url };
}

/** Forget a read that is still pending for this cover (the display asks again when its window comes back to the front). */
export function forgetPending(url: string | null | undefined): void {
  if (url) inflight.delete(url);
}

/** What the display needs to know about a cover (never rejects). `seed` (the song's title) is only used when the cover cannot be read. */
export function coverInfo(url: string | null | undefined, seed: string): Promise<CoverInfo> {
  if (!url) return Promise.resolve(NO_COVER);
  const hit = cache.get(url);
  if (hit) return Promise.resolve(hit);
  const pending = inflight.get(url);
  if (pending) return pending;
  const p = new Promise<CoverInfo>((resolve) => {
    let settled = false;
    const done = (v: CoverInfo, keep = true) => {
      if (settled) return;
      settled = true;
      clearTimeout(giveUp);
      if (keep) cache.set(url, v);
      inflight.delete(url);
      resolve(v);
    };
    // a read that never answers (a page that was frozen in the background, a stalled image) must not block this cover for ever: answer with title colours, remember nothing, try again next time
    const giveUp = setTimeout(() => done(failed(seed, url), false), 9000);
    if (typeof document === "undefined") return done(NO_COVER);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onerror = () => done(failed(seed, url));
    img.onload = () => {
      try {
        const S = 32;
        const c = document.createElement("canvas");
        c.width = S;
        c.height = S;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        if (!ctx) return done(failed(seed, url));
        const sc = Math.max(S / (img.naturalWidth || S), S / (img.naturalHeight || S));
        const w = (img.naturalWidth || S) * sc;
        const h = (img.naturalHeight || S) * sc;
        ctx.drawImage(img, (S - w) / 2, (S - h) / 2, w, h); // the centre of the cover (YouTube stills carry black bars at the edges)
        const d = ctx.getImageData(0, 0, S, S).data;
        const weight = new Array<number>(BINS).fill(0);
        const sSum = new Array<number>(BINS).fill(0);
        const hSin = new Array<number>(BINS).fill(0);
        const hCos = new Array<number>(BINS).fill(0);
        let total = 0;
        let lumSum = 0;
        let n = 0;
        let colourPx = 0;
        let nr = 0;
        let ng = 0;
        let nb = 0;
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i]! / 255;
          const g = d[i + 1]! / 255;
          const b = d[i + 2]! / 255;
          lumSum += lumOf([r, g, b]);
          n++;
          const [hue, s, v] = rgbToHsv(r, g, b);
          if (s < 0.3 || v < 0.2) {
            nr += r; // greys, whites and darks are not "a colour" — but their average tint is kept
            ng += g;
            nb += b;
            continue;
          }
          colourPx++;
          const wgt = s * (0.4 + 0.6 * v); // AREA first: a big calm red beats a small bright yellow
          const bin = Math.floor(hue / (360 / BINS)) % BINS;
          weight[bin]! += wgt;
          sSum[bin]! += s * wgt;
          hSin[bin]! += Math.sin((hue * Math.PI) / 180) * wgt;
          hCos[bin]! += Math.cos((hue * Math.PI) / 180) * wgt;
          total += wgt;
        }
        const lum = n ? lumSum / n : 0.1;
        let tint: Tint | null = null;
        const neutralPx = n - colourPx;
        if (neutralPx > 0 && colourPx / n < NEUTRAL_SHARE && total >= 0.6) {
          const [th, ts] = rgbToHsv(nr / neutralPx, ng / neutralPx, nb / neutralPx);
          tint = { hue: th, sat: ts };
        }
        const light = lum >= LIGHT_LUM;
        if (total < 0.6) return done({ main: [], none: false, grey: true, lum, light, seed: null }); // a grey / black-and-white cover
        // a colour sits across neighbouring bins (a red is 355° and 5°): rank each bin together with its two neighbours
        const at = (arr: number[], i: number) => arr[(i + BINS) % BINS]!;
        const peaks = Array.from({ length: BINS }, (_, i) => ({
          i,
          wt: at(weight, i - 1) + at(weight, i) + at(weight, i + 1),
          sin: at(hSin, i - 1) + at(hSin, i) + at(hSin, i + 1),
          cos: at(hCos, i - 1) + at(hCos, i) + at(hCos, i + 1),
          sat: at(sSum, i - 1) + at(sSum, i) + at(sSum, i + 1),
        }));
        const taken = new Array<boolean>(BINS).fill(false);
        const main: Main[] = [];
        for (const pk of [...peaks].sort((a, b) => b.wt - a.wt)) {
          if (pk.wt <= 0 || taken[pk.i]) continue;
          const share = pk.wt / total;
          if (main.length > 0 && share < MIN_SHARE) break;
          main.push({ hue: ((Math.atan2(pk.sin, pk.cos) * 180) / Math.PI + 360) % 360, sat: pk.sat / pk.wt, share });
          for (let k = -2; k <= 2; k++) taken[(pk.i + k + BINS) % BINS] = true; // one colour only once (±30°)
          if (main.length === 3) break;
        }
        done({ main, none: false, grey: false, lum, light, seed: null, tint });
      } catch {
        done(failed(seed, url)); // a tainted canvas
      }
    };
    img.src = url;
  });
  inflight.set(url, p);
  return p;
}
