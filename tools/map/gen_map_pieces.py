"""
CONTROL ROOM map geometry generator (owner 2026-11-02: the map is ONE smooth block; the regions are pieces that complete each other like a puzzle).
Writes lib/control-room-map-pieces.ts. Needs shapely (pip install shapely numpy) and the two input files made by tools/map/export-map-inputs.ts:
    npx tsx tools/map/export-map-inputs.ts <dir>      # writes <dir>/land.json + <dir>/regions.json + <dir>/overrides.json
    cd <dir> && python3 <repo>/tools/map/gen_map_pieces.py 0.025 0.025 0.007 0.012 <repo>/lib/control-room-map-pieces.ts 3
Steps: (1) land = union of the land rings, needles cut (opening), grown a little, simplified, every corner rounded (Chaikin) = the outline;
(2) each region polygon is clipped to the outline; the land the regions do not cover (West Bank, Gaza, slivers) follows lib/control-room-regions.ts
(north of 31.98 -> Sharon & Shomron, the rest -> the nearest region); (3) pieces are rounded a little, then re-tiled EXACTLY (overlaps removed by subtraction,
gaps handed to the neighbour they touch most), so shared edges are identical and the union IS the outline; (the inner borders are rounded by the same buffer rounding of each piece, with a radius large enough that a zoomed region has no staircase).
"""
import json, sys, math
from shapely.geometry import Polygon, MultiPolygon, MultiPoint, Point, LineString, box
from shapely.ops import unary_union, voronoi_diagram, polygonize
from shapely.validation import make_valid

OPEN_R = float(sys.argv[1]) if len(sys.argv) > 1 else 0.025   # cuts needles / thin necks narrower than 2*r
CLOSE_R = float(sys.argv[2]) if len(sys.argv) > 2 else 0.025  # grows the land a little (coastal branches stay on land)
SIMP = float(sys.argv[3]) if len(sys.argv) > 3 else 0.007     # Douglas-Peucker tolerance (the outline uses 3x)

land = json.load(open("land.json")); regs = json.load(open("regions.json"))
def poly(r): return make_valid(Polygon(r))
L = unary_union([poly(r) for r in land])
def chaikin(coords, n):
    pts = list(coords)[:-1]
    for _ in range(n):
        out = []
        for k in range(len(pts)):
            p, q = pts[k], pts[(k + 1) % len(pts)]
            out.append((0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]))
            out.append((0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1]))
        pts = out
    return pts + [pts[0]]
# the sketch: cut needles (opening), grow a little so coastal branches stay on land, simplify hard, round every corner (Chaikin)
Lo = L.buffer(-OPEN_R, 16).buffer(OPEN_R, 16)
Lg = Lo.buffer(CLOSE_R, 16).simplify(SIMP * 3, preserve_topology=True)
if isinstance(Lg, MultiPolygon): Lg = max(Lg.geoms, key=lambda g: g.area)
Ls = Polygon(chaikin(Lg.exterior.coords, 5)).buffer(0)
print("sketch holes", len(Ls.interiors) if hasattr(Ls, "interiors") else "multi")
R = {r["id"]: unary_union([poly(x) for x in r["rings"]]) for r in regs}
ids = list(R.keys())
# municipal exceptions (lib/control-room-regions.ts checks them BEFORE the sub-districts): the city is drawn in the region its branches belong to, so a branch's dot never floats outside its region
import os
if os.path.exists("overrides.json"):
    for o in json.load(open("overrides.json")):
        O = unary_union([poly(x) for x in o["rings"]])
        for i in ids:
            R[i] = R[i].union(O) if i == o["region"] else R[i].difference(O)
        print("exception", o["name"], "->", o["region"])
# 1. exact region parts inside the sketch
P = {i: R[i].intersection(Ls) for i in ids}
# resolve overlaps between regions (should be none) by order
taken = Polygon()
for i in ids:
    P[i] = P[i].difference(taken); taken = unary_union([taken, P[i]])
left = Ls.difference(taken)
# 2. leftover: Judea & Samaria north of 31.98 -> sharon-shomron; the rest -> nearest region (Voronoi of densified region boundaries)
pts, lab = [], []
for i in ids:
    geoms = R[i].geoms if hasattr(R[i], "geoms") else [R[i]]
    for g in geoms:
        b = g.exterior
        n = max(8, int(b.length / 0.004))
        for k in range(n):
            q = b.interpolate(k / n, normalized=True); pts.append((q.x, q.y)); lab.append(i)
