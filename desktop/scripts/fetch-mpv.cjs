/**
 * Pre-build script: download mpv.exe into desktop/resources/mpv/ so that
 * electron-builder can bundle it as an extraResource in the Windows installer.
 *
 * Usage (runs automatically via `npm run dist:win`):
 *   node scripts/fetch-mpv.cjs
 *
 * Behaviour:
 *   - If resources/mpv/mpv.exe already exists and --force is not passed, skips.
 *   - Hits the GitHub API for shinchiro/mpv-winbuild-cmake latest release.
 *   - Picks the x86_64-v3 .7z asset (same pattern as the runtime resolver).
 *   - Downloads the archive to a temp file, extracts mpv.exe with the bundled
 *     resources/7zr.exe, then deletes the archive.
 *   - Fails with a non-zero exit code on any error so the build is aborted.
 *
 * Note: This script ONLY runs during the build — it is NOT part of the
 * installed app. The installed app uses the bundled binary directly.
 */

"use strict";

const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const os = require("node:os");

const ROOT = path.join(__dirname, "..");
const OUT_DIR = path.join(ROOT, "resources", "mpv");
const OUT_FILE = path.join(OUT_DIR, "mpv.exe");
const SEVENZIP = path.join(ROOT, "resources", "7zr.exe");

const ASSET_PATTERN = /^mpv-x86_64-v3-\d+-git-[a-f0-9]+\.7z$/;
const GITHUB_OWNER = "shinchiro";
const GITHUB_REPO = "mpv-winbuild-cmake";

// ── helpers ──────────────────────────────────────────────────────────────────

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const opts = new URL(url);
    const req = https.get(
      { hostname: opts.hostname, path: opts.pathname + opts.search, headers: { "User-Agent": "syncbiz-build/1.0" } },
      (res) => {
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
          return resolve(httpsGet(res.headers.location));
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
        res.on("error", reject);
      },
    );
    req.on("error", reject);
  });
}

function httpsGetBinary(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const opts = new URL(url);
    const req = https.get(
      { hostname: opts.hostname, path: opts.pathname + opts.search, headers: { "User-Agent": "syncbiz-build/1.0" } },
      (res) => {
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
          return resolve(httpsGetBinary(res.headers.location, destPath, onProgress));
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        const total = parseInt(res.headers["content-length"] || "0", 10);
        let received = 0;
        const out = fs.createWriteStream(destPath);
        res.on("data", (chunk) => {
          received += chunk.length;
          if (total > 0) onProgress?.(Math.round((received / total) * 100));
        });
        res.pipe(out);
        out.on("finish", resolve);
        out.on("error", reject);
        res.on("error", reject);
      },
    );
    req.on("error", reject);
  });
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const force = process.argv.includes("--force");

  if (!force && fs.existsSync(OUT_FILE)) {
    console.log(`[fetch-mpv] mpv.exe already present at ${OUT_FILE} — skipping download.`);
    console.log("[fetch-mpv] Pass --force to re-download.");
    return;
  }

  if (!fs.existsSync(SEVENZIP)) {
    throw new Error(
      `7zr.exe not found at ${SEVENZIP}.\n` +
        "Download it from https://www.7-zip.org/a/7zr.exe and place it at desktop/resources/7zr.exe.",
    );
  }

  // ── fetch latest release ──────────────────────────────────────────────────
  console.log(`[fetch-mpv] Fetching latest release from ${GITHUB_OWNER}/${GITHUB_REPO}…`);
  const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
  let release;
  try {
    release = JSON.parse(await httpsGet(apiUrl));
  } catch (err) {
    throw new Error(`GitHub API request failed: ${err.message}\nCheck network / proxy / GITHUB_TOKEN.`);
  }

  const version = release.tag_name || release.name || "unknown";
  console.log(`[fetch-mpv] Latest release: ${version}`);

  const asset = (release.assets || []).find((a) => ASSET_PATTERN.test(a.name));
  if (!asset) {
    const names = (release.assets || []).map((a) => a.name).join(", ");
    throw new Error(
      `No asset matching ${ASSET_PATTERN} found in release ${version}.\n` +
        `Available assets: ${names || "(none)"}`,
    );
  }

  console.log(`[fetch-mpv] Downloading ${asset.name} (${Math.round(asset.size / 1024 / 1024)} MB)…`);

  // ── download archive ──────────────────────────────────────────────────────
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const tmpArchive = path.join(os.tmpdir(), `syncbiz-mpv-${Date.now()}.7z`);
  let lastPct = -1;
  await httpsGetBinary(asset.browser_download_url, tmpArchive, (pct) => {
    if (pct !== lastPct && pct % 10 === 0) {
      process.stdout.write(`\r[fetch-mpv] ${pct}%`);
      lastPct = pct;
    }
  });
  process.stdout.write("\r[fetch-mpv] 100% — download complete.\n");

  // ── extract mpv.exe ───────────────────────────────────────────────────────
  console.log(`[fetch-mpv] Extracting mpv.exe from archive with 7zr…`);
  try {
    execFileSync(
      SEVENZIP,
      [
        "e",           // extract (flat — no directory structure)
        tmpArchive,
        `-o${OUT_DIR}`, // output directory
        "mpv.exe",     // only extract this file
        "-y",          // yes to all prompts
      ],
      { stdio: "inherit" },
    );
  } finally {
    try { fs.unlinkSync(tmpArchive); } catch { /* ignore */ }
  }

  if (!fs.existsSync(OUT_FILE)) {
    throw new Error(
      `Extraction finished but mpv.exe not found at ${OUT_FILE}.\n` +
        "The archive may have a different internal structure — check the .7z contents manually.",
    );
  }

  const sizeMB = (fs.statSync(OUT_FILE).size / 1024 / 1024).toFixed(1);
  console.log(`[fetch-mpv] ✓ mpv.exe ready at ${OUT_FILE} (${sizeMB} MB, release ${version})`);
}

main().catch((err) => {
  console.error("\n[fetch-mpv] ERROR:", err.message || err);
  process.exit(1);
});
