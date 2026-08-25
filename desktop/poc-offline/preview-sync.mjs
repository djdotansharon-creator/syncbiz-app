// POC-ONLY Royalty-Free Music PREVIEW sync (dynamic genre discovery).
// Discovers EVERY direct subfolder under the Drive root as a Genre Pack, downloads all of its sample
// audio into a SEPARATE preview cache (desktop/.poc-preview-cache), and records genre structure in the
// manifest. No hardcoded genre list — add a folder in Drive and it appears after the next sync.
//
// This preview cache is NOT the offline playlist. It only lets samples be heard in the POC; nothing
// here is ever marked OFFLINE READY. Run: `node desktop/poc-offline/preview-sync.mjs`.
// Reuses the proven atomic download + md5/size verify + local manifest from cache.mjs / drive.mjs.
// Isolated: touches nothing in the player / getPlayUrl / WS / MASTER-CONTROL. Emits NOTHING over WS.
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { loadDriveConfig, listChildren, FOLDER_MIME } from "./drive.mjs";
import {
  cacheDirs, sweepPartials, assetIdFor, downloadVerifyAtomic,
  loadManifest, saveManifest, assetReady,
} from "./cache.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const CACHE_ROOT = process.env.POC_PREVIEW_CACHE_ROOT || join(REPO, "desktop", ".poc-preview-cache");
const ENV_PATH = join(REPO, ".env.poc-drive.local");

/** "LR100 - Soul & RNB" → "Soul & RNB" (internal naming prefix stripped for display only). */
function displayNameFromFolder(name) {
  return String(name || "").replace(/^\s*LR\d+\s*-\s*/i, "").trim() || String(name || "").trim();
}
/** Stable, code-free genre id derived from the display name. */
function slugify(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "genre";
}
/** Best-effort duration via ffprobe (catalog metadata + 15-min demo). null if unavailable. */
function probeDuration(absPath) {
  try {
    const r = spawnSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=nk=1:nw=1", absPath],
      { encoding: "utf8" },
    );
    if (r.status === 0) {
      const d = parseFloat(String(r.stdout || "").trim());
      if (Number.isFinite(d) && d > 0) return Math.round(d);
    }
  } catch { /* ffprobe not present → null */ }
  return null;
}

async function sync() {
  const { token, folderId } = loadDriveConfig(ENV_PATH);
  const dirs = cacheDirs(CACHE_ROOT);
  const swept = sweepPartials(dirs);
  if (swept) console.log("swept stray .part:", swept);

  console.log("discovering genre folders under Drive root…");
  const rootChildren = await listChildren(token, folderId);
  const genreFolders = rootChildren
    .filter((f) => f.mimeType === FOLDER_MIME)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  console.log(`found ${genreFolders.length} genre folder(s)`);

  const m = loadManifest(dirs);
  m.assets = m.assets || {};
  m.genres = m.genres || {};
  m.source = "drive-preview-samples";

  let ready = 0, failed = 0, totalAudio = 0;
  const seenGenreIds = new Set();

  for (const gf of genreFolders) {
    const displayName = displayNameFromFolder(gf.name);
    let genreId = slugify(displayName);
    while (seenGenreIds.has(genreId) && m.genres[genreId]?.folderId !== gf.id) genreId += "-x";
    seenGenreIds.add(genreId);
    m.genres[genreId] = { folderId: gf.id, folderName: gf.name, displayName };

    const kids = await listChildren(token, gf.id);
    const audio = kids.filter((f) => f.size && f.md5Checksum && /audio\//.test(f.mimeType || ""));
    totalAudio += audio.length;
    console.log(`\n[${displayName}] (${genreId}) — ${audio.length} sample(s)`);

    for (const raw of audio) {
      const f = { id: raw.id, name: raw.name, size: raw.size, md5: raw.md5Checksum, modifiedTime: raw.modifiedTime };
      const assetId = assetIdFor(f.id);
      const prev = m.assets[assetId];
      const stale = prev && prev.contentHash !== f.md5;
      if (prev && !stale && assetReady(dirs, m, assetId)) {
        m.assets[assetId] = {
          ...prev, genreId,
          durationSeconds: prev.durationSeconds ?? probeDuration(join(dirs.base, prev.localPath)),
        };
        ready++; continue;
      }
      m.assets[assetId] = {
        ...(prev || {}), name: f.name, driveFileId: f.id, size: f.size, contentHash: f.md5,
        hashAlgo: "md5", modifiedTime: f.modifiedTime, genreId, status: "downloading",
      };
      saveManifest(dirs, m);
      try {
        const r = await downloadVerifyAtomic(token, f, dirs);
        const duration = probeDuration(join(dirs.base, r.localPath));
        m.assets[assetId] = {
          ...m.assets[assetId], ext: r.ext, localPath: r.localPath, durationSeconds: duration,
          status: "ready", downloadedAt: new Date().toISOString(), verifiedAt: new Date().toISOString(),
        };
        ready++; console.log(`  ✓ ${f.name}${duration ? ` (${duration}s)` : ""}`);
      } catch (e) {
        m.assets[assetId] = { ...m.assets[assetId], status: "error", error: String(e.message) };
        failed++; console.log(`  ✗ ${f.name}: ${e.message}`);
      }
      saveManifest(dirs, m);
    }
  }

  m.updatedAt = new Date().toISOString();
  saveManifest(dirs, m);
  console.log(`\n=== preview cache: ${genreFolders.length} genres, ${totalAudio} samples found, ${ready} ready, ${failed} failed ===`);
  console.log("cache:", dirs.base);
  console.log("next: node desktop/poc-offline/build-music-bank-catalog.mjs");
  return failed === 0 && ready > 0;
}

sync().then((ok) => { process.exitCode = ok ? 0 : 1; }).catch((e) => { console.error("PREVIEW SYNC ERROR:", e.message); process.exitCode = 1; });
