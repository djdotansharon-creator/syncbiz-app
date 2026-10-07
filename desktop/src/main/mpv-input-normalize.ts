/**
 * Turn user-entered targets into strings MPV `loadfile` can load (URLs + local files).
 * Does not decide *what* to play — only normalizes. PlaybackProvider / WS routing stay authoritative upstream.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const LOG = "[SyncBiz:desktop-mpv:normalize]";

export function normalizeMpvLoadTarget(raw: string): { target: string; kind: "url" | "file" } {
  const s = raw.trim();
  if (!s) {
    return { target: s, kind: "url" };
  }
  const low = s.toLowerCase();
  if (low.startsWith("http://") || low.startsWith("https://") || low.startsWith("ytdl://")) {
    return { target: s, kind: "url" };
  }
  if (low.startsWith("file://")) {
    return { target: s, kind: "file" };
  }

  const looksWinAbs = /^[a-zA-Z]:[\\/]/.test(s);
  const looksUnc = s.startsWith("\\\\");
  const maybePath = looksWinAbs || looksUnc || (!s.includes("://") && s.length > 0);

  if (maybePath) {
    const abs = path.isAbsolute(s) ? path.normalize(s) : path.resolve(s);
    if (existsSync(abs)) {
      const href = pathToFileURL(abs).href;
      console.log(LOG, "local file →", kindLabel(href), "→", redactPath(href));
      return { target: href, kind: "file" };
    }
    if (looksWinAbs || looksUnc) {
      const fwd = s.replace(/\\/g, "/");
      console.log(LOG, "path not found on disk; passing normalized slashes to MPV:", redactPath(fwd));
      return { target: fwd, kind: "file" };
    }
  }

  return { target: s, kind: "url" };
}

function kindLabel(t: string): string {
  return t.startsWith("file:") ? "file URI" : "url";
}

function redactPath(p: string): string {
  if (p.length <= 100) return p;
  return `${p.slice(0, 40)}…${p.slice(-35)}`;
}

// ── P0 (2026-10-07) — source-aware crossfade standby load windows (PURE) ─────────────────────────────────────
/** LOCAL file: loads instantly; real local failures surface via decode-fail sooner. */
export const STANDBY_LOAD_TIMEOUT_LOCAL_MS = 12_000;
/** Plain http(s) stream URL (direct media / radio): no resolver step. */
export const STANDBY_LOAD_TIMEOUT_STREAM_MS = 30_000;
/** Sources MPV resolves through yt-dlp (ytdl_hook). Lenovo runtime evidence (2026-10-07): legitimate YouTube
 *  resolves took 61–69 s under realistic load, so 30 s (and 60 s) aborted valid loads. Bounded, NOT a generic
 *  URL increase — applies ONLY to yt-dlp-resolved sources. */
export const STANDBY_LOAD_TIMEOUT_YTDLP_MS = 90_000;

/** Hosts whose page URLs MPV can only play by resolving them through yt-dlp. */
const YTDLP_HOSTS = ["youtube.com", "youtu.be", "music.youtube.com", "youtube-nocookie.com", "soundcloud.com", "on.soundcloud.com"];

/** True when MPV must resolve this target through yt-dlp (ytdl:// or a YouTube / SoundCloud page URL). */
export function isYtDlpResolvedUrl(raw: string): boolean {
  const s = (raw ?? "").trim();
  if (/^ytdl:\/\//i.test(s)) return true;
  if (!/^https?:\/\//i.test(s)) return false;
  let host: string;
  try {
    host = new URL(s).hostname.toLowerCase();
  } catch {
    return false;
  }
  host = host.replace(/^(www|m)\./, "");
  return YTDLP_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

/** True for a network target (http/https/ytdl) — anything else is a LOCAL file. Same rule as standbyLoadTimeoutMs. */
export function isStreamLoadTarget(raw: string): boolean {
  const low = (raw ?? "").trim().toLowerCase();
  return low.startsWith("http://") || low.startsWith("https://") || low.startsWith("ytdl://");
}

/** Standby (crossfade incoming) load window for a target: LOCAL 12 s · plain stream 30 s · yt-dlp source 90 s. */
export function standbyLoadTimeoutMs(raw: string): number {
  const s = (raw ?? "").trim();
  const low = s.toLowerCase();
  const isUrl = low.startsWith("http://") || low.startsWith("https://") || low.startsWith("ytdl://");
  if (!isUrl) return STANDBY_LOAD_TIMEOUT_LOCAL_MS;
  return isYtDlpResolvedUrl(s) ? STANDBY_LOAD_TIMEOUT_YTDLP_MS : STANDBY_LOAD_TIMEOUT_STREAM_MS;
}
