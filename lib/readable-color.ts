/**
 * Keep a brand colour readable on a white or a black square (owner 2026-11-02: the branch letter keeps its brand colour, the
 * square is white or black). A colour that already reads (contrast >= `min`) is returned UNCHANGED; only one that does not
 * (yellow / green on white, dark blue on black) is mixed toward black / white in small steps — same hue, just enough.
 * Pure — hex colours only (anything else is returned as is).
 */

function parseHex(c: string): [number, number, number] | null {
  const m = c.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((x) => x + x).join("") : m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function luminance([r, g, b]: [number, number, number]): number {
  const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG contrast ratio between two hex colours; 0 when either is not a hex colour. */
export function contrastRatio(a: string, b: string): number {
  const x = parseHex(a), y = parseHex(b);
  if (!x || !y) return 0;
  const l1 = luminance(x), l2 = luminance(y);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

const toHex = (c: [number, number, number]) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

/** `color` if it reads on `bg` (>= min), otherwise the closest same-hue colour that does (toward black on a light bg, toward white on a dark one). */
export function readableOn(color: string, bg: string, min = 3): string {
  const c = parseHex(color), b = parseHex(bg);
  if (!c || !b) return color;
  if (contrastRatio(color, bg) >= min) return color;
  const target: [number, number, number] = luminance(b) > 0.5 ? [0, 0, 0] : [255, 255, 255];
  for (let t = 0.04; t <= 0.8; t += 0.04) {
    const mixed = toHex([c[0] + (target[0] - c[0]) * t, c[1] + (target[1] - c[1]) * t, c[2] + (target[2] - c[2]) * t]);
    if (contrastRatio(mixed, bg) >= min) return mixed;
  }
  return toHex(target);
}
