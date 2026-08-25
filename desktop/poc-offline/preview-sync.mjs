// POC-ONLY Royalty-Free Music PREVIEW sync (catalog samples).
// Downloads ALL sample audio from the four Drive genre folders into a SEPARATE preview cache
// (desktop/.poc-preview-cache) so the Sales Catalog can play every sample through the real chain.
//
// This preview cache is NOT the offline playlist. It only lets samples be heard in the POC; nothing
// here is ever marked OFFLINE READY. Run: `node desktop/poc-offline/preview-sync.mjs`.
// Reuses the proven atomic download + md5/size verify + local manifest from cache.mjs / drive.mjs.
// Isolated: touches nothing in the player / getPlayUrl / WS / MASTER-CONTROL. Emits NOTHING over WS.
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { loadDriveConfig, listFilesRecursive } from "./drive.mjs";
import {
  cacheDirs, sweepPartials, assetIdFor, downloadVerifyAtomic,
  loadManifest, saveManifest, assetReady,
} from "./cache.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const CACHE_ROOT = process.env.POC_PREVIEW_CACHE_ROOT || join(REPO, "desktop", ".poc-preview-cache");
const ENV_PATH = join(REPO, ".env.poc-drive.local");

/** Best-effort duration via ffprobe (used for catalog metadata + 15-min demo). null if unavailable. */
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

  console.log("listing Drive folder (ALL samples)…");
  const all = await listFilesRecursive(token, folderId, 2);
  const audio = all.filter((f) => f.size && f.md5 && /audio\//.test(f.mimeType || ""));
  console.log(`found ${audio.length} audio sample(s) across folders`);

  const m = loadManifest(dirs);
  m.assets = m.assets || {};
  m.source = "drive-preview-samples";

  let ready = 0, failed = 0;
  for (const f of audio) {
    const assetId = assetIdFor(f.id);
    const prev = m.assets[assetId];
    const stale = prev && prev.contentHash !== f.md5;
    if (prev && !stale && assetReady(dirs, m, assetId)) {
      m.assets[assetId] = { ...prev, folder: f.path || prev.folder || "" };
      if (m.assets[assetId].durationSeconds == null) {
        m.assets[assetId].durationSeconds = probeDuration(join(dirs.base, prev.localPath));
      }
      ready++; continue;
    }
    m.assets[assetId] = {
      ...(prev || {}), name: f.name, driveFileId: f.id, size: f.size,
      contentHash: f.md5, hashAlgo: "md5", modifiedTime: f.modifiedTime,
      folder: f.path || "", status: "downloading",
    };
    saveManifest(dirs, m);
    try {
      const r = await downloadVerifyAtomic(token, { id: f.id, name: f.name, size: f.size, md5: f.md5 }, dirs);
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

  m.updatedAt = new Date().toISOString();
  saveManifest(dirs, m);
  console.log(`\n=== preview cache: ${ready} ready, ${failed} failed ===`);
  console.log("cache:", dirs.base);
  console.log("manifest:", dirs.manifestPath);
  console.log("next: node desktop/poc-offline/build-music-bank-catalog.mjs");
  return failed === 0 && ready > 0;
}

sync().then((ok) => { process.exitCode = ok ? 0 : 1; }).catch((e) => { console.error("PREVIEW SYNC ERROR:", e.message); process.exitCode = 1; });
