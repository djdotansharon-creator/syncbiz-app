// POC-ONLY Drive provider (isolated, dev-only). This is the SEAM that in production moves
// server-side (SyncBiz backend/storage holds provider auth). MPV/player never import this.
// Auth: a throwaway dev OAuth access token in .env.poc-drive.local (gitignored, never shipped).
import { readFileSync } from "node:fs";

const API = "https://www.googleapis.com/drive/v3/files";
export const FOLDER_MIME = "application/vnd.google-apps.folder";

export function loadDriveConfig(envPath) {
  const t = readFileSync(envPath, "utf8");
  const get = (k) => (t.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1]?.trim();
  const token = get("SYNCBIZ_POC_DRIVE_ACCESS_TOKEN");
  const folderId = get("SYNCBIZ_POC_DRIVE_FOLDER_ID");
  if (!token || !folderId) throw new Error("missing SYNCBIZ_POC_DRIVE_ACCESS_TOKEN / _FOLDER_ID in " + envPath);
  return { token, folderId };
}

export async function listChildren(token, parentId) {
  const u = new URL(API);
  u.searchParams.set("q", `'${parentId}' in parents and trashed=false`);
  u.searchParams.set("fields", "files(id,name,size,md5Checksum,modifiedTime,mimeType)");
  u.searchParams.set("pageSize", "200");
  const r = await fetch(u, { headers: { Authorization: "Bearer " + token } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("drive.list http=" + r.status + " " + JSON.stringify(j).slice(0, 200));
  return j.files || [];
}

/** Shallow recursive walk (depth <= maxDepth). Returns FILES only, each with its parent path. */
export async function listFilesRecursive(token, rootId, maxDepth = 2) {
  const queue = [{ id: rootId, depth: 0, path: "" }];
  const files = [];
  let listed = 0;
  while (queue.length && listed < 40) {
    const { id, depth, path } = queue.shift();
    const kids = await listChildren(token, id); listed++;
    for (const f of kids) {
      if (f.mimeType === FOLDER_MIME) { if (depth < maxDepth) queue.push({ id: f.id, depth: depth + 1, path: path + "/" + f.name }); }
      else files.push({ id: f.id, name: f.name, size: f.size, md5: f.md5Checksum, modifiedTime: f.modifiedTime, mimeType: f.mimeType, path });
    }
  }
  return files;
}

/** Stream a Drive file's bytes into a Node writable. Returns byte count. */
export async function downloadToStream(token, fileId, writeStream) {
  const r = await fetch(API + "/" + fileId + "?alt=media", { headers: { Authorization: "Bearer " + token } });
  if (!r.ok) throw new Error("drive.download http=" + r.status);
  if (!r.body) throw new Error("drive.download: empty body");
  const reader = r.body.getReader();
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    await new Promise((res, rej) => writeStream.write(Buffer.from(value), (e) => (e ? rej(e) : res())));
  }
  return bytes;
}
