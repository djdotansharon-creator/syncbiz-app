import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/artist-image?name=Eyal%20Golan → { url: string | null }
 *
 * The singer's real photo for the search results' artist card. Source: the public Wikipedia API (the page image of
 * the best-matching musician page; he/en depending on the script of the name) — an official API, nothing is scraped.
 * Strict matching (every word of the name must be in the page title + the description must say singer/musician/…)
 * so a wrong person is never shown; null → the UI keeps the video thumbnail. Cached 24h in memory.
 */

const CACHE_TTL_MS = 24 * 60 * 60_000;
const CACHE_MAX = 300;
const cache = new Map<string, { at: number; url: string | null }>();
const UA = "SyncBizPlayer/1.0 (support@syncbiz.app)";
const MUSIC_DESC = /singer|musician|rapper|vocalist|band|composer|songwriter|dj\b|producer|artist|זמר|זמרת|מוזיק|להקה|ראפר|יוצר|מלחין|די.?ג׳יי/i;

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[֑-ׇ̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

async function wikiThumb(lang: "he" | "en", name: string): Promise<string | null> {
  const api =
    `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&generator=search` +
    `&gsrsearch=${encodeURIComponent(name)}&gsrlimit=4&prop=pageimages|description&piprop=thumbnail&pithumbsize=480&pilimit=4`;
  const res = await fetch(api, { signal: AbortSignal.timeout(3500), headers: { "User-Agent": UA } });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    query?: { pages?: Record<string, { index?: number; title?: string; description?: string; thumbnail?: { source?: string } }> };
  };
  const pages = Object.values(data.query?.pages ?? {}).sort((a, b) => (a.index ?? 9) - (b.index ?? 9));
  const want = tokens(name);
  for (const p of pages) {
    const title = tokens(p.title ?? "");
    const allIn = want.length > 0 && want.every((w) => title.includes(w));
    if (allIn && p.thumbnail?.source && !/\.svg/i.test(p.thumbnail.source) && MUSIC_DESC.test(p.description ?? "")) return p.thumbnail.source;
  }
  return null;
}

export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name")?.trim();
  if (!name || name.length < 2 || name.length > 60) return NextResponse.json({ url: null });
  const key = name.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return NextResponse.json({ url: hit.url });
  const hebrew = /[֐-׿]/.test(name);
  const order: Array<"he" | "en"> = hebrew ? ["he", "en"] : ["en", "he"];
  let url: string | null = null;
  for (const lang of order) {
    try {
      url = await wikiThumb(lang, name);
    } catch {
      url = null;
    }
    if (url) break;
  }
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(key, { at: Date.now(), url });
  return NextResponse.json({ url });
}
