/** Writes land.json + regions.json + overrides.json (the inputs of tools/map/gen_map_pieces.py). Run: npx tsx tools/map/export-map-inputs.ts <dir> */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { LAND_RINGS } from "../../lib/control-room-land";
import { REGIONS_DATA, REGION_OVERRIDES_DATA } from "../../lib/control-room-regions-data";

const dir = process.argv[2] ?? ".";
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, "land.json"), JSON.stringify(LAND_RINGS));
writeFileSync(path.join(dir, "regions.json"), JSON.stringify(REGIONS_DATA.map((r) => ({ id: r.id, rings: r.rings }))));
// the municipal exceptions (Ra'anana, Kfar Saba, Hod HaSharon -> Sharon & Shomron, Rishon LeZion -> Gush Dan, Modi'in -> Jerusalem & Modi'in): lib/control-room-regions.ts decides a branch's region by them FIRST, so the map must draw them in that region
writeFileSync(path.join(dir, "overrides.json"), JSON.stringify(REGION_OVERRIDES_DATA.map((o) => ({ name: o.name, region: o.region, rings: o.rings }))));
console.log("wrote land.json + regions.json + overrides.json to", dir);