vor = voronoi_diagram(MultiPoint(pts), envelope=box(33.5, 28.5, 36.5, 34.0))
cells = {i: [] for i in ids}
from shapely.strtree import STRtree
pt_geoms = [Point(p) for p in pts]
tree = STRtree(pt_geoms)
for c in vor.geoms:
    # the generating point inside this cell
    idx = tree.query(c, predicate="contains")
    if len(idx): cells[lab[int(idx[0])]].append(c)
V = {i: unary_union(cells[i]) if cells[i] else Polygon() for i in ids}
north_wb = left.intersection(box(34.88, 31.98, 35.7, 32.7))
rest = left.difference(north_wb)
for i in ids:
    add = rest.intersection(V[i])
    if i == "sharon-shomron": add = unary_union([add, north_wb])
    P[i] = unary_union([P[i], add])
# 3. tidy: the union must be the sketch, pieces disjoint; clean dust
tot = unary_union(list(P.values()))
print("sketch area", round(Ls.area, 4), "pieces union", round(tot.area, 4), "gap", round(Ls.difference(tot).area, 6))
for i in ids:
    g = P[i]
    if isinstance(g, MultiPolygon):
        parts = sorted(g.geoms, key=lambda x: -x.area)
        P[i] = unary_union([x for x in parts if x.area > 0.0004])
# 4. smooth + simplify each piece, then re-tile EXACTLY: overlaps are resolved by subtraction (shared edges become identical), gaps are given to the neighbour they touch most
RS = float(sys.argv[4]) if len(sys.argv) > 4 else 0.012
PIECE_ROUND = int(sys.argv[6]) if len(sys.argv) > 6 else 3
def round_poly(g):
    # Chaikin corner cutting on every exterior ring of a piece (the re-tiling below keeps the pieces exact)
    gs = list(g.geoms) if hasattr(g, "geoms") else [g]
    out = []
    for p in gs:
        if p.is_empty or p.geom_type != "Polygon" or len(p.exterior.coords) < 4: continue
        out.append(Polygon(chaikin(p.exterior.coords, PIECE_ROUND)).buffer(0))
    return unary_union(out) if out else Polygon()
def soft(g):
    g = g.buffer(RS, 12).buffer(-2 * RS, 12).buffer(RS, 12)      # round corners, drop needles of a piece
    g = g.simplify(SIMP, preserve_topology=True)
    if PIECE_ROUND > 0: g = round_poly(g)
    return g.intersection(Ls)
S = {i: soft(P[i]) for i in ids}
# the municipal exceptions are laid onto the smoothed pieces (a gentler rounding than the pieces get: a city is only ~3 km wide, the piece smoothing would erase it) — the city goes to its region and is cut out of every other piece,
# BEFORE the re-tiling, so the neighbour's smoothing (it closes narrow notches) can never hand a city back. A city that touches its region's body leaves a notch in the neighbour, never a hole.
if os.path.exists("overrides.json"):
    from shapely.ops import nearest_points
    by_region = {}
    for o in json.load(open("overrides.json")):
        by_region.setdefault(o["region"], []).append(unary_union([poly(x) for x in o["rings"]]))
    for region, cities in by_region.items():
        # neighbouring cities (Ra'anana, Kfar Saba, Hod HaSharon) are fused into one block first (their separately-drawn borders leave slivers), then rounded gently and tied to the region's body
        block = unary_union(cities).buffer(0.003, 12).buffer(-0.003, 12)
        Os = round_poly(block.buffer(0.004, 12).buffer(-0.008, 12).buffer(0.004, 12).simplify(SIMP / 2, preserve_topology=True)).intersection(Ls)
        for comp in (list(Os.geoms) if hasattr(Os, "geoms") else [Os]):
            if comp.is_empty or comp.intersects(S[region]): continue
            a, b = nearest_points(comp, S[region])   # a block that does not touch the body would leave a hole in its old neighbour
            Os = Os.union(LineString([a, b]).buffer(0.006, 8))
        for i in ids:
            S[i] = S[i].union(Os) if i == region else S[i].difference(Os)
order = sorted(ids, key=lambda i: S[i].area)   # small pieces keep their shape, the biggest one takes the remainder
taken = Polygon(); Q = {}
for i in order:
    Q[i] = S[i].difference(taken); taken = unary_union([taken, Q[i]])
gaps = Ls.difference(taken)
for gp in (list(gaps.geoms) if hasattr(gaps, "geoms") else [gaps]):
    if gp.is_empty or gp.area < 1e-9: continue
    best = max(ids, key=lambda i: gp.boundary.intersection(Q[i].buffer(1e-7)).length)
    Q[best] = unary_union([Q[best], gp])
