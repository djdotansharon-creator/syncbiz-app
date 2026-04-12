/**
 * After `next build` with `output: "standalone"`, copy the standalone server + assets
 * into desktop/staged-web for Electron to spawn (see embedded-next-server.ts).
 */
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "../..");
const standaloneSrc = path.join(repoRoot, ".next/standalone");
const dest = path.join(__dirname, "../staged-web");

if (!fs.existsSync(standaloneSrc)) {
  console.error("[stage-standalone] Missing .next/standalone. Run `npm run build` at the repo root first.");
  process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(standaloneSrc, dest, { recursive: true });

const pubSrc = path.join(repoRoot, "public");
if (fs.existsSync(pubSrc)) {
  fs.cpSync(pubSrc, path.join(dest, "public"), { recursive: true });
}

const staticSrc = path.join(repoRoot, ".next/static");
if (!fs.existsSync(staticSrc)) {
  console.error("[stage-standalone] Missing .next/static after build.");
  process.exit(1);
}
fs.mkdirSync(path.join(dest, ".next"), { recursive: true });
fs.cpSync(staticSrc, path.join(dest, ".next/static"), { recursive: true });

console.log("[stage-standalone] Staged web app at", dest);
