import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";

/**
 * GET /api/artist-search?q=משה → { artists: [{ name, photo, views }] }
 *
 * "Every well-known singer who goes by this name" for the search results' artist row (owner 2026-10-18: typing
 * "משה" must give Moshe Peretz AND Moshe Koresia, not one of them). Source: the public Wikipedia API (he/en by the
 * script of the query). Strict: the page title must carry every query word, look like a person/band name, and the
 * description must say singer/musician/… (so politicians, albums, songs never show). Ranked by real fame: the page's
 * last-3-months views from the Wikimedia REST pageviews API; only the clearly famous ones are kept (≥30% of the top
 * one's traffic, max 8). Cached 24h in memory; any failure → empty list.
 */

type Artist = { name: string; photo: string | null; views: number };

const CACHE_TTL_MS = 24 * 60 * 60_000;
const CACHE_MAX = 300;
const cache = new Map<string, { at: number; artists: Artist[] }>();
const UA = "SyncBizPlayer/1.0 (support@syncbiz.app)";
const MUSIC_DESC = /singer|musician|rapper|vocalist|\bband\b|composer|songwriter|\bdj\b|zmer|זמר|זמרת|מוזיקא|להקה|ראפר|יוצר|מלחין|צמד|די.?ג.?יי/i;
const NOT_PERSON_DESC = /\b(album|song|single|film|series|award|festival|competition)\b|אלבום|שיר\b|סינגל|פירושונים|שם משפחה|סרט|סדרה|פרס|פסטיבל|תחרות/i;
const SEARCH_TERMS: Record<"he" | "en", string> = {
  he: "(זמר OR זמרת OR מוזיקאי OR מוזיקאית OR להקה OR ראפר OR זמרת-יוצרת)",
  en: "(singer OR musician OR rapper OR vocalist OR band OR songwriter)",
};

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[֑-ׇ̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

type WikiPage = { index?: number; title?: string; description?: string; thumbnail?: { source?: string } };

async function searchPages(lang: "he" | "en", gsrsearch: string, limit: number): Promise<WikiPage[] | null> {
  const api =
    `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&generator=search` +
    `&gsrsearch=${encodeURIComponent(gsrsearch)}&gsrlimit=${limit}` +
    `&prop=pageimages|description&piprop=thumbnail&pithumbsize=160&pilimit=${limit}`;
  try {
    const res = await fetch(api, { signal: AbortSignal.timeout(2800), headers: { "User-Agent": UA } });
    if (!res.ok) return null;
    const data = (await res.json()) as { query?: { pages?: Record<string, WikiPage & { pageid?: number }> } };
    return Object.values(data.query?.pages ?? {}).sort((a, b) => (a.index ?? 99) - (b.index ?? 99));
  } catch {
    return null;
  }
}

/** Two complementary lookups in parallel: pages whose TITLE carries the words and whose text talks about
 *  singing (finds every "Moshe …"), plus the plain search (puts the exact big name first, e.g. "shakira"). */
async function search(lang: "he" | "en", want: string[], raw: string): Promise<{ pages: WikiPage[]; complete: boolean }> {
  const intitle = want.map((w) => `intitle:${w}`).join(" ");
  const [a, b] = await Promise.all([
    searchPages(lang, `${intitle} ${SEARCH_TERMS[lang]}`, 40),
    searchPages(lang, raw, 20),
  ]);
  const seen = new Set<string>();
  const out: WikiPage[] = [];
  for (const p of [...(b ?? []), ...(a ?? [])]) {
    const title = (p.title ?? "").replace(/\s*\([^)]*\)\s*$/, "").trim();
    const tk = tokens(title);
    const desc = p.description ?? "";
    if (!title || seen.has(title)) continue;
    if (!want.every((w) => tk.includes(w))) continue;
    if (tk.length > want.length + 2) continue; // a person / band name, not a long article title
    if (!MUSIC_DESC.test(desc) || NOT_PERSON_DESC.test(desc)) continue;
    seen.add(title);
    out.push({ ...p, title });
  }
  return { pages: out, complete: a !== null && b !== null };
}

function monthStamp(monthsAgo: number, day: "01" | "28"): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - monthsAgo);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${day}`;
}

async function views(lang: "he" | "en", title: string): Promise<number> {
  try {
    const url =
      `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/${lang}.wikipedia/all-access/user/` +
      `${encodeURIComponent(title.replace(/ /g, "_"))}/monthly/${monthStamp(3, "01")}/${monthStamp(1, "28")}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(1800), headers: { "User-Agent": UA } });
    if (!res.ok) return 0;
    const data = (await res.json()) as { items?: Array<{ views?: number }> };
    return (data.items ?? []).reduce((n, i) => n + (i.views ?? 0), 0);
  } catch {
    return 0;
  }
}

export async function GET(req: NextRequest) {
  // signed-in only (PR #61 review 2026-10-23): these routes spend server resources (yt-dlp / outbound searches) — no anonymous callers
  if (!(await getCurrentUserFromCookies())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const want = tokens(q);
  if (q.length < 2 || q.length > 40 || want.length === 0 || want.length > 3) return NextResponse.json({ artists: [] });
  const key = want.join(" ");
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return NextResponse.json({ artists: hit.artists });
  const lang: "he" | "en" = /[֐-׿]/.test(q) ? "he" : "en";
  let artists: Artist[] = [];
  let complete = false;
  try {
    const found = await search(lang, want, q);
    complete = found.complete;
    const pages = found.pages.slice(0, 16);
    const scored = await Promise.all(pages.map(async (p) => ({ p, v: await views(lang, p.title ?? "") })));
    // Only singers with a real name (owner 2026-10-18: no random accounts): a page must keep at least 30% of the
    // most-read one's traffic (and not be obscure) — "אביב" → Geffen + Alush only. Everyone else: search the exact name.
    const ranked = scored.sort((a, b) => b.v - a.v);
    const top = ranked[0]?.v ?? 0;
    const floor = Math.max(300, top * 0.3);
    artists = ranked
      .filter(({ v }) => v >= floor)
      .slice(0, 8)
      .map(({ p, v }) => ({ name: p.title ?? "", photo: p.thumbnail?.source && !/\.svg/i.test(p.thumbnail.source) ? p.thumbnail.source : null, views: v }));
  } catch {
    artists = [];
  }
  // a partial answer (Wikipedia slow / rate-limited) is never kept — the next search asks again
  if (!complete) return NextResponse.json({ artists });
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(key, { at: Date.now(), artists });
  return NextResponse.json({ artists });
}
