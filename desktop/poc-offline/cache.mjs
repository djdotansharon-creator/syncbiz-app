// POC-ONLY media cache + local manifest. Atomic download (never hands MPV a partial file),
// md5+size verification, idempotent skip, stale detection, OFFLINE READY computation.
import { createHash } from "node:crypto";
import {
  mkdirSync, existsSync, createWriteStream, renameSync, rmSync,
  readdirSync, readFileSync, writeFileSync, statSync,
} from "node:fs";
import { join } from "node:path";
import { downloadToStream } from "./drive.mjs";

export function cacheDirs(root) {
  const tmp = join(root, "tmp");
  mkdirSync(tmp, { recursive: true });
  return { base: root, tmp, manifestPath: join(root, "manifest.json") };
}

/** Stable logical asset id (constant even if the file's CONTENT later changes). */
export function assetIdFor(driveFileId) {
  return "a_" + createHash("sha1").update(driveFileId).digest("hex").slice(0, 16);
}

/** Sweep stray partial downloads so a half-file can never be picked up. */
export function sweepPartials(dirs) {
  let n = 0;
  for (const f of readdirSync(dirs.tmp)) if (f.endsWith(".part")) { rmSync(join(dirs.tmp, f), { force: true }); n++; }
  return n;
}

function md5File(p) { return createHash("md5").update(readFileSync(p)).digest("hex"); }

/** Download to a .part, verify size+md5, and ONLY THEN atomically rename to the final path. */
export async function downloadVerifyAtomic(token, driveFile, dirs) {
  const assetId = assetIdFor(driveFile.id);
  const ext = (driveFile.name.match(/\.[a-z0-9]+$/i) || [""])[0].toLowerCase() || ".bin";
  const finalPath = join(dirs.base, assetId + ext);
  const partPath = join(dirs.tmp, assetId + ext + ".part");

  const ws = createWriteStream(partPath);
  let bytes;
  try {
    bytes = await downloadToStream(token, driveFile.id, ws);
    await new Promise((res, rej) => ws.end((e) => (e ? rej(e) : res())));
  } catch (e) {
    try { ws.destroy(); } catch {}
    rmSync(partPath, { force: true });
    throw e;
  }

  const sizeOk = String(bytes) === String(driveFile.size);
  const md5 = md5File(partPath);
  const md5Ok = md5 === driveFile.md5;
  if (!sizeOk || !md5Ok) {
    rmSync(partPath, { force: true });
    throw new Error(`verify failed (size=${sizeOk} md5=${md5Ok}) for ${driveFile.name}`);
  }
  renameSync(partPath, finalPath); // atomic on same volume
  return { assetId, ext, localPath: assetId + ext, finalPath, bytes, md5 };
}

export function loadManifest(dirs) {
  if (!existsSync(dirs.manifestPath)) return { manifestVersion: 1, assets: {}, playlists: {} };
  try { return JSON.parse(readFileSync(dirs.manifestPath, "utf8")); }
  catch { return { manifestVersion: 1, assets: {}, playlists: {} }; }
}

export function saveManifest(dirs, m) {
  const tmp = dirs.manifestPath + ".tmp";
  writeFileSync(tmp, JSON.stringify(m, null, 2));
  renameSync(tmp, dirs.manifestPath);
}

/** True only if the asset is marked ready AND its file exists on disk AND its size matches. */
export function assetReady(dirs, m, assetId) {
  const a = m.assets[assetId];
  if (!a || a.status !== "ready" || !a.localPath) return false;
  const p = join(dirs.base, a.localPath);
  if (!existsSync(p)) return false;
  try { return String(statSync(p).size) === String(a.size); } catch { return false; }
}

/** A playlist is OFFLINE READY only when EVERY one of its assets is ready+present+verified. */
export function computeOfflineReady(dirs, m, playlistId) {
  const pl = m.playlists[playlistId];
  if (!pl || !pl.assetIds?.length) return false;
  return pl.assetIds.every((id) => assetReady(dirs, m, id));
}

/** Resolve absolute local paths of a playlist's assets in order (for MPV in Stage 2). */
export function playlistLocalPaths(dirs, m, playlistId) {
  const pl = m.playlists[playlistId];
  if (!pl) return [];
  return pl.assetIds.map((id) => join(dirs.base, m.assets[id]?.localPath || "")).filter((p) => existsSync(p));
}
