/**
 * Control Room — VONO Operational Regions (owner decisions 2026-10-12) — automatic region from a branch's lat/lng.
 * Run: npx tsx scripts/verify-control-room-regions.ts
 * 7 regions built from Israel's official sub-districts + municipal exceptions (Rishon → Gush Dan; Kfar Saba / Ra'anana /
 * Hod HaSharon → Sharon & Shomron; Modi'in → Jerusalem & Modi'in) + the Judea & Samaria rule. Not an official division.
 *  - known places (cities, coast, exceptions, Judea & Samaria, abroad) → expected region / Outside Israel
 *  - every region edge, nudged ±~65 m: never "no region"
 *  - a branch in Israel always gets a region; Outside Israel only abroad; no coordinates → "no_location"
 */
import { REGIONS, REGION_OVERRIDES, REGION_DRAW_ORDER, branchRegion, regionForPoint, type RegionId } from "../lib/control-room-regions";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}

const PLACES: [string, number, number, string | null][] = [
  ["Nahariya", 33.0058, 35.0981, "north"], ["Karmiel", 32.9171, 35.2951, "north"], ["Tiberias", 32.7959, 35.531, "north"], ["Afula", 32.6078, 35.2897, "north"], ["Katzrin", 32.9925, 35.691, "north"], ["Akko", 32.9281, 35.0818, "north"], ["Metula", 33.2795, 35.5795, "north"],
  ["Haifa", 32.794, 34.9896, "haifa"], ["Kiryat Ata", 32.8115, 35.1067, "haifa"], ["Kiryat Bialik", 32.8275, 35.0858, "haifa"], ["Nesher", 32.766, 35.044, "haifa"], ["Haifa Bat Galim", 32.832, 34.981, "haifa"],
  ["Hadera", 32.434, 34.9196, "sharon-shomron"], ["Zichron Yaakov", 32.5715, 34.9524, "sharon-shomron"], ["Caesarea", 32.5, 34.9, "sharon-shomron"], ["Netanya", 32.3215, 34.8532, "sharon-shomron"], ["Netanya beach", 32.329, 34.848, "sharon-shomron"], ["Kfar Netter", 32.278, 34.877, "sharon-shomron"],
  ["Ra'anana", 32.1848, 34.8713, "sharon-shomron"], ["Kfar Saba", 32.175, 34.9069, "sharon-shomron"], ["Hod HaSharon", 32.15, 34.89, "sharon-shomron"],
  ["Ariel", 32.105, 35.188, "sharon-shomron"], ["Karnei Shomron", 32.17, 35.09, "sharon-shomron"], ["Kedumim", 32.21, 35.16, "sharon-shomron"], ["Shilo", 32.05, 35.29, "sharon-shomron"], ["Elkana", 32.11, 35.03, "sharon-shomron"],
  ["Tel Aviv", 32.0753, 34.7748, "gush-dan"], ["TA Port", 32.0973, 34.774, "gush-dan"], ["Ramat Gan", 32.0823, 34.8106, "gush-dan"], ["Bnei Brak", 32.0807, 34.8338, "gush-dan"], ["Holon", 32.0158, 34.7874, "gush-dan"], ["Bat Yam", 32.0132, 34.748, "gush-dan"], ["Herzliya", 32.1624, 34.8447, "gush-dan"], ["Herzliya marina", 32.1622, 34.7978, "gush-dan"],
  ["Petah Tikva", 32.084, 34.8878, "gush-dan"], ["Rosh HaAyin", 32.0956, 34.9566, "gush-dan"], ["Elad", 32.0522, 34.951, "gush-dan"],
  ["Rishon LeZion", 31.973, 34.7925, "gush-dan"], ["Rishon west", 31.965, 34.77, "gush-dan"], ["Rishon south", 31.95, 34.80, "gush-dan"],
  ["Ness Ziona", 31.9293, 34.7987, "shfela"], ["Rehovot", 31.8928, 34.8113, "shfela"], ["Yavne", 31.8781, 34.7397, "shfela"], ["Mazkeret Batya", 31.8536, 34.8463, "shfela"], ["Bilu Center", 31.86, 34.82, "shfela"], ["Lod", 31.951, 34.8881, "shfela"], ["Ramla", 31.9292, 34.8656, "shfela"], ["Shoham", 31.9986, 34.9465, "shfela"],
  ["Modiin", 31.898, 35.0104, "jerusalem-modiin"], ["Modiin Illit", 31.933, 35.043, "jerusalem-modiin"], ["Jerusalem", 31.7683, 35.2137, "jerusalem-modiin"], ["Beit Shemesh", 31.747, 34.9881, "jerusalem-modiin"], ["Mevaseret", 31.802, 35.15, "jerusalem-modiin"],
  ["Ma'ale Adumim", 31.777, 35.3, "jerusalem-modiin"], ["Beitar Illit", 31.6969, 35.1153, "jerusalem-modiin"], ["Efrat", 31.6533, 35.15, "jerusalem-modiin"], ["Givat Ze'ev", 31.86, 35.17, "jerusalem-modiin"], ["Kiryat Arba", 31.53, 35.12, "jerusalem-modiin"],
  ["Ashdod", 31.8014, 34.6435, "south"], ["Ashdod Marina", 31.7925, 34.6265, "south"], ["Ashkelon", 31.6688, 34.5743, "south"], ["Kiryat Gat", 31.61, 34.7642, "south"], ["Beersheba", 31.2518, 34.7913, "south"], ["Dimona", 31.07, 35.03, "south"], ["Eilat", 29.5577, 34.9519, "south"], ["Sderot", 31.525, 34.596, "south"],
  ["Cyprus", 34.9, 33.0, null], ["Rome", 41.9, 12.5, null], ["Amman", 31.95, 35.93, null],
];
const bad = PLACES.filter(([, lat, lng, exp]) => regionForPoint(lng, lat) !== exp).map(([n, lat, lng, exp]) => `${n}: expected ${exp}, got ${regionForPoint(lng, lat)}`);
assert(`R1 ${PLACES.length} known places → the right region (cities, coast, exceptions, Judea & Samaria, abroad → Outside Israel)`, bad.length === 0, bad.join("; "));

