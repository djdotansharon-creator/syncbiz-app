/**
 * Unified URL parser: extracts title, cover, genre, type from any URL.
 * Image priority: thumbnail > og:image > favicon > default
 * Title: media title > og:title > page title > domain
 */

import { NextRequest, NextResponse } from "next/server";
import { inferPlaylistType, getYouTubeThumbnail, getYouTubeVideoId, isShazamUrl, extractShazamSongFromPath, classifyMusicUrlIngest, isWeakStorefrontParsedTitle } from "@/lib/playlist-utils";
import { inferGenre } from "@/lib/infer-genre";
import { resolveYouTubeMetadata } from "@/lib/youtube-metadata-resolver";
import type { MusicStreamingProvider, ParseUrlJson } from "@/lib/source-types";
import { parseUrlFoundationHints } from "@/lib/source-types";

/** Stage 6C: try noembed for storefront track URLs typed as generic `stream-url`. */
const NOEMBED_FOR_EXTERNAL_RESOLVE_PROVIDERS = new Set<MusicStreamingProvider>([
  "spotify",
  "apple_music",
  "beatport",
  "beatsource",
  "deezer",
  "tidal",
  "amazon_music",
  "qobuz",
  "bandcamp",
  "juno_download",
]);

const DEFAULT_GENRE = "Mixed";
const LIVE_RADIO_GENRE = "Live Radio";
const RADIO_DEFAULT_IMAGE = "/radio-default.svg";

function isValidUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function isStreamOrRadioUrl(url: string): boolean {
  const u = url.toLowerCase();
  return (
    u.match(/\.(m3u8?|pls|aac|mp3)(\?|$)/i) !== null ||
    u.includes("/stream") ||
    u.includes("/live") ||
    u.includes("/radio")
  );
}

function extractDomain(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    return host.split(".").slice(0, -1).join(".") || host;
  } catch {
    return "Unknown";
  }
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function resolveUrl(href: string, base: string): string {
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
}

function parseOgTitle(html: string): string | null {
  const m =
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
  return m ? decodeHtml(m[1]) : null;
}

function parseOgImage(html: string): string | null {
  const m =
    html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  return m ? decodeHtml(m[1]) : null;
}

const SHAZAM_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** SSRF guard: only Shazam-owned domains may be fetched/redirected to. */
function isAllowedShazamHost(hostname: string): boolean {
  const host = hostname.replace(/^www\./i, "").toLowerCase();
  // Reject anything that looks like an IP / loopback / metadata host.
  if (/[^a-z0-9.-]/i.test(host) || /^\d+\./.test(host) || host === "localhost" || host.includes(":")) {
    return false;
  }
  return host === "shazam.com" || host.endsWith(".shazam.com") || host === "shz.am";
}

/**
 * Fetch a Shazam page safely, following shz.am short-link redirects by hand.
 * Security: HTTPS only, every hop's host must pass `isAllowedShazamHost`
 * (blocks SSRF + redirects to external domains), and hops are capped (blocks
 * redirect loops). Reuses the existing og-metadata parse — no new scraper.
 * Returns the final page HTML, or null on any violation/failure.
 */
async function safeFetchShazamPage(startUrl: string): Promise<{ finalUrl: string; html: string } | null> {
  const MAX_HOPS = 5;
  let current = startUrl;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    let u: URL;
    try {
      u = new URL(current);
    } catch {
      return null;
    }
    if (u.protocol !== "https:") return null;
    if (!isAllowedShazamHost(u.hostname)) return null;
    let res: Response;
    try {
      res = await fetch(current, {
        redirect: "manual",
        signal: AbortSignal.timeout(8000),
        headers: { "User-Agent": SHAZAM_UA },
      });
    } catch {
      return null;
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return null;
      let next: URL;
      try {
        next = new URL(loc, current);
      } catch {
        return null;
      }
      if (next.protocol !== "https:" || !isAllowedShazamHost(next.hostname)) return null;
      current = next.toString();
      continue;
    }
    if (res.ok) {
      return { finalUrl: current, html: await res.text() };
    }
    return null;
  }
  return null; // too many hops → treat as a redirect loop
}

function parseTitleTag(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? decodeHtml(m[1].trim()) : null;
}

function parseFavicon(html: string, baseUrl: string): string | null {
  const m =
    html.match(/<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']+)["']/i) ??
    html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["'](?:shortcut )?icon["']/i);
  return m ? resolveUrl(decodeHtml(m[1]), baseUrl) : null;
}

