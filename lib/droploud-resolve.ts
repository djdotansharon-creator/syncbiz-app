/**
 * Droploud resolver — SERVER-SIDE ONLY (called from `/api/playlists` POST and `/api/sources/parse-url`).
 * Resolves a pasted Droploud URL ONCE, at save time, into a target that plays through an EXISTING engine path.
 * Never runs in the playback hot path; never converts to YouTube. Pure parsing/policy lives in `lib/droploud.ts`.
 *
 * Network safety (SSRF): only fixed Droploud hosts are fetched, redirects are never followed off those hosts,
 * every request has a timeout, HTML is size-capped, and direct audio must answer with an audio content type.
 */
import {
  DROPLOUD_AUDIO_HOSTS,
  DROPLOUD_PAGE_HOSTS,
  classifyDroploudUrl,
  droploudDisplayTitle,
  extractDroploudTrack,
  orderDroploudCandidates,
} from "./droploud";

export type DroploudResolution =
  | { kind: "soundcloud"; playUrl: string; title?: string; cover?: string }
  | { kind: "direct_audio"; playUrl: string; fullTrack: boolean; title?: string; cover?: string }
  | { kind: "unsupported"; reason: string };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type DroploudResolveDeps = {
  fetchImpl?: FetchLike;
  /** Disable the in-memory cache (tests). */
  noCache?: boolean;
  timeoutMs?: number;
};

const PAGE_TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 3 * 1024 * 1024;
const MAX_REDIRECTS = 2;
const UA = "Mozilla/5.0 (compatible; VONO/1.0; +https://vono.app)";
const AUDIO_EXT_RE = /\.(mp3|wav|m4a|aac|ogg|oga|opus|flac)(\?|$)/i;

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 200;
const cache = new Map<string, { at: number; value: DroploudResolution }>();

function cacheGet(key: string): DroploudResolution | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function cachePut(key: string, value: DroploudResolution): void {
  if (value.kind === "unsupported") return; // never cache a failure (it may be transient)
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), value });
}

function allowedHost(url: string, hosts: readonly string[]): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && hosts.includes(u.hostname.toLowerCase()) && !u.username && !u.password;
  } catch {
    return false;
  }
}

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(id);
  }
}

/** GET a page on an allowed host, following redirects ONLY within `hosts`. Returns null on any failure. */
async function fetchAllowed(
  url: string,
  hosts: readonly string[],
  init: RequestInit,
  fetchImpl: FetchLike,
  timeoutMs: number,
): Promise<Response | null> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!allowedHost(current, hosts)) return null;
    const res = await withTimeout(timeoutMs, (signal) =>
      fetchImpl(current, { ...init, redirect: "manual", signal }),
    ).catch(() => null);
    if (!res) return null;
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return null;
      try {
        current = new URL(loc, current).href;
      } catch {
        return null;
      }
      continue;
    }
    return res;
  }
  return null;
}

async function fetchDroploudHtml(pageUrl: string, fetchImpl: FetchLike, timeoutMs: number): Promise<string | null> {
  const res = await fetchAllowed(
    pageUrl,
    DROPLOUD_PAGE_HOSTS,
    { method: "GET", headers: { "user-agent": UA, accept: "text/html" } },
    fetchImpl,
    timeoutMs,
  );
  if (!res || !res.ok) return null;
  const ct = (res.headers.get("content-type") ?? "").toLowerCase();
  if (!ct.includes("text/html")) return null;
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > MAX_HTML_BYTES) return null;
  const html = await res.text().catch(() => null);
  if (html == null || html.length > MAX_HTML_BYTES) return null;
  return html;
}

/** A Droploud audio file must really serve audio (HEAD, falling back to a 1-byte ranged GET). */
async function isPlayableDroploudAudio(fileUrl: string, fetchImpl: FetchLike, timeoutMs: number): Promise<boolean> {
  const hosts = [...DROPLOUD_AUDIO_HOSTS, ...DROPLOUD_PAGE_HOSTS];
  const judge = (res: Response | null): boolean | null => {
    if (!res) return null;
    if (!res.ok && res.status !== 206) return res.status === 405 || res.status === 501 ? null : false;
    const ct = (res.headers.get("content-type") ?? "").toLowerCase();
    if (ct.startsWith("audio/")) return true;
    if (ct.includes("octet-stream") && AUDIO_EXT_RE.test(new URL(fileUrl).pathname)) return true;
    return false;
  };
  const head = judge(
    await fetchAllowed(fileUrl, hosts, { method: "HEAD", headers: { "user-agent": UA } }, fetchImpl, timeoutMs),
  );
  if (head !== null) return head;
  const ranged = await fetchAllowed(
    fileUrl,
    hosts,
    { method: "GET", headers: { "user-agent": UA, range: "bytes=0-0" } },
    fetchImpl,
    timeoutMs,
  );
  try {
    await ranged?.body?.cancel();
  } catch {
    /* ignore */
  }
  return judge(ranged) === true;
}

const NO_AUDIO = "This Droploud link has no playable audio.";

/** Resolve a Droploud URL to a playable target. Callers check `isDroploudUrl()` first. */
export async function resolveDroploudUrl(raw: string, deps: DroploudResolveDeps = {}): Promise<DroploudResolution> {
  const fetchImpl: FetchLike = deps.fetchImpl ?? ((input, init) => fetch(input, init));
  const timeoutMs = deps.timeoutMs ?? PAGE_TIMEOUT_MS;
  const kind = classifyDroploudUrl(raw);
  if (!kind) return { kind: "unsupported", reason: "Not a Droploud link." };
  if (kind.kind === "other_page") {
    return { kind: "unsupported", reason: `${NO_AUDIO} Supported: Droploud track pages and Droploud audio files.` };
  }

  const cacheKey = kind.kind === "track_page" ? kind.pageUrl : kind.fileUrl;
  if (!deps.noCache) {
    const hit = cacheGet(cacheKey);
    if (hit) return hit;
  }

  let result: DroploudResolution;
  if (kind.kind === "audio_file") {
    result = (await isPlayableDroploudAudio(kind.fileUrl, fetchImpl, timeoutMs))
      ? { kind: "direct_audio", playUrl: kind.fileUrl, fullTrack: true }
      : { kind: "unsupported", reason: `${NO_AUDIO} The file is not an audio file.` };
  } else {
    const html = await fetchDroploudHtml(kind.pageUrl, fetchImpl, timeoutMs);
    const info = html ? extractDroploudTrack(html, kind.trackId) : null;
    if (!html) {
      result = { kind: "unsupported", reason: "Could not read this Droploud page. Please try again." };
    } else if (!info) {
      result = { kind: "unsupported", reason: `${NO_AUDIO} The track was not found on the page.` };
    } else {
      const title = droploudDisplayTitle(info);
      const cover = info.cover;
      // Try candidates in policy order; a direct file that does not serve audio is skipped, not fatal.
      result = { kind: "unsupported", reason: NO_AUDIO };
      for (const c of orderDroploudCandidates(info.candidates)) {
        if (c.kind === "soundcloud") {
          result = { kind: "soundcloud", playUrl: c.url, title, cover };
          break;
        }
        if (await isPlayableDroploudAudio(c.url, fetchImpl, timeoutMs)) {
          result = { kind: "direct_audio", playUrl: c.url, fullTrack: c.fullTrack, title, cover };
          break;
        }
      }
    }
  }

  if (!deps.noCache) cachePut(cacheKey, result);
  return result;
}