let edge = 0, gaps = 0;
for (const r of REGIONS) for (const ring of r.rings) for (let i = 1; i < ring.length; i += 2) {
  const [x1, y1] = ring[i - 1], [x2, y2] = ring[i];
  const nx = -(y2 - y1), ny = x2 - x1, n = Math.hypot(nx, ny) || 1;
  for (const d of [-0.0006, 0.0006]) { edge++; if (!regionForPoint((x1 + x2) / 2 + (nx / n) * d, (y1 + y2) / 2 + (ny / n) * d)) gaps++; }
}
assert(`R2 ${edge} points along every region edge (±~65 m) → never "no region"`, gaps === 0, `${gaps} gaps`);
assert("R3 seven operational regions, all 15 sub-districts used once, drawn once each",
  REGIONS.map((r) => r.id).join(",") === "north,haifa,sharon-shomron,gush-dan,shfela,jerusalem-modiin,south" &&
  REGIONS.flatMap((r) => r.subdistricts).length === 15 && new Set(REGIONS.flatMap((r) => r.subdistricts)).size === 15 &&
  [...REGION_DRAW_ORDER].sort().join() === REGIONS.map((r) => r.id).sort().join());
const exp: Record<string, RegionId> = { "ראשון לציון": "gush-dan", "כפר סבא": "sharon-shomron", "רעננה": "sharon-shomron", "הוד השרון": "sharon-shomron", "מודיעין-מכבים-רעות": "jerusalem-modiin" };
assert("R4 five municipal exceptions (real OSM city boundaries) → the owner's regions",
  REGION_OVERRIDES.length === 5 && REGION_OVERRIDES.every((o) => exp[o.nameHe] === o.region && o.rings.length > 0));
