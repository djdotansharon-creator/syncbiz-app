import type { SourceProviderType, UnifiedSource } from "@/lib/source-types";
import { titleFromLocalPath } from "@/lib/local-audio-path";
import { getYouTubeThumbnail } from "@/lib/playlist-utils";

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

/**
 * YouTube watch/share/shorts URLs all expose the video ID via `?v=` param or path segment.
 * Naive `pathname.split("/").pop()` returns "watch" for `/watch?v=ID` — useless as a title.
 * Try the structured forms first, then fall back to the last decoded path segment.
 */
function guessTitleFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host.includes("youtube.com") || host.includes("youtu.be")) {
      const v = u.searchParams.get("v");
      if (v) return `YouTube · ${v}`;
      const segs = u.pathname.split("/").filter(Boolean);
      const tail = segs[segs.length - 1];
      if (tail && tail !== "watch") return `YouTube · ${tail}`;
      if (host.includes("youtu.be") && segs[0]) return `YouTube · ${segs[0]}`;
      return "YouTube video";
    }
    const segs = u.pathname.split("/").filter(Boolean);
    const last = segs[segs.length - 1] ?? u.hostname;
    const decoded = decodeURIComponent(last.replace(/\+/g, " ")).replace(/[?#].*$/, "");
    if (decoded && decoded.length > 0) return decoded.slice(0, 100);
    return u.hostname || "Web track";
  } catch {
    return "Web track";
  }
}

/** New ephemeral id that round-trips through `isPlayNextSourceId`. */
function newPlayNextId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `${PLAY_NEXT_ID_PREFIX}${crypto.randomUUID()}`;
  }
  return `${PLAY_NEXT_ID_PREFIX}t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Ephemeral in-memory / playback-state only; never written to the library API. */
export function createPlayNextLocalSource(absolutePath: string): UnifiedSource {
  return {
    id: newPlayNextId(),
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
  // YouTube thumbnails are deterministic from the video id, so we can populate the cover
  // synchronously without waiting for the async parse-url enrichment. Keeps the Play Next
  // pad and player UI from looking blank during the brief metadata fetch.
  const cover = type === "youtube" ? getYouTubeThumbnail(url) : null;
  return {
    id: newPlayNextId(),
    title: guessTitleFromUrl(url),
    genre: "Mixed",
    cover,
    type,
    url,
    origin: "source",
  };
}

/**
 * Convert a library `UnifiedSource` into an ephemeral Play Next clone. Preserves title, cover,
 * type and url so the player UI shows the original metadata (cover art, real title, etc.) —
 * crucial for YouTube tiles where the URL alone is just `…/watch?v=ID`. The id is re-stamped
 * with the `playnext-` prefix so `isPlayNextSourceId` and the next() session-restore logic
 * still recognise it as a temporary item; `origin` is forced to `source` so the panel does not
 * treat it as a saved playlist.
 *
 * Returns null if there's nothing playable (no url, or url isn't an audio file / playable URL).
 */
export function createPlayNextFromUnifiedSource(source: UnifiedSource): UnifiedSource | null {
  const url = (source.url ?? "").trim();
  if (!url) return null;
  return {
    id: newPlayNextId(),
    title: source.title?.trim() || guessTitleFromUrl(url),
    genre: source.genre || "Mixed",
    cover: source.cover ?? null,
    type: source.type ?? inferPlaybackTypeForUrl(url),
    url,
    origin: "source",
    viewCount: source.viewCount,
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
