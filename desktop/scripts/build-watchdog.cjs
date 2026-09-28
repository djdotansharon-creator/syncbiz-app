/**
 * Bundle the external VONO Watchdog into a single CommonJS file that a plain Node runtime can run.
 * Entry = desktop/watchdog/observer.ts (self-starts under require.main). Output =
 * desktop/resources/vono-watchdog/watchdog.cjs, which electron-builder ships (with a dedicated
 * node.exe) to <install>/vono-watchdog/. No Electron dependency; no global Node dependency.
 */
const esbuild = require("esbuild");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, ".."); // desktop/
const outDir = path.join(root, "resources", "vono-watchdog");
const outfile = path.join(outDir, "watchdog.cjs");

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  await esbuild.build({
    entryPoints: [path.join(root, "watchdog", "observer.ts")],
    bundle: true,
    platform: "node",
    target: "node18",
    format: "cjs",
    outfile,
    sourcemap: false,
    // Everything the watchdog needs is local TS (contract/state-machine/recovery/lock + the shared
    // runtime-state contract). Node built-ins stay external by platform:node. No external npm deps.
    logLevel: "info",
  });
  const bytes = fs.statSync(outfile).size;
  console.log(`[build-watchdog] wrote ${outfile} (${bytes} bytes)`);

  // Stage the provisioning scripts alongside node.exe/watchdog.cjs so win.extraFiles ships them to
  // <install>\vono-watchdog\, where the NSIS installer + the Scheduled Task action reference them.
  const provDir = path.join(root, "scripts", "provisioning");
  for (const f of ["launch-watchdog.ps1", "provision-vono-protection.ps1", "stop-vono-for-upgrade.ps1"]) {
    const src = path.join(provDir, f);
    const dst = path.join(outDir, f);
    fs.copyFileSync(src, dst);
    console.log(`[build-watchdog] staged ${f}`);
  }
}

main().catch((e) => { console.error("[build-watchdog] failed:", e); process.exit(1); });
