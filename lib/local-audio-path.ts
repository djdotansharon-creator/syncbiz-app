/**
 * Parse user-pasted "Add to library" input into an absolute local file path
 * (Windows + optional Unix-style). Used for desktop MPV / local file playback;
 * the browser cannot read arbitrary disk paths for security, but paths may
 * still be stored and sent to the branch desktop player.
 */

const AUDIO_LIKE =
  /\.(mp3|m4a|aac|flac|wav|ogg|opus|wma|aifc?|m3u8?|pls)(\?.*)?$/i;

/**
 * In the web browser we cannot list directory contents. If a path is clearly
 * a folder (trailing separator, or last segment has no audio-like extension), block
 * single-file add so we do not persist a non-file as `url` (Desktop scans folders).
 */
export function isLocalPathLikelyFolderInWebBrowser(absolutePath: string): boolean {
  const s = (absolutePath ?? "").trim();
  if (!s) return true;
  if (/[/\\]\s*$/.test(s)) return true;
  const trimmed = s.replace(/[/\\]+\s*$/g, "");
  const last = trimmed.split(/[/\\]/).pop() ?? "";
  if (!last) return true;
  return !AUDIO_LIKE.test(last);
}

/**
 * Remove outer quote pairs (ASCII + "smart" quotes from Windows / Word) and bidi marks.
 * "Copy as path" often wraps with straight `"`, but some locales paste "..." (U+201C/U+201D).
 */
function stripOuterWrapping(s: string): string {
  let t = s.replace(/^\uFEFF/, "").replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]+/g, "").trim();
  const pairs: Array<[string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ["\u201C", "\u201D"],
    ["\u201E", "\u201C"],
    ["\u201E", "\u201D"],
    ["\u00AB", "\u00BB"],
  ];
  for (let n = 0; n < 4; n++) {
    const before = t;
    for (const [a, b] of pairs) {
      if (t.length >= a.length + b.length && t.startsWith(a) && t.endsWith(b)) {
        t = t.slice(a.length, t.length - b.length).trim();
        break;
      }
    }
    if (t === before) break;
  }
  // Stray one-sided quotes from partial paste (Windows path cannot contain " in a segment)
  const o = new Set(['"', "'", "\u201C", "\u201D", "\u201E"]);
  while (t.length > 0 && o.has(t[0]!)) t = t.slice(1).trim();
  while (t.length > 0 && o.has(t[t.length - 1]!)) t = t.slice(0, -1).trim();
  return t;
}

