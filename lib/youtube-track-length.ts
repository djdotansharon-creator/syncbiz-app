/**
 * A NEW YOUTUBE SONG'S LENGTH IS READ IN THE BROWSER THAT NEEDS IT (owner 2026-11-26: "find a way that is fast and takes almost no time, but only for a NEW song").
 *
 * The server cannot look a YouTube length up from its datacenter (YouTube refuses it: measured on PROD, 97 of 97 lookups failed within 4 seconds), so a song nobody has played yet had no length and a schedule
 * block could be stretched past it. The person who is editing the schedule has a browser that CAN: a hidden 1 x 1 YouTube embed is asked for the video's duration through YouTube's own `postMessage`
 * handshake (the same one the IFrame API uses; the answer arrives in the first `initialDelivery` message, 0.3 - 1.2 s in a real test) and is removed again. NOTHING PLAYS: no autoplay, muted, no audio, no
 * playback state, no player of ours is touched. Only a NUMBER is sent back - `POST /api/playlists/:id/track-durations { durations: { trackId: seconds } }` (the route the local-file reader already uses: it fills
 * only a song that has no length, never overwrites one, and keys by the song's own track id - never by its name, so two songs with the same name, or the same song in two playlists, can never mix).
 *
 * Asked only when a song with no length is picked for a schedule (never a sweep of the library), a couple of videos at a time, a short breath between, a hard cap per run (fewer on the station's own
 * computer, which is playing music), and a session memory so the same video is never probed twice.
 */

import type { Playlist } from "@/lib/playlist-types";
import { getPlaylistTracks } from "@/lib/playlist-types";
import { tracksMissingLength } from "@/lib/playlist-duration";
import { getYouTubeVideoId } from "@/lib/playlist-utils";
import { saveLengths } from "@/lib/local-track-length";

const YT_ORIGIN = "https://www.youtube.com";
/** one video is given this long to answer (a blocked / removed / embed-disabled video simply stays unknown) */
export const PROBE_TIMEOUT_MS = 8000;
/** how many hidden embeds are alive at once (the station is playing music: gentle) */
export const PROBE_CONCURRENCY = 2;
/** a short breath between two videos */
const BREATH_MS = 120;
/** at most this many videos per run - a browser / the station's own window (which is playing music) */
export const PROBE_CAP_BROWSER = 25;
export const PROBE_CAP_STATION = 6;
/** a video that gave no answer is not asked again for this long */
const RETRY_AFTER_MS = 120_000;
const SAVE_CHUNK = 10;

const answered = new Map<string, number>();
const failedAt = new Map<string, number>();

/** PURE: the duration (whole seconds) inside one message from the YouTube embed, or null (not a duration message, a live stream, or not believable) */
export function parseProbeMessage(raw: unknown): number | null {
  let d: unknown = raw;
  if (typeof raw === "string") {
    try {
      d = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!d || typeof d !== "object") return null;
  const info = (d as { info?: unknown }).info;
  if (!info || typeof info !== "object") return null;
  const dur = (info as { duration?: unknown }).duration;
  if (typeof dur !== "number" || !Number.isFinite(dur) || dur < 1 || dur > 12 * 3600) return null;
  return Math.round(dur);
}

/** PURE: a video id is exactly 11 URL-safe characters */
export function cleanVideoId(id: string | null | undefined): string | null {
  return typeof id === "string" && /^[\w-]{11}$/.test(id) ? id : null;
}

/** PURE: the hidden embed's address - cued only (no autoplay), muted, no controls */
export function probeSrc(videoId: string, origin: string): string {
  return `${YT_ORIGIN}/embed/${videoId}?enablejsapi=1&controls=0&mute=1&autoplay=0&playsinline=1&origin=${encodeURIComponent(origin)}`;
}

/** PURE: the YouTube songs of a playlist that have no length yet (a song that is not a plain YouTube video - a local file, a stream, a YouTube playlist link - is not here) */
export function youtubeTracksMissingLength(playlist: Playlist): { id: string; videoId: string }[] {
  const out: { id: string; videoId: string }[] = [];
  for (const t of tracksMissingLength(getPlaylistTracks(playlist))) {
    if (t.type !== "youtube" || typeof t.url !== "string") continue;
    const videoId = cleanVideoId(getYouTubeVideoId(t.url));
    if (videoId) out.push({ id: t.id, videoId });
  }
  return out;
}

/** a browser page can do this (any window with a document; no server rendering) */
export function canProbeYoutubeLengths(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined" && typeof window.addEventListener === "function";
}

/** Ask one video for its length through a hidden embed. Answers whole seconds or null; never rejects; the embed is always removed. */
export function probeYoutubeLength(videoId: string): Promise<number | null> {
  const id = cleanVideoId(videoId);
  if (!id || !canProbeYoutubeLengths()) return Promise.resolve(null);
  const have = answered.get(id);
  if (have) return Promise.resolve(have);
  const failed = failedAt.get(id);
  if (failed && Date.now() - failed < RETRY_AFTER_MS) return Promise.resolve(null);
  return new Promise<number | null>((resolve) => {
    let settled = false;
    let frame: HTMLIFrameElement | null = null;
    let ping = 0;
    let timer = 0;
    const finish = (sec: number | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      window.clearInterval(ping);
      window.clearTimeout(timer);
      try {
        frame?.remove();
      } catch {
        /* already gone */
      }
      if (sec) answered.set(id, sec);
      else failedAt.set(id, Date.now());
      resolve(sec);
    };
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== YT_ORIGIN || !frame || e.source !== frame.contentWindow) return;
      const sec = parseProbeMessage(e.data);
      if (sec) finish(sec);
    };
    try {
      frame = document.createElement("iframe");
      frame.setAttribute("aria-hidden", "true");
      frame.setAttribute("title", "");
      frame.tabIndex = -1;
      frame.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none";
      frame.src = probeSrc(id, window.location.origin);
      window.addEventListener("message", onMessage);
      // the embed answers once it is told someone is listening; asking before it has loaded is harmless
      ping = window.setInterval(() => {
        try {
          frame?.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: "vono-length", channel: "widget" }), YT_ORIGIN);
        } catch {
          /* not ready yet */
        }
      }, 250);
      timer = window.setTimeout(() => finish(null), PROBE_TIMEOUT_MS);
      document.body.appendChild(frame);
    } catch {
      finish(null);
    }
  });
}