for i in ids:
    g = Q[i]
    if isinstance(g, MultiPolygon):
        parts = sorted(g.geoms, key=lambda x: -x.area)
        Q[i] = unary_union([x for x in parts if x.area > 0.0006])
    Q[i] = Q[i].buffer(0)
# any leftover dust (pieces dropped above) goes back to the neighbour that touches it
dust = Ls.difference(unary_union(list(Q.values())))
for gp in (list(dust.geoms) if hasattr(dust, "geoms") else [dust]):
    if gp.is_empty or gp.area < 1e-9: continue
    best = max(ids, key=lambda i: gp.boundary.intersection(Q[i].buffer(1e-7)).length)
    Q[best] = unary_union([Q[best], gp])
for i in ids:
    holes = sum(len(p.interiors) for p in (Q[i].geoms if hasattr(Q[i], "geoms") else [Q[i]]))
    if holes: print("WARNING piece", i, "has", holes, "hole(s) — the output keeps exterior rings only")
outline = unary_union(list(Q.values()))
print("outline parts", len(outline.geoms) if hasattr(outline, "geoms") else 1, "area", round(outline.area, 4), "sketch", round(Ls.area, 4))
overlap = sum(Q[a].intersection(Q[b]).area for k, a in enumerate(ids) for b in ids[k + 1:])
print("overlap between pieces", round(overlap, 8))

def rings_of(g):
    # exterior rings only (a hole smaller than a dot is dust from the clipping), tiny polygons dropped
    gs = list(g.geoms) if hasattr(g, "geoms") else [g]
    res = []
    for p in sorted(gs, key=lambda x: -x.area):
        if p.is_empty or p.area < 2e-4: continue
        c = list(p.exterior.coords)
        if p.exterior.is_ccw is False: c = c[::-1]   # one winding for every ring
        res.append([[round(x, 4), round(y, 4)] for x, y in c])
    return res
json.dump({"outline": rings_of(outline), "pieces": {i: rings_of(Q[i]) for i in ids}}, open("out.json", "w"))

def rings_of(g):
    # exterior rings only (a hole smaller than a dot is dust from the clipping), tiny polygons dropped, one winding
    gs = list(g.geoms) if hasattr(g, "geoms") else [g]
    res = []
    for p in sorted(gs, key=lambda x: -x.area):
        if p.is_empty or p.area < 2e-4: continue
        c = list(p.exterior.coords)
        if p.exterior.is_ccw is False: c = c[::-1]
        res.append([[round(x, 4), round(y, 4)] for x, y in c])
    return res

OUT = sys.argv[5] if len(sys.argv) > 5 else "out.ts"
def fmt(rings): return "[" + ",".join("[" + ",".join(f"[{x},{y}]" for x, y in r) + "]" for r in rings) + "]"
hdr = open(__file__.replace("gen_map_pieces.py", "map-pieces-header.txt")).read() if False else None
ts_header = """/**
 * CONTROL ROOM — the map as ONE block (owner 2026-11-02: "the map must be one block — the spiky corners are not good, take a normal sketch; the parts that stand out under the pointer must complete
 * each other like a puzzle, with no gaps between them"). GENERATED by tools/map/gen_map_pieces.py from the land silhouette (Natural Earth, lib/control-room-land.ts) and the seven operational regions
 * (lib/control-room-regions-data.ts) — do not hand-edit. [longitude, latitude].
 *  - MAP_OUTLINE: the smooth sketch of the land (needles cut, bays closed a little, every corner rounded) — one ring.
 *  - MAP_PIECES: the seven regions as pieces that tile MAP_OUTLINE exactly (no gaps, no overlaps; the West Bank follows the same rule as lib/control-room-regions.ts: north of 31.98 -> Sharon & Shomron,
 *    the rest -> the nearest region). The municipal exceptions of lib/control-room-regions.ts (Ra'anana, Kfar Saba, Hod HaSharon -> Sharon & Shomron; Rishon LeZion -> Gush Dan; Modi'in -> Jerusalem & Modi'in)
 *    are drawn in the region their branches belong to, so a dot is always inside its own piece. Display only: which region a branch BELONGS to is still decided by lib/control-room-regions.ts.
 */
export type MapRing = ReadonlyArray<readonly [number, number]>;
"""
body = "export const MAP_OUTLINE: ReadonlyArray<MapRing> = " + fmt(rings_of(outline)) + ";\n"
pieces = "export const MAP_PIECES: Readonly<Record<string, ReadonlyArray<MapRing>>> = {" + ",".join('"%s":%s' % (i, fmt(rings_of(Q[i]))) for i in ids) + "};\n"
open(OUT, "w").write(ts_header + body + pieces)
print("wrote", OUT)
