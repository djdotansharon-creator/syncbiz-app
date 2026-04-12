/** Same guard as desktop renderer — only http(s) artwork in shared hero. */
export function isSafeHttpCoverUrl(url: string | null | undefined): url is string {
  if (!url || typeof url !== "string") return false;
  const t = url.trim();
  return /^https?:\/\//i.test(t);
}