/** Strip "Copy as path" quotes and normalize slashes on Windows. */
export function normalizeLocalFilePathInput(raw: string): string | null {
  const s0 = stripOuterWrapping((raw ?? "").trim());
  if (!s0) return null;
  const s = s0;

  if (s.toLowerCase().startsWith("file:")) {
    try {
      const u = new URL(s);
      const dec = decPath(u.pathname);
      if (/^\/[a-zA-Z]:\//i.test(dec)) {
        return dec.slice(1).replace(/\//g, "\\");
      }
      if (u.hostname && /^[a-zA-Z]$/.test(u.hostname) && u.hostname.length === 1) {
        return `${u.hostname}:${u.pathname.replace(/^\//, "")}`.replace(/\//g, "\\");
      }
      if (dec.length > 0) {
        if (dec.startsWith("/") && !dec.startsWith("//")) {
          return dec;
        }
        if (dec.startsWith("\\\\")) {
          return dec;
        }
      }
    } catch {
      return null;
    }
  }

  if (/^[a-zA-Z]:[\\/]/.test(s)) {
    return s.replace(/\//g, "\\");
  }
  if (s.startsWith("\\\\") && s.length > 2) {
    return s;
  }
  if (s.startsWith("/") && s.length > 1 && !s.startsWith("//")) {
    return s;
  }
  return null;
}

function decPath(p: string): string {
  try {
    return decodeURIComponent(p);
  } catch {
    return p;
  }
}

export function titleFromLocalPath(absolutePath: string): string {
  const t = absolutePath.replace(/[\\/]+$/g, "");
  const base = t.split(/[/\\]/).pop() ?? t;
  return base.replace(/\.[^.]+$/, "") || base || "Local";
}

/**
 * Heuristic: this string is more likely a filesystem path than a host-less URL.
 */
export function couldBeLocalFilePathString(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  if (t.length > 1 && t.startsWith("/") && !t.startsWith("//")) return true;
  if (/^\\\\[^\\]/.test(t)) return true;
  if (AUDIO_LIKE.test(t) && /[A-Za-z]:[\\/]/.test(t)) return true;
  if (AUDIO_LIKE.test(t) && t.startsWith("\\\\")) return true;
  if (/[A-Za-z]:[\\/]/.test(t) && t.length > 3) return true;
  if (t.toLowerCase().startsWith("file:")) return true;
  return false;
}

/**
 * Absolute path for a file/folder from Desktop drag–drop.
 * Modern Electron deprecates `File.path`; use preload `webUtils.getPathForFile` when present.
 */
export function getNativePathForDroppedFile(f: File | null | undefined): string | undefined {
  if (!f) return undefined;
  const legacy = (f as File & { path?: string }).path;
  if (typeof legacy === "string" && legacy.trim()) return legacy.trim();
  if (typeof window === "undefined") return undefined;
  const g = (window as Window & { syncbizDesktop?: { getPathForFile?: (file: File) => string } })
    .syncbizDesktop?.getPathForFile;
  if (typeof g === "function") {
    try {
      const p = g(f);
      if (typeof p === "string" && p.trim()) return p.trim();
    } catch {
      /* invalid file for getPathForFile */
    }
  }
  return undefined;
}

/** Native paths from Electron `DataTransfer`, deduped (case-insensitive on Windows). */
export function collectElectronFilePathsFromDataTransfer(dataTransfer: DataTransfer): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string | undefined) => {
    if (typeof raw !== "string") return;
    const t = raw.trim();
    if (!t) return;
    const k = t.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(t);
  };
  for (let i = 0; i < dataTransfer.files.length; i++) {
    add(getNativePathForDroppedFile(dataTransfer.files[i]!));
  }
  for (let i = 0; i < dataTransfer.items.length; i++) {
    const it = dataTransfer.items[i];
    if (it.kind !== "file") continue;
    add(getNativePathForDroppedFile(it.getAsFile()));
  }
  // Many hosts still expose only `file:///...` in `text/uri-list` while `File.path` and
  // getPathForFile are empty — resolve via normalizeLocalFilePathInput.
  const uriList = dataTransfer.getData("text/uri-list");
  if (uriList) {
    for (const line of uriList.split(/\r?\n/)) {
      const L = line.trim();
      if (!L || L.startsWith("#")) continue;
      const first = (L.split(/\s+/)[0] ?? L).trim();
      if (!first.toLowerCase().startsWith("file:")) continue;
      const p = normalizeLocalFilePathInput(first);
      if (p) add(p);
    }
  }
  return out;
}

/**
 * Windows Explorer can expand a dragged folder into many file paths. Their longest
 * common directory is the folder to scan. Falls back to the first path if unsafe (e.g. only `C:\` in common).
 * Desktop + scanLocalAudioFolder only — web uses the first path.
 */
export function resolveDesktopFolderDropPath(filePaths: string[]): string {
  if (filePaths.length === 0) return "";
  if (filePaths.length === 1) return filePaths[0]!.trim();
  const norm = filePaths.map((p) => p.replace(/\//g, "\\").trim());
  let prefix = norm[0]!;
  for (let i = 1; i < norm.length; i++) {
    const q = norm[i]!;
    let n = 0;
    const L = Math.min(prefix.length, q.length);
    while (n < L && prefix[n]!.toLowerCase() === q[n]!.toLowerCase()) n++;
    prefix = prefix.slice(0, n);
  }
  let dir: string;
  if (prefix.endsWith("\\") || prefix.endsWith("/")) {
    dir = prefix.replace(/[\\/]+$/, "");
  } else {
    const j = prefix.lastIndexOf("\\");
    if (j <= 0) {
      return norm[0]!.trim();
    }
    dir = prefix.slice(0, j);
  }
  if (!dir) return norm[0]!.trim();
  if (/^[A-Za-z]:$/.test(dir)) {
    return norm[0]!.trim();
  }
  return dir;
}
