/** Writes land.json + regions.json (the inputs of tools/map/gen_map_pieces.py). Run: npx tsx tools/map/export-map-inputs.ts <dir> */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { LAND_RINGS } from "../../lib/control-room-land";
import { REGIONS_DATA } from "../../lib/control-room-regions-data";

const dir = process.argv[2] ?? ".";
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, "land.json"), JSON.stringify(LAND_RINGS));
writeFileSync(path.join(dir, "regions.json"), JSON.stringify(REGIONS_DATA.map((r) => ({ id: r.id, rings: r.rings }))));
console.log("wrote land.json + regions.json to", dir);