function parseTwitterCardTitle(html: string): string | null {
  const m =
    html.match(/<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:title["']/i);
  return m ? decodeHtml(m[1]) : null;
}

async function fetchSpotifyOfficialOEmbed(trackUrl: string): Promise<{
  title?: string;
  author_name?: string;
  thumbnail_url?: string;
} | null> {
  try {
    const ep = `https://open.spotify.com/oembed?url=${encodeURIComponent(trackUrl)}`;
    const res = await fetch(ep, {
      headers: {
        Accept: "application/json",
        /** Spotify/CDN often 403/empty with bot-like agents; mimic a real browser. */
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: "https://open.spotify.com/",
      },
      signal: AbortSignal.timeout(8000),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    /** oEmbed field names vary slightly across providers; normalize. */
    const title =
      (typeof data.title === "string" && data.title) ||
      (typeof data["track_name"] === "string" && (data["track_name"] as string)) ||
      undefined;
    const author_name =
      (typeof data.author_name === "string" && data.author_name) ||
      (typeof data["artist_name"] === "string" && (data["artist_name"] as string)) ||
      undefined;
    const thumbnail_url = typeof data.thumbnail_url === "string" ? data.thumbnail_url : undefined;
    if (!title && !author_name && !thumbnail_url) return null;
    return { title: title?.trim(), author_name: author_name?.trim(), thumbnail_url };
  } catch {
    return null;
  }
}

async function fetchMarketingHtmlPreview(pageUrl: string): Promise<{ title: string | null; cover: string | null }> {
  try {
    const res = await fetch(pageUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(9000),
      redirect: "follow",
    });
    if (!res.ok) return { title: null, cover: null };
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("text/html")) return { title: null, cover: null };
    const html = await res.text();
    const ogTitle = parseOgTitle(html);
    const twTitle = parseTwitterCardTitle(html);
    const titleTag = parseTitleTag(html);
    const ogImage = parseOgImage(html);
    return {
      title: ogTitle ?? twTitle ?? titleTag ?? null,
      cover: ogImage ? resolveUrl(ogImage, pageUrl) : null,
    };
  } catch {
    return { title: null, cover: null };
  }
}

/** Derive structured artist/song from marketing titles (hyphen / middle-dot patterns). */
function applyArtistSongSplitsFromMarketingTitle(out: ParseUrlJson): void {
  if (out.artist && out.song) return;
  const raw = out.title?.trim();
  if (!raw || isWeakStorefrontParsedTitle(raw)) return;
  /** Beatport: "Artist · Title · Beatport" */
  const t = raw.replace(/\s*·\s*/g, " - ");

  const seps = [" — ", " – ", " - ", " | "];
  for (const sep of seps) {
    const i = t.indexOf(sep);
    if (i <= 0) continue;
    const a = t.slice(0, i).trim();
    let b = t.slice(i + sep.length).trim();
    b = b.replace(/\s+[-|·]\s*(beatport|beatsource)(\s+|\.).*$/i, "").trim();
    if (
      a.length >= 2 &&
      b.length >= 2 &&
      !isWeakStorefrontParsedTitle(a) &&
      !isWeakStorefrontParsedTitle(b)
    ) {
      out.artist = a;
      out.song = b;
      out.title = `${a} - ${b}`;
      return;
    }
  }
}

/**
 * Spotify often serves `og:title` as `Track · Artist · Spotify` (track first).
 * Sets semantic `artist` / `song` and display title `Artist - Track`.
 */
function applySpotifyDotTitlePattern(out: ParseUrlJson): void {
  if (out.artist?.trim() && out.song?.trim()) return;
  const raw = out.title?.trim();
  if (!raw || isWeakStorefrontParsedTitle(raw)) return;
  const stripped = raw.replace(/\s*[\u00B7·]\s*spotify\s*(web)?.*$/i, "").trim();
  const parts = stripped.split(/\s*[\u00B7·]\s*/).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return;
  const track = parts[0]!;
  const artist = parts[1]!;
  if (
    track.length >= 1 &&
    artist.length >= 2 &&
    !isWeakStorefrontParsedTitle(artist) &&
    !isWeakStorefrontParsedTitle(track)
  ) {
    out.song = track;
    out.artist = artist;
    out.title = `${artist} - ${track}`;
  }
}

function parseSpotifyJsonLdMusicRecording(html: string): { artist: string; song: string } | null {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const txt = m[1]?.trim();
    if (!txt) continue;
    try {
      const parsed = JSON.parse(txt) as unknown;
      const found = walkJsonLdForSpotifyMusicRecording(parsed);
      if (found) return found;
    } catch {
      /* skip invalid JSON-LD */
    }
  }
  return null;
}

function walkJsonLdForSpotifyMusicRecording(node: unknown): { artist: string; song: string } | null {
  if (node == null) return null;
  if (Array.isArray(node)) {
    for (const x of node) {
      const f = walkJsonLdForSpotifyMusicRecording(x);
      if (f) return f;
    }
    return null;
  }
  if (typeof node !== "object") return null;
  const o = node as Record<string, unknown>;

  if (Array.isArray(o["@graph"])) {
    for (const g of o["@graph"] as unknown[]) {
      const f = walkJsonLdForSpotifyMusicRecording(g);
      if (f) return f;
    }
  }

  const types = o["@type"];
  const isMusicRecording =
    types === "MusicRecording" ||
    (Array.isArray(types) && (types as string[]).includes("MusicRecording"));

  if (isMusicRecording) {
    const song = typeof o.name === "string" ? o.name.trim() : "";
    const by = o.byArtist as Record<string, unknown> | undefined;
    let artist = "";
    if (by && typeof by === "object") {
      if (typeof by.name === "string") artist = by.name.trim();
      else if (Array.isArray(by.name) && typeof by.name[0] === "string") artist = (by.name[0] as string).trim();
    }
    if (
      song.length >= 2 &&
      artist.length >= 2 &&
      !isWeakStorefrontParsedTitle(song) &&
      !isWeakStorefrontParsedTitle(artist)
    ) {
      return { artist, song };
    }
  }

  for (const v of Object.values(o)) {
    if (v !== null && typeof v === "object") {
      const f = walkJsonLdForSpotifyMusicRecording(v);
      if (f) return f;
    }
  }
  return null;
}

/** One HTML fetch: JSON-LD MusicRecording + OG/twitter title fallbacks for Spotify `/track/` URLs */
async function enrichSpotifyTrackPageHtml(trackUrl: string, out: ParseUrlJson): Promise<void> {
  try {
    const res = await fetch(trackUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: "https://open.spotify.com/",
      },
      signal: AbortSignal.timeout(12_000),
      redirect: "follow",
    });
    if (!res.ok) return;
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("text/html")) return;
    const html = await res.text();

    const ld = parseSpotifyJsonLdMusicRecording(html);
    if (ld) {
      out.artist = ld.artist;
      out.song = ld.song;
      out.title = `${ld.artist} - ${ld.song}`;
      const img = parseOgImage(html);
      if (img && !out.cover) out.cover = resolveUrl(img, trackUrl);
      return;
    }

    const og =
      parseOgTitle(html) ?? parseTwitterCardTitle(html) ?? parseTitleTag(html);
    const ogTrim = og?.trim() ?? "";
    if (ogTrim && !isWeakStorefrontParsedTitle(ogTrim)) {
      out.title = ogTrim;
      applySpotifyDotTitlePattern(out);
      applyArtistSongSplitsFromMarketingTitle(out);
      const img = parseOgImage(html);
      if (img && !out.cover) out.cover = resolveUrl(img, trackUrl);
    }
  } catch {
    /* network / parse */
  }
}

