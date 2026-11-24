/**
 * "created by <name>" under a playlist's name (owner 2026-11-22 — people build playlists for businesses as work). PURE.
 * The line shows a person's DISPLAY name only — never an email, never an ID — and nothing at all for a playlist made before the creator was recorded.
 */
export function creatorDisplayName(u: { name?: string | null; firstName?: string | null; lastName?: string | null } | null | undefined): string | undefined {
  if (!u) return undefined;
  const direct = (u.name ?? "").trim();
  if (direct) return direct;
  const joined = [u.firstName, u.lastName].map((x) => (x ?? "").trim()).filter(Boolean).join(" ");
  return joined || undefined;
}
