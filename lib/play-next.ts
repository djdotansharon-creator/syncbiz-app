import type { SourceProviderType, UnifiedSource } from "@/lib/source-types";
import { titleFromLocalPath } from "@/lib/local-audio-path";

const LOG = "[SyncBiz:play-next]";

export const PLAY_NEXT_ID_PREFIX = "playnext-";

export function isPlayNextSourceId(id: string | undefined | null): boolean {
  return !!id && id.startsWith(PLAY_NEXT_ID_PREFIX);
}

function inferPlaybackTypeForUrl(url: string): SourceProviderType {
  const t = (url ?? "").trim();
  if (t.includes("youtube.com") || t.includes("youtu.be")) return "youtube";
  if (t.includes("soundcloud")) return "soundcloud";
  if (t.includes("spotify")) return "spotify";
  if (/\.(m3u8?|pls)(\?|$)/i.test(t)) return "winamp";
  if (t.startsWith("http://") || t.startsWith("https://")) return "stream-url";
  return "stream-url";
}

function guessTitleFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const segs = u.pathname.split("/").filter(Boolean);
    const last = segs[segs.length - 1] ?? u.hostname;
    const decoded = decodeURIComponent(last.replace(/\+/g, " ")).replace(/[?#].*$/, "");
    if (decoded && decoded.length > 0) return decoded.slice(0, 100);
    return u.hostname || "Web track";
  } catch {
    return "Web track";
  }
}

/** Ephemeral in-memory / playback-state only; never written to the library API. */
export function createPlayNextLocalSource(absolutePath: string): UnifiedSource {
  const id = `${PLAY_NEXT_ID_PREFIX}${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `t-${Date.now()}`}`;
  return {
    id,
    title: titleFromLocalPath(absolutePath),
    genre: "Mixed",
    cover: null,
    type: "local",
    url: absolutePath,
    origin: "source",
  };
}

/** Ephemeral http(s) item for Play Next — same in-memory contract as `createPlayNextLocalSource`. */
export function createPlayNextUrlSource(rawUrl: string): UnifiedSource {
  const url = rawUrl.trim();
  const type = inferPlaybackTypeForUrl(url);
  const id = `${PLAY_NEXT_ID_PREFIX}${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `t-${Date.now()}`}`;
  return {
    id,
    title: guessTitleFromUrl(url),
    genre: "Mixed",
    cover: null,
    type,
    url,
    origin: "source",
  };
}

export function playNextLog(event: string, data: Record<string, unknown>) {
  if (typeof console === "undefined" || !console.debug) return;
  try {
    console.debug(LOG, event, data);
  } catch {
    /* */
  }
}
