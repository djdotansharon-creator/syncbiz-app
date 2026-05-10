/** Same guard as desktop renderer — only http(s) artwork in shared hero. */
export function isSafeHttpCoverUrl(url: string | null | undefined): url is string {
  if (!url || typeof url !== "string") return false;
  const t = url.trim();
  return /^https?:\/\//i.test(t);
}

/**
 * Library tiles may show IPC `data:image/*` covers; keep a tight allowlist (no arbitrary data:).
 */
export function isSafeLibraryCoverUrl(url: string | null | undefined): url is string {
  if (!url || typeof url !== "string") return false;
  const t = url.trim();
  if (/^https?:\/\//i.test(t)) return true;
  return /^data:image\/(png|jpeg|jpg|webp|gif|svg\+xml)(;|,)/i.test(t);
}
