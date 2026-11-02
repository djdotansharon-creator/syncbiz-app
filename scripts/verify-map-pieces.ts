/**
 * Owner 2026-11-02 — the Control Room map is ONE smooth block; the regions are pieces that complete each other like a puzzle (no gaps, no overlaps); the dots are flat Apple-style discs.
 * Run: npx tsx scripts/verify-map-pieces.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { MAP_OUTLINE, MAP_PIECES } from "../lib/control-room-map-pieces";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const rd = (p: string) => readFileSync(path.join(__dirname, "..", p), "utf-8").replace(/\r\n/g, "\n");
type Ring = ReadonlyArray<readonly [number, number]>;
const area = (r: Ring) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1]; return Math.abs(a) / 2; };
const inside = (x: number, y: number, r: Ring) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };

const IDS = ["north", "haifa", "sharon-shomron", "gush-dan", "shfela", "jerusalem-modiin", "south"];
const outline = MAP_OUTLINE[0];
assert("M1 ONE outline ring (one block — no separate islands) and the seven regions are all there", MAP_OUTLINE.length === 1 && IDS.every((i) => (MAP_PIECES[i] ?? []).length >= 1) && Object.keys(MAP_PIECES).length === 7);
const sum = IDS.reduce((s, i) => s + MAP_PIECES[i].reduce((a, r) => a + area(r), 0), 0);
assert("M2 the pieces add up to exactly the outline's area (a tiling: no gap, no overlap)", Math.abs(sum - area(outline)) < 2e-3, `pieces ${sum.toFixed(4)} vs outline ${area(outline).toFixed(4)}`);
// sample the whole land: every point inside the outline is in exactly ONE piece; no piece reaches outside
let bad = 0, n = 0, outside = 0;
const xs = outline.map((p) => p[0]), ys = outline.map((p) => p[1]);
for (let x = Math.min(...xs); x <= Math.max(...xs); x += 0.011) for (let y = Math.min(...ys); y <= Math.max(...ys); y += 0.011) {
  const inO = inside(x, y, outline); const hits = IDS.filter((i) => MAP_PIECES[i].some((r) => inside(x, y, r))).length;
  if (inO) { n++; if (hits !== 1) bad++; } else if (hits > 0) outside++;
}
assert("M3 every sampled point of the land lies in exactly one piece (a point exactly ON a shared edge may count on both sides: at most 3 of ~24,000), and no piece sticks out of the outline", bad <= 3 && outside === 0 && n > 2000, `${n} points, ${bad} not in exactly one piece, ${outside} outside`);
const branches: Array<[string, number, number]> = [["Karmiel", 35.3261, 32.9287], ["Ramat Gan", 34.8114, 32.0857], ["Raanana", 34.8815, 32.1933], ["Safed", 35.4982, 32.9578], ["Nesher", 35.0385, 32.7805], ["Tel Aviv", 34.7818, 32.0853], ["Jerusalem", 35.2137, 31.7683], ["Beer Sheva", 34.7913, 31.2518], ["Rishon", 34.7925, 31.973], ["Eilat", 34.95, 29.56], ["Haifa", 34.99, 32.82], ["Ashdod", 34.65, 31.8]];
assert("M4 the branches stay ON the land: every real branch location is inside the smooth outline", branches.filter(([, x, y]) => !inside(x, y, outline)).length === 0, branches.filter(([, x, y]) => !inside(x, y, outline)).map((b) => b[0]).join(","));
assert("M5 no needle at the north-east tip any more: the outline's north-east corner is rounded (no vertex sticks out more than 0.05° beyond the Chaikin-smooth neighbours)", (() => { let worst = 0; for (let i = 0; i < outline.length; i++) { const p = outline[i], a = outline[(i + outline.length - 1) % outline.length], b = outline[(i + 1) % outline.length]; const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2; worst = Math.max(worst, Math.hypot(p[0] - mx, p[1] - my)); } return worst < 0.05; })());

const v2 = rd("components/control-room/branch-map-v2.tsx");
assert("M6 the map draws the outline and the pieces RAW (rawPath — smoothing each piece again would open gaps), from lib/control-room-map-pieces.ts; the old land / region shapes are no longer used",
  /import \{ MAP_OUTLINE, MAP_PIECES \} from "@\/lib\/control-room-map-pieces"/.test(v2) && /MAP_OUTLINE\.map\(\(r\) => rawPath\(/.test(v2) && /MAP_PIECES\[id\]/.test(v2) && /rings\.map\(\(ring\) => rawPath\(ring\)\)/.test(v2) && !/LAND_RINGS|REGION_SHAPES/.test(v2));
assert("M7 the dots are FLAT Apple-style discs: colour disc + thin white ring + soft shadow; no sphere gradient, no highlight ellipse; the glow only for a playing branch",
  /<circle r=\{DOT_REF_R \+ 1\.2\} fill="#ffffff"/.test(v2) && /<circle r=\{DOT_REF_R - 0\.6\} fill=\{fill\}/.test(v2) && !/<ellipse/.test(v2) && !/radialGradient key=\{gid\} id=\{gid\}/.test(v2) && /look\.gid && look\.breathing && pulsing/.test(v2));
const gen = rd("tools/map/gen_map_pieces.py");
assert("M8 the geometry is reproducible: tools/map/gen_map_pieces.py + export-map-inputs.ts write lib/control-room-map-pieces.ts (the data file says it is generated)", /Writes lib\/control-room-map-pieces\.ts/.test(gen) && /GENERATED by tools\/map\/gen_map_pieces\.py/.test(rd("lib/control-room-map-pieces.ts")));
console.log(`\n${pass} passed, ${fail} failed`);
