import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";

/**
 * GET /api/album-search?q=אייל גולן → { artist, mode, albums: [{ id, name, artist, cover, tracks, releaseDate, year, url }] }
 *
 * Albums for the search results' shelf (owner 2026-10-18): all of a singer's albums, NEWEST FIRST, with the album cover and
 * the song count — and a way to search an album by its name. Source: the public iTunes Search API (no key, official):
 * a search finds the artist, a lookup lists every album. Singles are left out. A query that matches no artist falls back to
 * albums whose NAME carries the query. Cached 30 min in memory; any failure → empty list.
 */
type ITunesItem = {
  wrapperType?: string;
  collectionType?: string;
  artistId?: number;
  collectionId?: number;
  artistName?: string;
  collectionName?: string;
  artworkUrl100?: string;
  collectionViewUrl?: string;
  trackCount?: number;
  releaseDate?: string;
};
type Album = { id: string; name: string; artist: string; cover: string | null; tracks: number; releaseDate: string; year: number | null; url: string };

const CACHE_TTL_MS = 30 * 60_000;
const CACHE_MAX = 200;
const cache = new Map<string, { at: number; body: { artist: string | null; mode: "artist" | "title" | "none"; albums: Album[] } }>();
const UA = "SyncBizPlayer/1.0 (support@syncbiz.app)";

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[֑-ׇ̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

async function itunes(path: string): Promise<ITunesItem[] | null> {
  try {
    const res = await fetch(`https://itunes.apple.com/${path}`, { signal: AbortSignal.timeout(4500), headers: { "User-Agent": UA } });
    if (!res.ok) return null;
    const j = (await res.json()) as { results?: ITunesItem[] };
    return j.results ?? [];
  } catch {
    return null;
  }
}

function toAlbum(it: ITunesItem): Album | null {
  if (it.wrapperType !== "collection" || it.collectionType !== "Album" || !it.collectionId || !it.collectionName) return null;
  const name = it.collectionName.trim();
  const tracks = it.trackCount ?? 0;
  if (/\s-\s(single|סינגל)$/i.test(name) || tracks <= 2) return null; // singles are not albums
  const releaseDate = it.releaseDate ?? "";
  const year = releaseDate ? new Date(releaseDate).getUTCFullYear() : null;
  return {
    id: String(it.collectionId),
    name: name.replace(/\s-\sEP$/i, " (EP)"),
    artist: it.artistName ?? "",
    cover: it.artworkUrl100 ? it.artworkUrl100.replace(/\/\d+x\d+bb\./, "/400x400bb.") : null,
    tracks,
    releaseDate,
    year: Number.isFinite(year as number) ? year : null,
    url: it.collectionViewUrl ?? "",
  };
}

function dedupe(list: Album[]): Album[] {
  const seen = new Map<string, Album>();
  for (const a of list) {
    const key = tokens(a.name.replace(/\([^)]*\)/g, "")).join(" ") + "|" + a.artist;
    const prev = seen.get(key);
    if (!prev || a.releaseDate > prev.releaseDate) seen.set(key, a);
  }
  return [...seen.values()];
}

export async function GET(req: NextRequest) {
  // signed-in only (PR #61 review 2026-10-23): these routes spend server resources (yt-dlp / outbound searches) — no anonymous callers
  if (!(await getCurrentUserFromCookies())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const want = tokens(q);
  if (q.length < 2 || q.length > 60 || want.length === 0) return NextResponse.json({ artist: null, mode: "none", albums: [] });
  const key = want.join(" ");
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return NextResponse.json(hit.body);

  const enc = encodeURIComponent(q);
  let found = await itunes(`search?term=${enc}&entity=album&limit=50&country=IL`);
  if (found && found.length === 0) found = await itunes(`search?term=${enc}&entity=album&limit=50&country=US`);
  let body: { artist: string | null; mode: "artist" | "title" | "none"; albums: Album[] } = { artist: null, mode: "none", albums: [] };
  let complete = found !== null;
  if (found) {
    // is the query a SINGER? Group the hits by artist, ignore collaboration credits ("A, B & C"), then take the artist whose
    // name carries every query word — or, when the spelling differs (Hebrew query, "Peretz"/"Perez"), the one that owns
    // a clear share of all the hits.
    const hebrew = /[֐-׿]/.test(q);
    const byArtist = new Map<number, { name: string; n: number }>();
    for (const it of found) {
      if (!it.artistId || !it.artistName) continue;
      if (/[,&]|\b(feat|ft)\b/i.test(it.artistName) || tokens(it.artistName).length > 4) continue;
      const e = byArtist.get(it.artistId) ?? { name: it.artistName, n: 0 };
      e.n++;
      byArtist.set(it.artistId, e);
    }
    const ranked = [...byArtist.entries()].sort((a, b) => b[1].n - a[1].n);
    let top = ranked.find(([, e]) => {
      const at = tokens(e.name);
      return want.every((w) => at.some((t) => t.startsWith(w)));
    });
    if (!top) {
      const dom = ranked[0];
      const share = dom ? dom[1].n / found.length : 0;
      const firstOk = dom ? tokens(dom[1].name).some((t) => want.some((w) => t.startsWith(w))) : false;
      if (dom && dom[1].n >= 6 && share >= 0.4 && (hebrew || firstOk)) top = dom;
    }
    if (top) {
      const all = await itunes(`lookup?id=${top[0]}&entity=album&limit=200&country=IL`);
      if (all === null) complete = false;
      const albums = dedupe((all ?? found).map(toAlbum).filter((a): a is Album => !!a && true));
      albums.sort((a, b) => (b.releaseDate || "").localeCompare(a.releaseDate || ""));
      body = { artist: top[1].name, mode: "artist", albums: albums.slice(0, 60) };
    } else {
      // an album NAME: keep albums whose title carries (most of) the query
      const need = Math.max(1, Math.ceil(want.length * 0.8));
      const albums = dedupe(
        found
          .map(toAlbum)
          .filter((a): a is Album => !!a)
          .filter((a) => {
            const nt = tokens(a.name);
            return want.filter((w) => nt.some((t) => t.startsWith(w))).length >= need;
          }),
      );
      body = { artist: null, mode: albums.length > 0 ? "title" : "none", albums: albums.slice(0, 24) };
    }
  }
  if (complete) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(key, { at: Date.now(), body });
  }
  return NextResponse.json(body);
}
