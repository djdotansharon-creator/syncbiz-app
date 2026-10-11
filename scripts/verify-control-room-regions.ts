/**
 * Control Room regions (owner 2026-10-11) — automatic region from a branch's lat/lng. Run: npx tsx scripts/verify-control-room-regions.ts
 * Regions = Israel's 6 administrative districts (Natural Earth admin-1, ISO IL-Z / IL-HA / IL-TA / IL-M / IL-JM / IL-D).
 *  - 44 known places (city centres + coastal points + Judea & Samaria + abroad) → expected region / Outside
 *  - every district edge, nudged ±~65 m: never "no region" (simplification slivers along shared borders are covered)
 *  - no coordinates → reason "no_location"; Judea & Samaria → "outside" (never snapped into a district)
 */
import { REGIONS, branchRegion, regionForPoint, type RegionId } from "../lib/control-room-regions";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}

const PLACES: [string, number, number, string | null][] = [
  ["Haifa", 32.794, 34.9896, "haifa"], ["Kiryat Ata", 32.8115, 35.1067, "haifa"], ["Kiryat Bialik", 32.8275, 35.0858, "haifa"], ["Hadera", 32.434, 34.9196, "haifa"], ["Zichron Yaakov", 32.5715, 34.9524, "haifa"],
  ["Nahariya", 33.0058, 35.0981, "north"], ["Akko", 32.9281, 35.0818, "north"], ["Tiberias", 32.7959, 35.531, "north"], ["Afula", 32.6078, 35.2897, "north"], ["Nazareth", 32.6996, 35.3035, "north"], ["Katzrin", 32.9925, 35.691, "north"],
  ["Netanya", 32.3215, 34.8532, "center"], ["Kfar Saba", 32.175, 34.9069, "center"], ["Petah Tikva", 32.084, 34.8878, "center"], ["Rishon LeZion", 31.973, 34.7925, "center"], ["Rehovot", 31.8928, 34.8113, "center"], ["Modiin", 31.898, 35.0104, "center"], ["Elad", 32.0522, 34.951, "center"], ["Ramla", 31.9292, 34.8656, "center"], ["Bilu Center", 31.86, 34.82, "center"],
  ["Herzliya", 32.1624, 34.8447, "tel-aviv"], ["TA Dizengoff", 32.0753, 34.7748, "tel-aviv"], ["TA Port", 32.0973, 34.774, "tel-aviv"], ["Ramat Gan", 32.0823, 34.8106, "tel-aviv"], ["Bat Yam", 32.0132, 34.748, "tel-aviv"], ["Holon", 32.0158, 34.7874, "tel-aviv"],
  ["Jerusalem", 31.7683, 35.2137, "jerusalem"], ["Beit Shemesh", 31.747, 34.9881, "jerusalem"],
  ["Ashdod", 31.8014, 34.6435, "south"], ["Ashdod Marina", 31.7925, 34.6265, "south"], ["Ashkelon", 31.6688, 34.5743, "south"], ["Kiryat Gat", 31.61, 34.7642, "south"], ["Beersheba", 31.2518, 34.7913, "south"], ["Eilat", 29.5577, 34.9519, "south"],
  ["Netanya beach", 32.329, 34.848, "center"], ["Herzliya marina", 32.1622, 34.7978, "tel-aviv"], ["Haifa Bat Galim", 32.832, 34.981, "haifa"], ["Eilat north beach", 29.5545, 34.956, "south"], ["Ashkelon Marina", 31.6815, 34.556, "south"],
  ["Ariel", 32.105, 35.188, null], ["Ma'ale Adumim", 31.777, 35.3, null], ["Modiin Illit", 31.933, 35.043, null], ["Beitar Illit", 31.6969, 35.1153, null], ["Cyprus", 34.9, 33.0, null],
];
const bad = PLACES.filter(([, lat, lng, exp]) => regionForPoint(lng, lat) !== exp).map(([n, lat, lng, exp]) => `${n}: expected ${exp}, got ${regionForPoint(lng, lat)}`);
assert(`R1 ${PLACES.length} known places → the right region (cities, coast, Judea & Samaria → Outside, abroad → Outside)`, bad.length === 0, bad.join("; "));

let edge = 0, gaps = 0;
for (const r of REGIONS) for (const ring of r.rings) for (let i = 1; i < ring.length; i += 2) {
  const [x1, y1] = ring[i - 1], [x2, y2] = ring[i];
  const nx = -(y2 - y1), ny = x2 - x1, n = Math.hypot(nx, ny) || 1;
  for (const d of [-0.0006, 0.0006]) { edge++; if (!regionForPoint((x1 + x2) / 2 + (nx / n) * d, (y1 + y2) / 2 + (ny / n) * d)) gaps++; }
}
assert(`R2 ${edge} points along every district edge (±~65 m) → never "no region"`, gaps === 0, `${gaps} gaps`);
assert("R3 six regions with real boundaries (ISO district codes)", REGIONS.length === 6 && REGIONS.map((r) => r.iso).join(",") === "IL-Z,IL-HA,IL-TA,IL-M,IL-JM,IL-D");
assert("R4 no coordinates → no_location; Judea & Samaria → outside; Haifa → ok",
  branchRegion(null, null).reason === "no_location" && branchRegion(32.105, 35.188).reason === "outside" && branchRegion(32.794, 34.9896).regionId === "haifa");

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
  ];
  const run = (brand: string, query: string, region: RegionId | null) => applyControlRoomFilters(rows, { brand, query, region });
  const names = (x: { visibleRows: { name: string }[] }) => x.visibleRows.map((r) => r.name).join(",");
  assert("F1 Brand BE + Region Center + Search Rishon → only BE's Center branches matching Rishon",
    names(run("BE", "Rishon", "center")) === "BE Rishon Gold,BE Rishon West");
  assert("F2 Search + Region (all brands)", names(run("all", "rishon", "center")) === "BE Rishon Gold,BE Rishon West,Universe Rishon");
  assert("F3 Brand + Region", names(run("BE", "", "jerusalem")) === "BE Jerusalem" && names(run("UNV", "", "haifa")) === "");
  assert("F4 search by branch number and by Hebrew city", names(run("all", "030", null)) === "Universe Rishon" && names(run("all", "ירושלים", null)) === "BE Jerusalem");
  const all = run("all", "", null);
  assert("F5 All Israel: a branch without coordinates and one outside the regions stay in the list (counted, explained)",
    all.visibleRows.length === rows.length && all.noLocationCount === 1 && all.outsideCount === 1);
  assert("F6 inside a region they are not shown (they belong to no region)", !run("all", "", "center").visibleRows.some((r) => r.regionReason !== "ok"));
  assert("F7 region counts follow brand + search (hover label)", run("BE", "rishon", null).regionCounts.center === 2 && run("BE", "rishon", null).regionCounts.haifa === undefined);
  assert("F8 Broadcast scope = brand only (never cut by region / search)", run("BE", "rishon", "center").brandRows.length === 6);
  assert("F9 clearing everything → the full network; filtersActive reflects any filter",
    !run("all", "  ", null).filtersActive && run("all", "", "south").filtersActive && run("BE", "", null).filtersActive && run("all", "", null).visibleRows.length === 7);
  assert("F10 multi-word search: every word must match", matchesBranchSearch({ name: "BE Rishon Gold", branchNumber: "101", city: "Rishon LeZion", formattedAddress: null }, "gold 101") &&
    !matchesBranchSearch({ name: "BE Rishon Gold", branchNumber: "101", city: "Rishon LeZion", formattedAddress: null }, "gold haifa"));
  console.log(`\n${pass} passed, ${fail} failed`);
});
