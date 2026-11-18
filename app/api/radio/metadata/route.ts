/**
 * Fetch metadata from a radio stream URL (og:title, og:image, etc.).
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";
import { resolveRemoteMediaTarget } from "@/lib/remote-media-url-policy";
import { safeFetch } from "@/lib/ssrf-safe-fetch";

const DEFAULT_GENRE = "Radio";
const DEFAULT_IMAGE = "/radio-default.svg";

function isValidUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  try {
    // F1: require an authenticated session (the only caller is the signed-in Add-Radio form).
    const user = await getCurrentUserFromCookies();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { url } = (await req.json()) as { url?: string };
    const raw = typeof url === "string" ? url.trim() : "";
    // F1: reject invalid / non-public (internal / loopback / credentialed / non-http) targets before fetching.
    if (!raw || !isValidUrl(raw) || resolveRemoteMediaTarget(raw) === null) {
      return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
    }

    // F1: SSRF-safe fetch — validates the RESOLVED IP at connection time (DNS rebinding) and re-validates every
    // redirect hop, while preserving Host/SNI for public HTTPS. A blocked target throws → benign fallback below.
    const res = await safeFetch(raw, { timeoutMs: 8000 }).catch(() => null);

    if (!res?.ok) {
      return NextResponse.json({
        title: extractTitleFromUrl(raw),
        image: null,
        genre: DEFAULT_GENRE,
      });
    }

    const html = res.body;
    const title = parseOgTitle(html) ?? parseTitleTag(html) ?? extractTitleFromUrl(raw);
    const image = parseOgImage(html) ?? parseFavicon(html, raw) ?? null;

    return NextResponse.json({
      title: title || "Unknown Station",
      image: image ? resolveUrl(image, raw) : null,
      genre: DEFAULT_GENRE,
    });
  } catch (e) {
    console.warn("[radio/metadata]", e);
    return NextResponse.json({
      title: "Unknown Station",
      image: null,
      genre: DEFAULT_GENRE,
    });
  }
}

function parseOgTitle(html: string): string | null {
  const m = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
  return m ? decodeHtml(m[1]) : null;
}

function parseOgImage(html: string): string | null {
  const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  return m ? decodeHtml(m[1]) : null;
}

function parseTitleTag(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? decodeHtml(m[1].trim()) : null;
}

function parseFavicon(html: string, baseUrl: string): string | null {
  const m = html.match(/<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']+)["']/i)
    ?? html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["'](?:shortcut )?icon["']/i);
  return m ? resolveUrl(decodeHtml(m[1]), baseUrl) : null;
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

function extractTitleFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    return host.split(".").slice(0, -1).join(".") || host;
  } catch {
    return "Unknown Station";
  }
}