async function run(playlist: Playlist): Promise<number | null> {
  const cap = typeof window !== "undefined" && typeof window.syncbizDesktop?.getConfig === "function" ? PROBE_CAP_STATION : PROBE_CAP_BROWSER;
  const todo = youtubeTracksMissingLength(playlist);
  if (todo.length === 0) return null;
  // one probe per VIDEO (the same video twice in a playlist is asked once and gives both songs their length)
  const byVideo = new Map<string, string[]>();
  for (const t of todo) byVideo.set(t.videoId, [...(byVideo.get(t.videoId) ?? []), t.id]);
  const videos = Array.from(byVideo.keys()).slice(0, cap);

  const found: Record<string, number> = {};
  let pending: Record<string, number> = {};
  let savedTotal: number | null = null;
  const flush = async () => {
    if (Object.keys(pending).length === 0) return;
    const batch = pending;
    pending = {};
    const answer = await saveLengths(playlist.id, batch);
    if (answer) savedTotal = answer.durationSeconds;
  };
  let next = 0;
  const worker = async () => {
    while (next < videos.length) {
      const v = videos[next++]!;
      const sec = await probeYoutubeLength(v);
      if (sec) {
        for (const trackId of byVideo.get(v) ?? []) {
          found[trackId] = sec;
          pending[trackId] = sec;
        }
        if (Object.keys(pending).length >= SAVE_CHUNK) await flush();
      }
      await new Promise<void>((r) => window.setTimeout(r, BREATH_MS));
    }
  };
  await Promise.all(Array.from({ length: Math.min(PROBE_CONCURRENCY, videos.length) }, worker));
  await flush();
  if (Object.keys(found).length === 0) return null;
  if (savedTotal !== null) return savedTotal;
  // not saved (a playlist this person may not change): the total is still right for this session when every song is now known
  let sum = 0;
  for (const t of getPlaylistTracks(playlist)) {
    const own = typeof t.durationSeconds === "number" && t.durationSeconds > 0 ? t.durationSeconds : found[t.id];
    if (!own) return null;
    sum += Math.round(own);
  }
  return sum > 0 ? sum : null;
}

const running = new Map<string, Promise<number | null>>();

/**
 * Read the length of the YouTube songs of `playlist` that have none and save them. Answers the playlist's total (seconds) when every song is known afterwards, else null.
 * One run per playlist at a time (a second caller shares the first). Never rejects.
 */
export function learnYoutubeLengths(playlist: Playlist): Promise<number | null> {
  const cur = running.get(playlist.id);
  if (cur) return cur;
  const p = run(playlist)
    .catch(() => null)
    .finally(() => running.delete(playlist.id));
  running.set(playlist.id, p);
  return p;
}

/** tests */
export function __resetYoutubeLengthMemoryForTests(): void {
  answered.clear();
  failedAt.clear();
  running.clear();
}