assert("R5 no coordinates → no_location; Ariel (Judea & Samaria) → Sharon & Shomron; Rome → Outside Israel",
  branchRegion(null, null).reason === "no_location" && branchRegion(32.105, 35.188).regionId === "sharon-shomron" &&
  branchRegion(41.9, 12.5).reason === "outside" && branchRegion(32.794, 34.9896).regionId === "haifa");

// ── Brand + Search + Region together (lib/control-room-filters.ts — the exact function the Control Room uses) ──
import("../lib/control-room-filters").then(({ applyControlRoomFilters, matchesBranchSearch }) => {
  const mk = (name: string, brand: string, city: string, lat: number | null, lng: number | null, num: string) => {
    const g = branchRegion(lat, lng);
    return { name, brandId: brand, city, branchNumber: num, formattedAddress: null, regionId: g.regionId, regionReason: g.reason };
  };
  const rows = [
    mk("BE Rishon Gold", "BE", "Rishon LeZion", 31.973, 34.7925, "101"),
    mk("BE Rishon West", "BE", "Rishon LeZion", 31.965, 34.77, "102"),
    mk("Universe Rishon", "UNV", "Rishon LeZion", 31.973, 34.7925, "030"),
    mk("BE Haifa", "BE", "Haifa", 32.794, 34.9896, "103"),
    mk("BE Jerusalem", "BE", "ירושלים", 31.7683, 35.2137, "104"),
    mk("BE No Location", "BE", "", null, null, "105"),
    mk("BE Ariel", "BE", "Ariel", 32.105, 35.188, "106"),
    mk("BE Rome", "BE", "Rome", 41.9, 12.5, "107"),
  ];
  const run = (brand: string, query: string, region: RegionId | null) => applyControlRoomFilters(rows, { brand, query, region });
  const names = (x: { visibleRows: { name: string }[] }) => x.visibleRows.map((r) => r.name).join(",");
  assert("F1 Brand BE + Region Gush Dan + Search Rishon → only BE's Gush Dan branches matching Rishon",
    names(run("BE", "Rishon", "gush-dan")) === "BE Rishon Gold,BE Rishon West");
  assert("F2 Search + Region (all brands)", names(run("all", "rishon", "gush-dan")) === "BE Rishon Gold,BE Rishon West,Universe Rishon");
  assert("F3 Brand + Region", names(run("BE", "", "jerusalem-modiin")) === "BE Jerusalem" && names(run("UNV", "", "haifa")) === "");
  assert("F4 search by branch number and by Hebrew city", names(run("all", "030", null)) === "Universe Rishon" && names(run("all", "ירושלים", null)) === "BE Jerusalem");
  const all = run("all", "", null);
  assert("F5 All Israel: a branch without coordinates and one outside Israel stay in the list (counted, explained)",
    all.visibleRows.length === rows.length && all.noLocationCount === 1 && all.outsideCount === 1);
  assert("F6 inside a region they are not shown (they belong to no region)", !run("all", "", "gush-dan").visibleRows.some((r) => r.regionReason !== "ok"));
  assert("F7 region counts follow brand + search (hover label)", run("BE", "rishon", null).regionCounts["gush-dan"] === 2 && run("BE", "rishon", null).regionCounts.haifa === undefined);
  assert("F8 Broadcast scope = brand only (never cut by region / search)", run("BE", "rishon", "gush-dan").brandRows.length === 7);
  assert("F9 clearing everything → the full network; filtersActive reflects any filter",
    !run("all", "  ", null).filtersActive && run("all", "", "south").filtersActive && run("BE", "", null).filtersActive && run("all", "", null).visibleRows.length === 8);
  assert("F11 Judea & Samaria branch belongs to Sharon & Shomron (never Outside)", names(run("BE", "", "sharon-shomron")) === "BE Ariel");
  assert("F10 multi-word search: every word must match", matchesBranchSearch({ name: "BE Rishon Gold", branchNumber: "101", city: "Rishon LeZion", formattedAddress: null }, "gold 101") &&
    !matchesBranchSearch({ name: "BE Rishon Gold", branchNumber: "101", city: "Rishon LeZion", formattedAddress: null }, "gold haifa"));
  console.log(`\n${pass} passed, ${fail} failed`);
});
