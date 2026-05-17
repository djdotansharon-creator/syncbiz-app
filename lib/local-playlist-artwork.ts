/**
 * Client-only helpers for disk-backed playlists (no server).
 * Placeholder + first-hit embedded cover from Electron IPC.
 */

export const EPHEMERAL_LOCAL_PLAYLIST_PREFIX = "ephemeral-local-folder:" as const;

/** Cap embedded-art IPC probes per heavy operation (folder drop + library fetch). */
export const MAX_EPHEMERAL_TRACK_COVERS_ON_DROP = 64;
export const MAX_SAVED_LOCAL_PLAYLIST_TRACK_COVERS = 120;

/** Distinct tile / deck art when no embedded image is found (SVG data URL). */
export const LOCAL_PLAYLIST_ARTWORK_PLACEHOLDER =
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320" role="img" aria-label="Local playlist">
<defs>
<linearGradient id="sblp" x1="0%" y1="0%" x2="100%" y2="100%">
<stop offset="0%" style="stop-color:#0f172a"/>
<stop offset="100%" style="stop-color:#115e59"/>
</linearGradient>
</defs>
<rect width="320" height="320" rx="28" fill="url(#sblp)"/>
<rect x="52" y="60" width="216" height="168" rx="16" fill="none" stroke="#2dd4bf" stroke-width="3" opacity="0.75"/>
<circle cx="134" cy="148" r="34" fill="#14b8a6" opacity="0.35"/>
<path d="M200 120v56l48-28z" fill="#5eead4" opacity="0.9"/>
<path d="M80 252h160" stroke="#64748b" stroke-width="2" stroke-linecap="round" opacity="0.9"/>
<text x="160" y="274" text-anchor="middle" fill="#94a3b8" font-family="system-ui,Segoe UI,sans-serif" font-size="20" font-weight="600">Local library</text>
</svg>`.replace(/\s+/g, " "),
  );

export async function pickFirstEmbeddedLocalCover(
  getCover: (absolutePath: string) => Promise<{ status?: string; dataUrl?: string | null }>,
  absolutePaths: string[],
  maxTry: number,
): Promise<string | null> {
  if (!absolutePaths.length) return null;
  const n = Math.min(maxTry, absolutePaths.length);
  for (let i = 0; i < n; i++) {
    const p = (absolutePaths[i] ?? "").trim();
    if (!p) continue;
    try {
      const cov = await getCover(p);
      if (cov && cov.status === "ok") {
        const u = `${cov.dataUrl ?? ""}`.trim();
        if (u) return u;
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

/** Parallel-shaped array: embedded cover per path, null when absent (cap limits IPC). */
export async function embedLocalTrackCoversUpToCap(
  getCover: (absolutePath: string) => Promise<{ status?: string; dataUrl?: string | null }>,
  absolutePaths: string[],
  cap: number,
): Promise<(string | null)[]> {
  const out: (string | null)[] = new Array(absolutePaths.length).fill(null);
  const n = Math.min(cap, absolutePaths.length);
  for (let i = 0; i < n; i++) {
    const p = (absolutePaths[i] ?? "").trim();
    if (!p) continue;
    try {
      const cov = await getCover(p);
      if (cov.status === "ok" && cov.dataUrl?.trim()) {
        out[i] = cov.dataUrl!.trim();
      }
    } catch {
      /* ignore */
    }
  }
  return out;
}
