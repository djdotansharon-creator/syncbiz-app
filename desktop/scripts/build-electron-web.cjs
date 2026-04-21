/**
 * Build the Next.js standalone bundle that ships inside the Electron installer.
 *
 * Why this wrapper exists:
 *   `next build` reads `NEXT_PUBLIC_*` env vars at build time and inlines them
 *   into client JS. In local dev, `.env.local` pins `NEXT_PUBLIC_WS_URL` to
 *   `ws://localhost:3001` for the dev WS server. If we just ran `next build`
 *   here, that same localhost URL would get baked into the installer, and the
 *   installed app on user machines would try to reach a WS server that isn't
 *   running → no MASTER/CONTROL toggle, no branch sync.
 *
 *   Next.js resolves env files in this order (highest priority first):
 *     process.env > .env.production.local > .env.local > .env.production > .env
 *   so the only reliable way to override `.env.local` without mutating it is
 *   to set the variable in `process.env` BEFORE spawning `next build`.
 *
 * What this script does:
 *   1. Reads `desktop/.env.electron-web` (production overrides, committed)
 *   2. Injects every `NEXT_PUBLIC_*` key into this process's env, without
 *      clobbering values the caller already exported (so CI / a developer can
 *      still override from the command line when needed).
 *   3. Runs `next build` with that environment.
 *   4. Runs `stage-standalone-for-electron.cjs` to copy the result into
 *      `desktop/staged-web/`.
 *
 * Cross-platform: pure Node, no shell-specific syntax. Works on Windows,
 * macOS, and Linux CI runners identically.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "../..");
const envFile = path.join(__dirname, "..", ".env.electron-web");
const stageScript = path.join(__dirname, "stage-standalone-for-electron.cjs");

/**
 * Minimal `.env` parser — no dotenv dependency to keep this script dep-free.
 * Supports `KEY=value`, `KEY="value with spaces"`, comments starting with `#`,
 * and blank lines. Does NOT support variable interpolation; we don't need it.
 */
function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  const text = fs.readFileSync(filePath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

const overrides = parseEnvFile(envFile);
const appliedKeys = [];
for (const [key, value] of Object.entries(overrides)) {
  // If the caller already set it (e.g. CI override, local troubleshooting),
  // respect their choice. Everything else we inject.
  if (process.env[key] !== undefined && process.env[key] !== "") continue;
  process.env[key] = value;
  appliedKeys.push(key);
}

if (appliedKeys.length > 0) {
  console.log(
    `[build:electron-web] Injected ${appliedKeys.length} env var(s) from desktop/.env.electron-web: ${appliedKeys.join(", ")}`,
  );
} else {
  console.log("[build:electron-web] No env overrides applied (file missing or all keys already set).");
}
if (process.env.NEXT_PUBLIC_WS_URL) {
  console.log(`[build:electron-web] NEXT_PUBLIC_WS_URL = ${process.env.NEXT_PUBLIC_WS_URL}`);
}

/**
 * Resolve the `next` CLI entry point in node_modules and spawn it with the
 * current Node interpreter. Avoiding `npx` / `.cmd` shims sidesteps the
 * Windows-specific stdio-inheritance quirks that bite when this script is
 * chained inside a larger npm run sequence (e.g. `desktop:shell`).
 */
const nextCliPath = require.resolve("next/dist/bin/next", { paths: [repoRoot] });
const buildResult = spawnSync(process.execPath, [nextCliPath, "build"], {
  cwd: repoRoot,
  stdio: "inherit",
  env: process.env,
});
if (buildResult.status !== 0) {
  process.exit(buildResult.status ?? 1);
}

const stageResult = spawnSync(process.execPath, [stageScript], {
  stdio: "inherit",
  env: process.env,
});
if (stageResult.status !== 0) {
  process.exit(stageResult.status ?? 1);
}
