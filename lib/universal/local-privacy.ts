/**
 * Phase C — local-file privacy helpers.
 *
 * An absolute local filesystem path (e.g. D:\Playlistpro\Dropbox\MUSIC\...) must NEVER be
 * stored in Postgres or shared — it leaks the customer's folder structure. The universal
 * layer keeps only an OPAQUE reference (a salted hash) + the bare filename. The full path
 * stays on the desktop.
 */

import crypto from "node:crypto";

/** Opaque, stable reference for a local file — a SHA-256 of the normalized path. No path leaks. */
export function hashLocalPath(absolutePath: string, deviceId?: string): string {
  const norm = (absolutePath ?? "").trim().replace(/\\/g, "/").toLowerCase();
  const salt = (deviceId ?? "").trim();
  return "loc_" + crypto.createHash("sha256").update(`${salt}\u0000${norm}`).digest("hex").slice(0, 32);
}

/** Bare filename (no directory) — safe to display/share. */
export function filenameOnly(p: string): string {
  const s = (p ?? "").trim().replace(/\\/g, "/");
  const base = s.split("/").filter(Boolean).pop() ?? "";
  return base || s;
}

/** True if a string looks like an absolute local path (must be hashed before persisting). */
export function looksLikeLocalPath(s: string): boolean {
  const t = (s ?? "").trim();
  return /^[a-zA-Z]:[\\/]/.test(t) || t.startsWith("/") || t.startsWith("file:") || t.startsWith("local://");
}
