import { toneFromPixels } from "@/lib/schedules-timeline";

/**
 * THE SONG'S COLOUR, read from its picture — and remembered. (Split out of components/vm/vm-tone.ts 2026-11-19 so the fleet can WARM a colour — read it before it is needed — without a circular import.)
 *
 * The colour of a picture is read from the picture, which needs the picture to load. So every colour that was read is remembered on the phone (per picture, and "the last one shown"): the next open
 * paints the song's colour on the FIRST frame. A picture that is about to be shown (the song a person just chose, the next one in the list) is read ahead (`warmTone`), so its colour is ready when the song appears.
 */
export type Hs = { h: number; s: number };

const cache = new Map<string, Promise<Hs | null>>();

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
/** remember this colour as "the last song's" (for the next open) */
export function rememberLastTone(hs: Hs): void {
  writeHs(LAST_TONE_KEY, hs);
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

/** the hue / saturation of a picture, read once per picture; null when it cannot be read (and then it is NOT kept as an answer: a later try may succeed — a blip must not stick for the whole session) */
export function sampleHs(url: string): Promise<Hs | null> {
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
      if (!v) cache.delete(url);
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

/** read a picture's colour AHEAD of the moment it is shown (the song just chosen, the next one) — nothing is shown, the answer is kept for `sampleHs` */
export function warmTone(url: string | null | undefined): void {
  if (!url || typeof window === "undefined") return;
  void sampleHs(url);
}

/** `song` = a song plays: its picture's colour · `calm` = we KNOW nothing plays: a quiet tint of the name · `wait` = we do not know yet: what was remembered, never a name's colour */
export type ToneMode = "song" | "calm" | "wait";

export type ToneState = {
  /** the picture this state belongs to */
  cover: string | null;
  /** its colour (remembered or read) */
  hs: Hs | null;
  /** the colour that was on screen before this picture — it stays while the new one is being read */
  held: Hs | null;
  /** the picture has answered (a colour, or "no colour / cannot be read") */
  settled: boolean;
};

export type ToneDecision =
  | { use: "calm" }
  /** the picture's own colour */
  | { use: "own"; hs: Hs }
  /** the picture answered "no colour": the song's name makes the colour (NEVER the previous song's) */
  | { use: "name" }
  /** still reading / not known yet: the colour on screen stays (null = the neutral dark) */
  | { use: "stay"; hs: Hs | null };

/**
 * Which colour to show (pure — the rules the owner set 2026-11-19):
 *  - nothing is made up from a NAME while we do not know (a branch not read yet, a phone still connecting) — the "green at the start";
 *  - a new picture has its OWN answer: while it is read the colour on screen stays, and when it answers "no colour" the name's colour is used, not the previous song's — the "background did not change".
 */
export function decideTone(st: ToneState, pic: string | null, mode: ToneMode): ToneDecision {
  if (mode === "calm") return { use: "calm" };
  const mine = st.cover === pic;
  if (mine && st.hs) return { use: "own", hs: st.hs };
  if (mode === "song" && mine && st.settled) return { use: "name" };
  return { use: "stay", hs: (mine ? st.held : (st.hs ?? st.held)) ?? null };
}
