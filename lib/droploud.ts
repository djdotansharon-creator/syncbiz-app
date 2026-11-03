/**
 * Droploud (droploud.com) as a first-class VONO URL source — PURE helpers (no network, safe in any bundle).
 *
 * Droploud content comes in two shapes (verified 2026-11-03):
 *  - `https://droploud.com/track/<uuid>` pages whose track object carries a real SoundCloud track
 *    (`soundcloud_url`) — Droploud is a free-download gate in front of SoundCloud.
 *  - audio files on Droploud's own public storage (`track_preview_url` → `…r2.dev/…wav`, served as audio/*).
 *
 * VONO never converts Droploud to YouTube. A pasted Droploud URL is resolved ONCE, server-side, at save time
 * (`lib/droploud-resolve.ts`) into a playable target that plays through an EXISTING engine path:
 *  - a SoundCloud track  → saved as type "soundcloud"  (SoundCloud widget in the browser / yt-dlp→MPV on desktop)
 *  - a Droploud audio file → saved as type "stream-url" (direct audio: HTML audio / MPV)
 *
 * To support a NEW kind of Droploud audio, add a row to DROPLOUD_TRACK_AUDIO_FIELDS — the playback engine is
 * never touched.
 */

/** Error code returned (HTTP 422) when a Droploud URL has nothing VONO can play. Clients map it to a clear message. */
export const DROPLOUD_UNPLAYABLE_CODE = "DROPLOUD_UNPLAYABLE";

/** Droploud web pages. */
export const DROPLOUD_PAGE_HOSTS: readonly string[] = ["droploud.com", "www.droploud.com"];

/** Droploud's own public audio storage (Cloudflare R2 public bucket). Direct Droploud audio files live here. */
export const DROPLOUD_AUDIO_HOSTS: readonly string[] = ["pub-a3c836eb99ad47b79b3fb24317c2faf6.r2.dev"];

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const TRACK_PATH_RE = new RegExp(`^/track/(${UUID})/?$`, "i");

export type DroploudUrlKind =
  | { kind: "track_page"; trackId: string; pageUrl: string }
  | { kind: "audio_file"; fileUrl: string }
  | { kind: "other_page" };

function parseHttpUrl(raw: string): URL | null {
  try {
    const u = new URL(String(raw ?? "").trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u : null;
  } catch {
    return null;
  }
}

/** Classify a URL as a Droploud track page / Droploud audio file / other Droploud page. `null` = not Droploud. */
export function classifyDroploudUrl(raw: string): DroploudUrlKind | null {
  const u = parseHttpUrl(raw);
  if (!u) return null;
  const host = u.hostname.toLowerCase();
  if (DROPLOUD_AUDIO_HOSTS.includes(host)) {
    // Storage is public HTTPS only; never accept a downgraded or credentialed URL.
    if (u.protocol !== "https:" || u.username || u.password) return { kind: "other_page" };
    return { kind: "audio_file", fileUrl: u.href };
  }
  if (!DROPLOUD_PAGE_HOSTS.includes(host)) return null;
  const m = TRACK_PATH_RE.exec(u.pathname);
  if (m) {
    const trackId = m[1].toLowerCase();
    return { kind: "track_page", trackId, pageUrl: `https://droploud.com/track/${trackId}` };
  }
  return { kind: "other_page" };
}

export function isDroploudUrl(raw: string): boolean {
  return classifyDroploudUrl(raw) !== null;
}

/** Strict SoundCloud TRACK URL (https://soundcloud.com/<user>/<slug>) — no sets, no other hosts, no params. */
export function normalizeSoundCloudTrackUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const u = parseHttpUrl(raw);
  if (!u || u.protocol !== "https:" || u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  if (host !== "soundcloud.com" && host !== "www.soundcloud.com" && host !== "m.soundcloud.com") return null;
  const segs = u.pathname.split("/").filter(Boolean);
  if (segs.length !== 2) return null;
  const [user, slug] = segs;
  if (!/^[A-Za-z0-9_-]+$/.test(user) || !/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(slug)) return null;
  if (slug.toLowerCase() === "sets" || user.toLowerCase() === "discover") return null;
  return `https://soundcloud.com/${user}/${slug}`;
}

/** A Droploud direct audio file URL is accepted only on Droploud's own hosts (HTTPS). */
export function normalizeDroploudAudioFileUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const u = parseHttpUrl(raw);
  if (!u || u.protocol !== "https:" || u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  if (!DROPLOUD_AUDIO_HOSTS.includes(host) && !DROPLOUD_PAGE_HOSTS.includes(host)) return null;
  return u.href;
}

export type DroploudPlaybackKind = "soundcloud" | "direct_audio";

/**
 * Where playable audio can live on a Droploud TRACK object. `fullTrack: false` = a preview (used only when
 * nothing full exists). Selection: every full-track field first (in table order — SoundCloud before Droploud
 * full audio), then previews (in table order). Add rows here for new Droploud audio shapes.
 */
export const DROPLOUD_TRACK_AUDIO_FIELDS: ReadonlyArray<{
  field: string;
  kind: DroploudPlaybackKind;
  fullTrack: boolean;
}> = [
  { field: "soundcloud_url", kind: "soundcloud", fullTrack: true },
  // Droploud-hosted FULL tracks — not observed on 2026-11-03; used automatically if Droploud starts serving them.
  { field: "audio_url", kind: "direct_audio", fullTrack: true },
  { field: "full_track_url", kind: "direct_audio", fullTrack: true },
  { field: "stream_url", kind: "direct_audio", fullTrack: true },
  // Previews — last resort only.
  { field: "track_preview_url", kind: "direct_audio", fullTrack: false },
  { field: "preview_url", kind: "direct_audio", fullTrack: false },
];

export type DroploudCandidate = { kind: DroploudPlaybackKind; url: string; fullTrack: boolean; field: string };

/** Valid candidates from a Droploud track object, in table order. Invalid / foreign URLs are dropped. */
export function droploudCandidatesFromTrackObject(obj: Record<string, unknown>): DroploudCandidate[] {
  const out: DroploudCandidate[] = [];
  for (const row of DROPLOUD_TRACK_AUDIO_FIELDS) {
    const raw = obj[row.field];
    const url = row.kind === "soundcloud" ? normalizeSoundCloudTrackUrl(raw) : normalizeDroploudAudioFileUrl(raw);
    if (url) out.push({ kind: row.kind, url, fullTrack: row.fullTrack, field: row.field });
  }
  return out;
}

/**
 * THE selection policy, as an order: every full track first (table order — SoundCloud before Droploud full audio),
 * then previews (table order). The resolver walks this order so a direct file that turns out not to serve audio
 * falls through to the next candidate instead of failing.
 */
export function orderDroploudCandidates(candidates: readonly DroploudCandidate[]): DroploudCandidate[] {
  return [...candidates.filter((c) => c.fullTrack), ...candidates.filter((c) => !c.fullTrack)];
}

/** First choice under the policy (no network checks). */
export function pickDroploudPlayback(candidates: readonly DroploudCandidate[]): DroploudCandidate | null {
  return orderDroploudCandidates(candidates)[0] ?? null;
}

/** Concatenate the Next.js flight data (`self.__next_f.push([1,"…"])`) of a Droploud page into plain text. */
export function extractNextFlightText(html: string): string {
  const re = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;
  let text = "";
  for (const m of html.matchAll(re)) {
    try {
      text += JSON.parse(m[1]) as string;
    } catch {
      /* a malformed chunk is skipped, never fatal */
    }
  }
  return text;
}

/** Slice the balanced JSON object that starts at `start` (string-aware). Returns [text, endIndex] or null. */
function sliceJsonObject(text: string, start: number): [string, number] | null {
  if (text[start] !== "{") return null;
  let depth = 0;
  let inStr = false;
  for (let i = start; i < text.length && i < start + 200_000; i++) {
    const ch = text[i];
    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return [text.slice(start, i + 1), i + 1];
    }
  }
  return null;
}

