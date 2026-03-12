/**
 * Unified URL parser: extracts title, cover, genre, type from any URL.
 * Image priority: thumbnail > og:image > favicon > default
 * Title: media title > og:title > page title > domain
 */

import { NextRequest, NextResponse } from "next/server";
import { inferPlaylistType, getYouTubeThumbnail, getYouTubeVideoId, isShazamUrl, extractShazamSongFromPath } from "@/lib/playlist-utils";
import { inferGenre } from "@/lib/infer-genre";
import { resolveYouTubeMetadata } from "@/lib/youtube-metadata-resolver";

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

    const result: {
      title: string;
      cover: string | null;
      genre: string;
      type: string;
      isRadio: boolean;
      viewCount?: number;
      durationSeconds?: number;
      artist?: string;
      song?: string;
    } = {
      title: "",
      cover: null,
      genre: isRadio ? LIVE_RADIO_GENRE : DEFAULT_GENRE,
      type: isShazam ? "shazam" : type,
      isRadio,
    };

    if (isShazam) {
      const songFromPath = extractShazamSongFromPath(raw);
      result.title = songFromPath || "Shazam track";
      try {
        const res = await fetch(raw, {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" },
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok) {
          const html = await res.text();
          const ogTitle = parseOgTitle(html);
          const ogImage = parseOgImage(html);
          if (ogTitle) {
            result.title = ogTitle;
            const dash = ogTitle.indexOf(" - ");
            if (dash > 0) {
              result.artist = ogTitle.slice(0, dash).trim();
              result.song = ogTitle.slice(dash + 3).trim();
            }
          }
          if (ogImage) result.cover = resolveUrl(ogImage, raw);
        }
      } catch {
        /* Shazam may block fetch; use path-extracted song */
      }
      if (!result.song && songFromPath) result.song = songFromPath;
    } else if (type === "youtube" || type === "soundcloud" || type === "spotify") {
      try {
        const res = await fetch(
          `https://noembed.com/embed?url=${encodeURIComponent(raw)}`,
          { signal: AbortSignal.timeout(8000) }
        );
        if (res.ok) {
          const data = (await res.json()) as { title?: string; thumbnail_url?: string };
          if (data.title) result.title = data.title;
          if (data.thumbnail_url) result.cover = data.thumbnail_url;
        }
      } catch {
        /* noembed failed */
      }
      if (type === "youtube" && !result.cover) {
        result.cover = getYouTubeThumbnail(raw);
      }
      if (type === "youtube" && !result.title) {
        const vid = raw.match(/(?:v=|\/)([^&\s?/]+)/)?.[1];
        result.title = vid ? `YouTube ${vid}` : "YouTube video";
      }
      if (type === "soundcloud" && !result.title) result.title = "SoundCloud track";
      if (type === "spotify" && !result.title) result.title = "Spotify";

      // Fetch view count and duration for YouTube URLs (via central resolver – cached, deduped)
      if (type === "youtube") {
        const meta = await resolveYouTubeMetadata(raw);
        if (meta) {
          result.viewCount = meta.viewCount;
          result.durationSeconds = meta.durationSeconds;
        }
      }
    }

    if (isRadio || (type === "stream-url" && !result.title)) {
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
            result.title =
              parseOgTitle(html) ?? parseTitleTag(html) ?? extractDomain(raw);
            const ogImage = parseOgImage(html);
            const favicon = parseFavicon(html, fetchUrl);
            result.cover = ogImage
              ? resolveUrl(ogImage, fetchUrl)
              : favicon ?? null;
          }
        }
      } catch {
        /* fetch failed */
      }
      if (!result.title) result.title = extractDomain(raw) || "Radio Station";
      if (!result.cover && isRadio) result.cover = RADIO_DEFAULT_IMAGE;
    }

    if (!result.title) {
      result.title = extractDomain(raw) || "Untitled";
    }

    if (result.title && result.genre === DEFAULT_GENRE && !isRadio) {
      result.genre = inferGenre(result.title);
    }

    return NextResponse.json(result);
  } catch (e) {
    console.warn("[parse-url]", e);
    return NextResponse.json(
      { error: "Failed to parse URL" },
      { status: 500 }
    );
  }
}
