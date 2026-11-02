/**
 * The desktop app icon is the VONO icon (owner 2026-11-02: "it came back to the old logo"). 2.3.0 shipped the old blue "SB" tile because
 * `build-icons` rasterizes `build/icon.svg` over `build/icon.png` on every clean build and the committed SVG was still the SyncBiz one.
 * Run (from repo root): npx tsx desktop/scripts/verify-app-icon.ts
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const root = path.join(__dirname, "..", "..");
const sha = (p: string) => createHash("sha256").update(readFileSync(path.join(root, p))).digest("hex");

async function main() {
  assert("I1 there is NO desktop/build/icon.svg (it would be rasterized over icon.png on every build — the old SB tile came back that way)", !existsSync(path.join(root, "desktop/build/icon.svg")));
  assert("I2 desktop/build/icon.png is exactly the VONO app icon (public/brand/vono-app-icon-1024.png)", sha("desktop/build/icon.png") === sha("public/brand/vono-app-icon-1024.png"));
  const { data, info } = await sharp(path.join(root, "desktop/build/icon.png")).resize(256, 256).raw().toBuffer({ resolveWithObject: true });
  let n = 0, bright = 0, blue = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    if (info.channels === 4 && data[i + 3] < 200) continue;
    n++; bright += (data[i] + data[i + 1] + data[i + 2]) / 3; if (data[i + 2] > data[i] + 40) blue++;
  }
  assert("I3 the picture is the black VONO tile (mean brightness < 80/255), not the blue SB tile (blue-ish pixels < 2%)", bright / n < 80 && blue / n < 0.02, `brightness ${(bright / n).toFixed(0)}, blue ${(100 * blue / n).toFixed(1)}%`);
  const ico = readFileSync(path.join(root, "desktop/build/icon.ico"));
  const frames = ico.readUInt16LE(4), sizes = Array.from({ length: frames }, (_, i) => ico[6 + i * 16] || 256);
  assert("I4 icon.ico has the sizes Windows needs (16 … 256) and icon.icns is an icns file", ico.readUInt16LE(2) === 1 && [16, 32, 48, 256].every((s) => sizes.includes(s)) && readFileSync(path.join(root, "desktop/build/icon.icns")).subarray(0, 4).toString() === "icns", `sizes ${sizes.join(",")}`);
  assert("I5 electron-builder takes the icon from build/icon.png", /"icon": "build\/icon\.png"/.test(readFileSync(path.join(root, "desktop/package.json"), "utf-8")));
  assert("I6 the README explains why there is no icon.svg", /deliberately NO `icon\.svg`/.test(readFileSync(path.join(root, "desktop/build/README.md"), "utf-8")));
  console.log(`\n${pass} passed, ${fail} failed`);
}
main();
