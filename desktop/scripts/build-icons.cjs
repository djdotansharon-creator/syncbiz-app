/**
 * Generates the platform icon set from the brand source.
 *
 * Source-of-truth chain:
 *   build/icon.svg  →  build/icon.png  →  build/icon.ico  +  build/icon.icns
 *
 * If `build/icon.svg` exists, it's rasterized at 1024x1024 to `build/icon.png`
 * first, so the SVG owns the brand mark. If only `build/icon.png` exists
 * (legacy / hand-authored), it's used as-is.
 *
 * Run: node scripts/build-icons.cjs
 */

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const toIco = require("to-ico");
const png2icons = require("png2icons");

const buildDir = path.join(__dirname, "..", "build");
const srcSvg = path.join(buildDir, "icon.svg");
const srcPng = path.join(buildDir, "icon.png");

async function rasterizeSvgIfPresent() {
  if (!fs.existsSync(srcSvg)) return false;
  const svgBuf = fs.readFileSync(srcSvg);
  // High `density` makes librsvg compute the source at high DPI before sharp
  // resizes — keeps strokes / text crisp instead of antialiasing a 96dpi base.
  const png = await sharp(svgBuf, { density: 384 })
    .resize(1024, 1024, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  fs.writeFileSync(srcPng, png);
  console.log("[build-icons] rasterized icon.svg -> icon.png (1024x1024)");
  return true;
}

async function main() {
  await rasterizeSvgIfPresent();

  if (!fs.existsSync(srcPng)) {
    console.error("[build-icons] Missing icon source. Provide build/icon.svg or build/icon.png.");
    process.exit(1);
  }

  const buf = fs.readFileSync(srcPng);
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngBuffers = await Promise.all(
    sizes.map((s) =>
      sharp(buf)
        .resize(s, s, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer(),
    ),
  );
  const ico = await toIco(pngBuffers);
  fs.writeFileSync(path.join(buildDir, "icon.ico"), ico);

  const icnsInput = await sharp(buf)
    .resize(1024, 1024, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
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
