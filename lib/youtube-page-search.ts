/**
 * Key-less YouTube search by reading YouTube's own results page (the page ships its data as `var ytInitialData = {…};` — we take the video entries out of it). Replaces the npm package
 * `youtube-search-without-api-key`, which npm REMOVED from its registry on 2026-10-29 (it made every Railway install fail, and removing it left the slow yt-dlp as the only key-less search —
 * the owner: "searching a song takes a year, no result"). Same idea and the same Googlebot user agent as that package; no dependency; one HTTP request (≈ a second) instead of spawning yt-dlp.
 * Pure parsing (`parseYouTubeResultsHtml`) is separate from the fetch so it can be tested without a network.
 */

const USER_AGENT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

export type PageSearchVideo = {
  videoId: string;
  title: string;
  url: string;
  cover: string;
  viewCount?: number;
  durationSeconds?: number;
};

/** "3:45" / "1:02:03" → seconds (undefined when it is not a clock, e.g. a live stream) */
export function parseClock(text: string | undefined | null): number | undefined {
  if (!text) return undefined;
  const parts = text.trim().split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d{1,2}$/.test(p))) return undefined;
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
}

type Json = unknown;

function collectVideoRenderers(node: Json, out: Record<string, unknown>[], depth = 0): void {
  if (depth > 40 || node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const x of node) collectVideoRenderers(x, out, depth + 1);
    return;
  }
  const obj = node as Record<string, unknown>;
  const vr = obj.videoRenderer;
  if (vr && typeof vr === "object") out.push(vr as Record<string, unknown>);
  for (const k of Object.keys(obj)) {
    if (k === "videoRenderer") continue;
    collectVideoRenderers(obj[k], out, depth + 1);
  }
}

const runsText = (t: unknown): string => {
  const o = t as { runs?: Array<{ text?: string }>; simpleText?: string } | undefined;
  if (typeof o?.simpleText === "string") return o.simpleText;
  return (o?.runs ?? []).map((r) => r.text ?? "").join("");
};

/** The video entries of a results page, in page order, without duplicates. Anything unexpected gives []. */
export function parseYouTubeResultsHtml(html: string, limit = 15): PageSearchVideo[] {
  let data: unknown;
  try {
    const raw = html.split("var ytInitialData = ")[1]?.split(";</script>")[0];
    if (!raw) return [];
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  const renderers: Record<string, unknown>[] = [];
  collectVideoRenderers(data, renderers);
  const seen = new Set<string>();
  const out: PageSearchVideo[] = [];
  for (const vr of renderers) {
    const videoId = typeof vr.videoId === "string" ? vr.videoId : "";
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId) || seen.has(videoId)) continue;
    const title = runsText(vr.title).replace(/\s+/g, " ").trim();
    if (!title) continue;
    seen.add(videoId);
    const thumbs = (vr.thumbnail as { thumbnails?: Array<{ url?: string }> } | undefined)?.thumbnails ?? [];
    const views = Number(runsText(vr.viewCountText).replace(/\D/g, "")) || undefined;
    out.push({
      videoId,
      title,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      cover: thumbs.length > 0 && thumbs[thumbs.length - 1]?.url ? String(thumbs[thumbs.length - 1].url) : `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      viewCount: views,
      durationSeconds: parseClock(runsText(vr.lengthText)),
    });
    if (out.length >= limit) break;
  }
  return out;
}

type PageTry = { videos: PageSearchVideo[]; why: string };

/** One request to YouTube's results page, never throws. The whole exchange — headers AND body — is raced against the timeout, so a hung connection cannot hold the search. */
async function tryOnce(q: string, limit: number, timeoutMs: number): Promise<PageTry> {
  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ html: null; why: string }>((resolve) => {
    timer = setTimeout(() => {
      ctl.abort();
      resolve({ html: null, why: "timeout" });
    }, timeoutMs);
  });
  const run = (async (): Promise<{ html: string | null; why: string }> => {
    const res = await fetch(`https://www.youtube.com/results?q=${encodeURIComponent(q)}&hl=en`, { headers: { "user-agent": USER_AGENT, "accept-language": "en" }, signal: ctl.signal, cache: "no-store" });
    if (!res.ok) return { html: null, why: `http ${res.status}` };
    return { html: await res.text(), why: "page" };
  })().catch((e: unknown) => ({ html: null, why: `error ${e instanceof Error ? e.message : String(e)}` }));
  try {
    const got = await Promise.race([run, timeout]);
    if (!got.html) return { videos: [], why: got.why };
    const videos = parseYouTubeResultsHtml(got.html, limit);
    return { videos, why: videos.length > 0 ? "ok" : `no results in the page (${got.html.length} bytes${got.html.includes("var ytInitialData = ") ? "" : ", no data block — a consent / block page?"})` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The key-less search: one try, and ONE more after a moment when the page came back without results (YouTube sometimes answers a quick repeat with a thin page — seen right after another request). Never throws.
 * Read-only diagnostic: when both tries are empty the reason is logged once ("[youtube-page-search]") so the cause of a missing result is visible in the server log.
 */
export async function searchYouTubeByPage(query: string, limit = 15, timeoutMs = 5000): Promise<PageSearchVideo[]> {
  const q = query.trim();
  if (!q) return [];
  const first = await tryOnce(q, limit, timeoutMs);
  if (first.videos.length > 0 || first.why === "timeout") {
    if (first.videos.length === 0) console.warn("[youtube-page-search] no results:", first.why);
    return first.videos;
  }
  await new Promise((r) => setTimeout(r, 350));
  const second = await tryOnce(q, limit, timeoutMs);
  if (second.videos.length === 0) console.warn("[youtube-page-search] no results:", first.why, "|", second.why);
  return second.videos;
}