export async function POST(req: NextRequest) {
  try {
    const { url } = (await req.json()) as { url?: string };
    const raw = typeof url === "string" ? url.trim() : "";
    if (!raw || !isValidUrl(raw)) {
      return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
    }

    const type = inferPlaylistType(raw);
    const isRadio = isStreamOrRadioUrl(raw) || type === "winamp";
    const isShazam = isShazamUrl(raw);
    const musicUrlIngest = classifyMusicUrlIngest(raw);
    const tryNoembedExternalResolve =
      !isRadio &&
      !isShazam &&
      musicUrlIngest.intent === "resolve_to_youtube" &&
      musicUrlIngest.provider !== "shazam" &&
      NOEMBED_FOR_EXTERNAL_RESOLVE_PROVIDERS.has(musicUrlIngest.provider);

    const result: ParseUrlJson = {
      title: "",
      cover: null,
      genre: isRadio ? LIVE_RADIO_GENRE : DEFAULT_GENRE,
      type: isShazam ? "shazam" : type,
      isRadio,
    };

    if (isShazam) {
      // shz.am short links + shazam.com song/track pages. The safe fetcher
      // follows redirects only within Shazam domains (SSRF-guarded, hop-capped)
      // and reuses the existing og-metadata parse — no new scraper.
      const page = await safeFetchShazamPage(raw);
      const songFromPath = extractShazamSongFromPath(page?.finalUrl ?? raw) ?? extractShazamSongFromPath(raw);
      result.title = songFromPath || "Shazam track";
      if (page) {
        const ogTitle = parseOgTitle(page.html);
        const ogImage = parseOgImage(page.html);
        if (ogTitle) {
          result.title = ogTitle;
          const dash = ogTitle.indexOf(" - ");
          if (dash > 0) {
            result.artist = ogTitle.slice(0, dash).trim();
            result.song = ogTitle.slice(dash + 3).trim();
          }
        }
        if (ogImage) result.cover = resolveUrl(ogImage, page.finalUrl);
      }
      if (!result.song && songFromPath) result.song = songFromPath;
    } else if (type === "youtube" || type === "soundcloud" || type === "spotify" || tryNoembedExternalResolve) {
      /** Spotify official oEmbed first (noembed can be thin); then generic noembed */
      const isSpotify = type === "spotify" || musicUrlIngest.provider === "spotify";
      if (isSpotify) {
        const oeFirst = await fetchSpotifyOfficialOEmbed(raw);
        if (oeFirst) {
          const auth = oeFirst.author_name?.trim();
          const ttl = oeFirst.title?.trim();
          if (
            auth &&
            ttl &&
            !isWeakStorefrontParsedTitle(auth) &&
            !isWeakStorefrontParsedTitle(ttl)
          ) {
            result.artist = auth;
            result.song = ttl;
            result.title = `${auth} - ${ttl}`;
          } else if (ttl && (!result.title?.trim() || isWeakStorefrontParsedTitle(result.title))) {
            result.title = ttl;
            if (
              auth &&
              !isWeakStorefrontParsedTitle(auth) &&
              (!result.song?.trim() || isWeakStorefrontParsedTitle(result.song))
            ) {
              result.artist = auth;
              result.song = ttl;
            }
          }
          if (oeFirst.thumbnail_url && !result.cover) result.cover = oeFirst.thumbnail_url;
        }
      }

      try {
        const res = await fetch(
          `https://noembed.com/embed?url=${encodeURIComponent(raw)}`,
          { signal: AbortSignal.timeout(8000) }
        );
        if (res.ok) {
          const data = (await res.json()) as {
            title?: string;
            thumbnail_url?: string;
            author_name?: string;
          };
          const ttl0 = data.title?.trim();
          const na = data.author_name?.trim();
          /** Do not let noembed overwrite a solid Spotify oEmbed parse */
          const skipNoembedStructured =
            isSpotify &&
            result.artist?.trim() &&
            result.song?.trim() &&
            !isWeakStorefrontParsedTitle(`${result.artist}`) &&
            !isWeakStorefrontParsedTitle(`${result.song}`);
          if (
            !skipNoembedStructured &&
            ttl0 &&
            na &&
            !isWeakStorefrontParsedTitle(na) &&
            (tryNoembedExternalResolve || type === "spotify" || type === "soundcloud")
          ) {
            result.title = `${na} - ${ttl0}`;
            result.artist = na;
            result.song = ttl0;
          } else if (ttl0 && (!result.title?.trim() || isWeakStorefrontParsedTitle(result.title))) {
            result.title = ttl0;
          }
          if (data.thumbnail_url) result.cover = data.thumbnail_url;
        }
      } catch {
        /* noembed failed */
      }

      /** Hyphen / middle-dot marketing lines (Apple / Beatport / generic embeds). */
      if (tryNoembedExternalResolve || isSpotify) {
        applyArtistSongSplitsFromMarketingTitle(result);
      }

      if (isSpotify) {
        applySpotifyDotTitlePattern(result);
      }

      /** Beatport / Beatsource: light OG when embeds stayed weak (Spotify uses `enrichSpotifyTrackPageHtml`). */
      const needsBeatportHtml =
        !isRadio &&
        (musicUrlIngest.provider === "beatport" || musicUrlIngest.provider === "beatsource") &&
        isWeakStorefrontParsedTitle(result.title);

      if (needsBeatportHtml) {
        const og = await fetchMarketingHtmlPreview(raw);
        const candidate = og.title?.trim();
        if (candidate && !isWeakStorefrontParsedTitle(candidate)) {
          result.title = candidate;
          applyArtistSongSplitsFromMarketingTitle(result);
        }
        if (og.cover && !result.cover) result.cover = og.cover;
      }

      const needsSpotifyTrackDeep =
        isSpotify &&
        !isRadio &&
        /\/track\//i.test(raw) &&
        (isWeakStorefrontParsedTitle(result.title) ||
          !result.artist?.trim() ||
          !result.song?.trim());

      if (needsSpotifyTrackDeep) {
        await enrichSpotifyTrackPageHtml(raw, result);
        applySpotifyDotTitlePattern(result);
        applyArtistSongSplitsFromMarketingTitle(result);
      }

      if (type === "youtube" && !result.cover) {
        result.cover = getYouTubeThumbnail(raw);
      }
      if (type === "youtube" && !result.title) {
        const vid = raw.match(/(?:v=|\/)([^&\s?/]+)/)?.[1];
        result.title = vid ? `YouTube ${vid}` : "YouTube video";
      }
      if (type === "soundcloud" && !result.title) result.title = "SoundCloud track";

      // Fetch view count and duration for YouTube URLs (via central resolver – cached, deduped)
      if (type === "youtube") {
        const meta = await resolveYouTubeMetadata(raw);
        if (meta) {
          result.viewCount = meta.viewCount;
          result.durationSeconds = meta.durationSeconds;
        }
      }
    }

    if (
      isRadio ||
      (type === "stream-url" && (!result.title?.trim() || isWeakStorefrontParsedTitle(result.title)))
    ) {
      let fetchUrl = raw;
      if (raw.match(/\.(m3u8?|pls|aac|mp3)(\?|$)/i)) {
        try {
          fetchUrl = new URL(raw).origin + "/";
        } catch {
          /* keep raw */
        }
      }
      try {
        const res = await fetch(fetchUrl, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; SyncBiz/1.0)" },
          signal: AbortSignal.timeout(8000),
        });
        if (res?.ok) {
          const ct = res.headers.get("content-type") || "";
          if (ct.includes("text/html")) {
            const html = await res.text();
            const guessed = parseOgTitle(html) ?? parseTitleTag(html);
            const g = guessed?.trim() ?? "";
            if (g && !isWeakStorefrontParsedTitle(g)) result.title = g;
            applyArtistSongSplitsFromMarketingTitle(result);
            const ogImage = parseOgImage(html);
            const favicon = parseFavicon(html, fetchUrl);
            result.cover = ogImage
              ? resolveUrl(ogImage, fetchUrl)
              : favicon ?? result.cover ?? null;
          }
        }
      } catch {
        /* fetch failed */
      }
      if (!result.title?.trim() && isRadio) result.title = extractDomain(raw) || "Radio Station";
      if (!result.cover && isRadio) result.cover = RADIO_DEFAULT_IMAGE;
    }

    /** Stage 6C: never propagate hostname placeholders for resolve-to-youtube intents */
    const resolveIntent = musicUrlIngest.intent === "resolve_to_youtube";
    if (!isRadio && resolveIntent && isWeakStorefrontParsedTitle(result.title)) {
      const ra = result.artist?.trim();
      const rs = result.song?.trim();
      if (
        ra &&
        rs &&
        !isWeakStorefrontParsedTitle(ra) &&
        !isWeakStorefrontParsedTitle(rs)
      ) {
        result.title = `${ra} - ${rs}`;
      } else {
        result.title = "";
        result.artist = undefined;
        result.song = undefined;
      }
    }

    if (!result.title?.trim() && (!resolveIntent || isRadio)) {
      result.title = extractDomain(raw) || "Untitled";
    }

    if (result.title?.trim() && result.genre === DEFAULT_GENRE && !isRadio) {
      result.genre = inferGenre(result.title);
    }

    return NextResponse.json({
      ...result,
      musicUrlIngest,
      ...parseUrlFoundationHints({
        rawUrl: raw,
        inferredType: result.type,
        isRadio,
        isShazam,
      }),
    });
  } catch (e) {
    console.warn("[parse-url]", e);
    return NextResponse.json(
      { error: "Failed to parse URL" },
      { status: 500 }
    );
  }
}
