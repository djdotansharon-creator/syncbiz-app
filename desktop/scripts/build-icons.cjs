/**
 * Generates build/icon.ico and build/icon.icns from build/icon.png (min 256px).
 * Run: node scripts/build-icons.cjs
 */

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const toIco = require("to-ico");
const png2icons = require("png2icons");

const buildDir = path.join(__dirname, "..", "build");
const srcPng = path.join(buildDir, "icon.png");

async function main() {
  if (!fs.existsSync(srcPng)) {
    console.error("[build-icons] Missing", srcPng);
    process.exit(1);
  }
  const buf = fs.readFileSync(srcPng);
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngBuffers = await Promise.all(
    sizes.map((s) => sharp(buf).resize(s, s, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()),
  );
  const ico = await toIco(pngBuffers);
  fs.writeFileSync(path.join(buildDir, "icon.ico"), ico);

  const icnsInput = await sharp(buf).resize(1024, 1024, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const icns = png2icons.createICNS(icnsInput, png2icons.BILINEAR, 0);
  if (!icns) {
    console.error("[build-icons] ICNS generation failed");
    process.exit(1);
  }
  fs.writeFileSync(path.join(buildDir, "icon.icns"), icns);
  console.log("[build-icons] Wrote icon.ico, icon.icns from icon.png");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
