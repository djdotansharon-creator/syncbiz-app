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
