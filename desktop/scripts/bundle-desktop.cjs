/**
 * Bundle preload (Node/CJS + external electron) and renderer (browser IIFE)
 * so they are not executed as raw tsc CommonJS in the wrong context.
 */
const esbuild = require("esbuild");
const path = require("path");

const root = path.join(__dirname, "..");
const repoRoot = path.join(__dirname, "..", "..");

/** Desktop bundles `lib/*` via `@/`; repo root may resolve a different React major than `desktop/node_modules`. */
function desktopReactAliases() {
  const r = path.join(root, "node_modules", "react");
  const rd = path.join(root, "node_modules", "react-dom");
  return {
    "@": repoRoot,
    react: r,
    "react-dom": rd,
    "react/jsx-runtime": path.join(r, "jsx-runtime.js"),
    "react/jsx-dev-runtime": path.join(r, "jsx-dev-runtime.js"),
    "react-dom/client": path.join(rd, "client.js"),
  };
}

async function main() {
  await esbuild.build({
    entryPoints: [path.join(root, "src", "preload", "index.ts")],
    bundle: true,
    platform: "node",
    target: "node18",
    format: "cjs",
    outfile: path.join(root, "dist", "preload", "index.js"),
    external: ["electron"],
    sourcemap: true,
  });

  const devDebugPanel = process.env.NODE_ENV !== "production";
  /** Opt-in with DESKTOP_JINGLES_CONTROL_UI=1, or dev by default unless DESKTOP_JINGLES_CONTROL_UI=0 */
  const jinglesControlUi =
    process.env.DESKTOP_JINGLES_CONTROL_UI === "1" ||
    (process.env.NODE_ENV !== "production" && process.env.DESKTOP_JINGLES_CONTROL_UI !== "0");
  await esbuild.build({
    entryPoints: [path.join(root, "src", "renderer", "renderer.ts")],
    bundle: true,
    platform: "browser",
    target: "es2020",
    format: "iife",
    outfile: path.join(root, "dist", "renderer", "renderer.js"),
    sourcemap: true,
    jsx: "automatic",
    alias: desktopReactAliases(),
    define: {
      __DESKTOP_DEV_DEBUG_PANEL__: JSON.stringify(devDebugPanel),
      __DESKTOP_JINGLES_CONTROL_UI__: JSON.stringify(jinglesControlUi),
    },
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
