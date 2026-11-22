/**
 * A PERSON'S VONO ID — "name#1234" (owner 2026-11-22: "a user name + # + a number, so people can share to each other and I can add people to a business easily, besides the barcode").
 * PURE helpers for the sharing foundation (docs/PLAYLIST_SHARING_DESIGN.md). DORMANT: nothing assigns, stores or looks up an ID yet; `User.handle` exists in the schema and is null for everyone.
 *   · lowercase Latin letters, digits and . _ - in the name part (a Hebrew-only name falls back to "user" — the person can pick their own later); a 4-digit number 1000–9999 after the "#";
 *   · a person is found ONLY by the EXACT ID (no browsing, no partial search) — so nobody can list the users of VONO.
 */

export const HANDLE_MAX_NAME = 20;
export const HANDLE_TAG_MIN = 1000;
export const HANDLE_TAG_MAX = 9999;

/** the name part of an ID from a person's display name: lowercase Latin letters / digits / . _ -, accents folded, at most 20 characters; "user" when nothing usable is left. */
export function slugifyHandleName(name: string | null | undefined): string {
  const folded = String(name ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, ".")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/[._-]{2,}/g, ".")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, HANDLE_MAX_NAME)
    .replace(/[._-]+$/g, "");
  return folded || "user";
}

export function formatHandle(base: string, tag: number): string {
  return `${base}#${tag}`;
}

/** "Dotan#4821", " @dotan#4821 " → { base: "dotan", tag: 4821 }; anything that is not exactly an ID → null. */
export function parseHandle(input: string | null | undefined): { base: string; tag: number; handle: string } | null {
  const m = /^@?([a-z0-9][a-z0-9._-]{0,19})#(\d{4})$/.exec(String(input ?? "").trim().toLowerCase());
  if (!m) return null;
  const tag = Number(m[2]);
  if (tag < HANDLE_TAG_MIN || tag > HANDLE_TAG_MAX) return null;
  return { base: m[1]!, tag, handle: formatHandle(m[1]!, tag) };
}

/** the IDs to try, in order, for a person: their name with random 4-digit numbers (`random` returns 0 ≤ x < 1; injectable so it is testable). Never repeats a number. */
export function candidateHandles(name: string | null | undefined, count = 8, random: () => number = Math.random): string[] {
  const base = slugifyHandleName(name);
  const seen = new Set<number>();
  const out: string[] = [];
  let guard = 0;
  while (out.length < count && guard++ < count * 20) {
    const tag = HANDLE_TAG_MIN + Math.floor(random() * (HANDLE_TAG_MAX - HANDLE_TAG_MIN + 1));
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push(formatHandle(base, tag));
  }
  return out;
}