export type DroploudTrackInfo = {
  title?: string;
  artist?: string;
  cover?: string;
  candidates: DroploudCandidate[];
};

/**
 * Extract THIS track (the object whose `id` is `trackId`) from a Droploud track page. Anchored on the track's own
 * id, so related / chart tracks listed on the same page are never picked. `null` = the track was not found.
 */
export function extractDroploudTrack(html: string, trackId: string): DroploudTrackInfo | null {
  const id = trackId.toLowerCase();
  const flight = extractNextFlightText(html);
  const sources = flight ? [flight] : [];
  // Fallback: some deploys inline the data with escaped quotes instead of flight chunks.
  sources.push(html.replace(/\\"/g, '"'));
  for (const text of sources) {
    const needle = `{"id":"${id}"`;
    let from = 0;
    for (;;) {
      const at = text.toLowerCase().indexOf(needle, from);
      if (at < 0) break;
      from = at + needle.length;
      const sliced = sliceJsonObject(text, at);
      if (!sliced) continue;
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(sliced[0]) as Record<string, unknown>;
      } catch {
        continue;
      }
      const candidates = droploudCandidatesFromTrackObject(obj);
      if (candidates.length === 0 && typeof obj.title !== "string") continue;
      const after = text.slice(sliced[1], sliced[1] + 400);
      const artistM = /^,"artist":\{"display_name":"((?:[^"\\]|\\.)*)"/.exec(after);
      let artist: string | undefined;
      if (artistM) {
        try {
          artist = (JSON.parse(`"${artistM[1]}"`) as string).trim() || undefined;
        } catch {
          artist = undefined;
        }
      }
      const cover = normalizeDroploudAudioFileUrl(obj.cover_url) ?? undefined;
      const title = typeof obj.title === "string" ? obj.title.trim() || undefined : undefined;
      return { title, artist, cover, candidates };
    }
  }
  return null;
}

/** Display name convention used across the library: "Artist - Title" when the artist is known. */
export function droploudDisplayTitle(info: { title?: string; artist?: string }): string | undefined {
  const t = info.title?.trim();
  const a = info.artist?.trim();
  if (t && a) return `${a} - ${t}`;
  return t || undefined;
}

/** True when a client-sent name is only a placeholder (so the server may use Droploud's real title instead). */
export function isPlaceholderSourceName(name: string, rawUrl: string): boolean {
  const n = (name ?? "").trim().toLowerCase();
  if (!n) return true;
  if (n === "untitled" || n === "ללא כותרת" || n === "droploud") return true;
  if (n === (rawUrl ?? "").trim().toLowerCase()) return true;
  return /^(www\.)?droploud\.com$/.test(n) || DROPLOUD_AUDIO_HOSTS.includes(n);
}
