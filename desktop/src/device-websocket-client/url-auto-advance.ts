/**
 * P0 Gate 2c (owner-approved 2026-10-08) — MAIN owns the AUTOMATIC progression of the URL session it plays (PURE).
 *
 * Owner requirement: no silence between URL tracks. The NEXT item is prepared on the standby deck ~60 s before the
 * current one ends (paused + silent → resolved and buffered), then crossfaded in at the mix point (the user's mix
 * length, default 9 s). Manual intents (select / NEXT / PREV / jump) still arrive as PLAY_SOURCE from controllers;
 * MAIN rebuilds its session from every URL PLAY_SOURCE. LOCAL sessions are never handled here (no URLs on MAIN).
 * Only remote URLs live here — never a local filesystem path (CLAUDE.md §12).
 */

/** Prepare the next item this many seconds before the current one ends. */
export const PREPARE_LEAD_SEC = 60;
/** Consecutive automatic failures before MAIN stops skipping (the current audible track is never touched). */
export const MAX_AUTO_FAILURES = 3;

export type RepeatMode = "playlist" | "track" | "off";

export type UrlSessionItem = { id: string; title: string; cover: string | null; url: string; durationSeconds?: number };

export type UrlSession = {
  items: UrlSessionItem[];
  index: number;
  /** Parent playlist shell id when the session source is a playlist leaf (`<shell>:track:rN`); null otherwise. */
  shell: string | null;
  /** The leaf / source id MAIN published for `index`. */
  sourceId: string;
  origin?: "playlist" | "radio" | "source";
  sourceType?: string;
  sessionTitle: string | null;
  sessionPlaylistId: string | null;
  /** The MAIN attempt currently playing `index` (0 = unknown). */
  attemptId: number;
};

const LEAF = ":track:";

function isLocalOnly(u: string): boolean {
  return u.startsWith("local://") || /^[a-zA-Z]:[\\/]/.test(u) || u.startsWith("\\\\") || u.startsWith("file:");
}

/** Build the URL session from a PLAY_SOURCE payload (null = not a URL session MAIN can advance). */
export function buildUrlSession(payload: unknown): UrlSession | null {
  const p = payload as {
    source?: { id?: unknown; title?: unknown; cover?: unknown; type?: unknown; origin?: unknown; url?: unknown; playlistId?: unknown;
      sessionTracks?: Array<{ id?: unknown; title?: unknown; cover?: unknown; url?: unknown; durationSeconds?: unknown }> };
    trackIndex?: unknown;
  } | null | undefined;
  const src = p?.source;
  if (!src || typeof src.id !== "string" || !src.id.trim()) return null;
  const topUrl = typeof src.url === "string" ? src.url.trim() : "";
  if (!topUrl || src.type === "local" || isLocalOnly(topUrl)) return null;
  const tracks = Array.isArray(src.sessionTracks) ? src.sessionTracks : [];
  // a leaf (`<shell>:track:rN`) or a playlist SHELL carrying its tracks (e.g. a phone "play all") — both advance
  // through the playlist; a plain single source is a one-item session.
  const shell = src.id.includes(LEAF) ? src.id.slice(0, src.id.indexOf(LEAF)) : tracks.length > 0 ? src.id : null;
  const items: UrlSessionItem[] = tracks.length > 0 && shell
    ? tracks.filter((t) => t && typeof t.id === "string").map((t) => {
        const u = typeof t.url === "string" ? t.url.trim() : "";
        return {
          id: String(t.id),
          title: typeof t.title === "string" ? t.title : "",
          cover: typeof t.cover === "string" ? t.cover : null,
          url: u && !isLocalOnly(u) ? u : "",
          ...(typeof t.durationSeconds === "number" ? { durationSeconds: t.durationSeconds } : {}),
        };
      })
    : [{ id: src.id, title: typeof src.title === "string" ? src.title : "", cover: typeof src.cover === "string" ? src.cover : null, url: topUrl }];
  if (items.length === 0) return null;
  const ti = typeof p?.trackIndex === "number" && Number.isInteger(p.trackIndex) ? p.trackIndex : 0;
  const index = Math.max(0, Math.min(ti, items.length - 1));
  return {
    items, index, shell, sourceId: src.id,
    origin: src.origin === "playlist" || src.origin === "radio" || src.origin === "source" ? src.origin : undefined,
    sourceType: typeof src.type === "string" ? src.type : undefined,
    sessionTitle: typeof src.title === "string" ? src.title : null,
    sessionPlaylistId: typeof src.playlistId === "string" ? src.playlistId : null,
    attemptId: 0,
  };
}

/**
 * The next item to play automatically after `index` — the LOCAL natural-end rule (computeSessionNextTrackIndex):
 * loop "track" → the same item; otherwise the next item, wrapping after the last unless loop is "off".
 * Items without a playable URL and items that already failed in this run are skipped. null = nothing to play.
 */
export function nextAutoIndex(s: Pick<UrlSession, "items" | "index">, repeatMode: RepeatMode, failed: ReadonlySet<number>): number | null {
  const n = s.items.length;
  if (n === 0) return null;
  const ok = (i: number) => !!s.items[i]?.url && !failed.has(i);
  if (repeatMode === "track" && ok(s.index)) return s.index;
  for (let step = 1; step <= n; step++) {
    const raw = s.index + step;
    if (raw >= n && repeatMode === "off") return null;
    const i = raw % n;
    if (ok(i)) return i;
  }
  return null;
}

/** The published id of item `i` (leaf ids follow the renderer's `<shell>:track:r<i>` convention). */
export function sourceIdFor(s: UrlSession, i: number): string {
  return s.shell ? `${s.shell}${LEAF}r${i}` : s.sourceId;
}
