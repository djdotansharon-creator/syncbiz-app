"use client";

/**
 * AutoplayRecommender — when a SINGLE song is playing, line up the next song the platform recommends for it as the
 * Play Next item (owner 2026-10-18: "if I put one song and it ends, don't start it over — play what the platform
 * recommends … prepared in advance, for ALL songs"). It only fills the EXISTING Play Next queue, so the end-of-song
 * behaviour is the player's own, tested path (`next()` dequeues Play Next) — nothing in the playback chain changes.
 * Works for every online single (YouTube via its Mix, SoundCloud/Spotify by title+artist). The fetch is NOT tied to the
 * effect's lifetime (a title that loads a moment later, or a pause, used to throw the answer away — the "only some
 * songs get a next one" bug) and retries with back-off until a next song is lined up. Skipped: playlists (they continue
 * themselves), LOOP-this-track, a CONTROL device (the master does it), a queue the operator already filled, and
 * `localStorage syncbiz:autoplayNext = "off"`. A song never repeats within the last 40. Renders null.
 * 2026-10-23 (owner): with LOOP off, the LAST song of a list (album / playlist with tracks) is treated like a single song too.
 */

import { useEffect, useRef } from "react";
import { usePlayback } from "@/lib/playback-provider";
import { useDevicePlayer } from "@/lib/device-player-context";
import { getYouTubeVideoId } from "@/lib/playlist-utils";
import { getPlaylistTracks } from "@/lib/playlist-types";
import { getRepeatMode } from "@/lib/mix-preferences";
import type { UnifiedSource } from "@/lib/source-types";

const AUTOPLAY_GENRE = "Autoplay";
const recent: string[] = [];
const remember = (id: string) => {
  const i = recent.indexOf(id);
  if (i >= 0) recent.splice(i, 1);
  recent.push(id);
  if (recent.length > 40) recent.shift();
};

type Cand = { videoId: string; title: string; url: string; thumbnailUrl?: string };

/** Last resort so a song is ALWAYS lined up next (owner 2026-10-18: "nothing waiting in the list" must still have a next song): another
 *  single from the operator's own library — not the current song, not played recently. Only used when the recommendation service
 *  returned nothing (it can be slow or down). */
async function libraryPick(currentVid: string | null, currentTitle: string): Promise<UnifiedSource | null> {
  try {
    const res = await fetch("/api/sources/unified", { cache: "no-store" });
    if (!res.ok) return null;
    const list = (await res.json()) as UnifiedSource[];
    if (!Array.isArray(list)) return null;
    const pool = list.filter((u) => {
      if (!u?.url || (u.type !== "youtube" && u.type !== "soundcloud") || u.origin === "radio") return false;
      if (u.playlist && getPlaylistTracks(u.playlist).length > 1) return false; // singles only
      const id = getYouTubeVideoId(u.url) ?? u.id;
      if (currentVid && id === currentVid) return false;
      if (recent.includes(id)) return false;
      return u.title.trim().toLowerCase() !== currentTitle.trim().toLowerCase();
    });
    if (pool.length === 0) return null;
    return pool[Math.floor(Math.random() * pool.length)] ?? null;
  } catch {
    return null;
  }
}

/** back-off between attempts (ms) — the recommendation backend (yt-dlp) can be slow or flaky */
const RETRY_DELAYS = [0, 5000, 14000, 30000, 60000];
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function AutoplayRecommender(): null {
  const pb = usePlayback();
  const device = useDevicePlayer();
  const live = useRef({ queue: pb.playNextQueue, add: pb.addPlayNextSources, remove: pb.removePlayNextItem, seed: null as string | null });
  const lastSeed = useRef<string | null>(null); // the song the Play Next housekeeping was last done for
  const doneFor = useRef<string | null>(null); // a next song is lined up (or deliberately not needed) for this song
  const runningFor = useRef<string | null>(null); // a fetch loop is in flight for this song
  const removed = useRef<Set<string>>(new Set()); // stale recommendations just dropped (the queue snapshot lags a render)

  const src = pb.currentSource;
  const track = pb.currentTrack;
  const url = (track?.url ?? src?.url ?? "").trim();
  const vid = url && !/[?&]list=/.test(url) ? getYouTubeVideoId(url) : null;
  const sessionLen = pb.currentPlaylist ? getPlaylistTracks(pb.currentPlaylist).length : 1;
  // 2026-10-23 (owner): with LOOP off the LAST song of a list gets a recommended next song lined up too — exactly like a single song
  // ("when an album ends the next song is ready automatically"). While loop is ON the list wraps by itself, so nothing is needed.
  const lastOfList = sessionLen > 1 && pb.currentTrackIndex >= sessionLen - 1 && getRepeatMode() === "off";
  const title = (track?.title ?? src?.title ?? "").trim();
  const artist = ((track as { artist?: string } | null)?.artist ?? (src as { artist?: string } | null)?.artist ?? "").trim();
  const kind = src?.type ?? null;
  const online = kind === "youtube" || kind === "soundcloud" || kind === "spotify";
  // YouTube songs are seeded by their id; SoundCloud/Spotify singles by their title
  const seed = vid ? vid : online && src?.origin !== "radio" && title ? `t:${title.toLowerCase()}` : null;
  const playing = pb.status === "playing";
  const isControl = device?.deviceMode === "CONTROL";

  useEffect(() => {
    live.current = { queue: pb.playNextQueue, add: pb.addPlayNextSources, remove: pb.removePlayNextItem, seed };
  });

  // The operator's "Play next" always goes in FRONT of the platform's own pick (owner 2026-10-26: "I pressed Play next — why isn't that song the first one?"). A song lined up by
  // this component is only a fallback for when nothing else is waiting: the moment something the operator queued is there it steps aside (and is lined up again for whatever
  // plays next). Only items this component added (genre "Autoplay") are ever removed — the operator's own queue and its order are never touched.
  useEffect(() => {
    if (isControl) return; // the master's own recommender does this for the station
    const queue = pb.playNextQueue;
    if (!queue.some((it) => it.genre !== AUTOPLAY_GENRE)) return;
    for (const it of queue) {
      if (it.genre !== AUTOPLAY_GENRE || removed.current.has(it.id)) continue;
      removed.current.add(it.id);
      live.current.remove(it.id);
    }
  }, [pb.playNextQueue, isControl]);

  const loggedSkip = useRef<string>("");
  useEffect(() => {
    // READ-ONLY diagnostics (grep "[VONO Autoplay]"): why a song did / did not get a next one lined up
    let why: string | null = null;
    if (!seed) why = null;
    else if (!playing) why = null; // not started yet — it will run once the song plays
    else if (isControl) why = "control-device";
    else if (sessionLen > 1 && !lastOfList) why = `part-of-a-playlist(${sessionLen} tracks)`;
    else {
      try {
        if (localStorage.getItem("syncbiz:autoplayNext") === "off") why = "switched-off";
      } catch {
        /* ignore */
      }
      if (!why && getRepeatMode() === "track") why = "loop-this-track";
    }
    if (seed && playing && why) {
      if (loggedSkip.current !== `${seed}|${why}`) {
        loggedSkip.current = `${seed}|${why}`;
        console.log("[VONO Autoplay] skipped", { why, seed, title });
      }
      if (why.startsWith("part-of-a-playlist")) {
        // left the LAST song of a list (prev / another track): a recommendation lined up for it must not fire in the middle of the list
        for (const it of live.current.queue) {
          if (it.genre !== AUTOPLAY_GENRE) continue;
          removed.current.add(it.id);
          live.current.remove(it.id);
        }
        lastSeed.current = null;
        doneFor.current = null;
      }
      return;
    }
    if (!seed || !playing) return;

    if (lastSeed.current !== seed) {
      lastSeed.current = seed;
      doneFor.current = null;
      if (vid) remember(vid);
      // recommendations queued for an EARLIER song are stale now — drop them; anything the operator queued stays and wins
      for (const it of live.current.queue) {
        if (it.genre !== AUTOPLAY_GENRE) continue;
        removed.current.add(it.id);
        live.current.remove(it.id);
      }
      if (live.current.queue.some((it) => it.genre !== AUTOPLAY_GENRE)) doneFor.current = seed;
    }
    if (doneFor.current === seed || runningFor.current === seed) return;
    runningFor.current = seed;

    const params = `v=${encodeURIComponent(vid ?? "")}&title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}`;
    void (async () => {
      try {
        const lineUpFromLibrary = async (): Promise<boolean> => {
          const lib = await libraryPick(vid, title);
          if (!lib || live.current.seed !== seed) return false;
          const id = getYouTubeVideoId(lib.url) ?? lib.id;
          remember(id);
          live.current.add([{ ...lib, id: `autoplay-lib-${lib.id}`, genre: AUTOPLAY_GENRE } as UnifiedSource]);
          doneFor.current = seed;
          console.log("[VONO Autoplay] library fallback", { picked: lib.title });
          return true;
        };
        for (let attempt = 0; attempt < RETRY_DELAYS.length; attempt++) {
          const delay = RETRY_DELAYS[attempt]!;
          if (delay) await wait(delay);
          if (live.current.seed !== seed || doneFor.current === seed) return; // the song changed / already handled
          const queued = live.current.queue.filter((it) => !removed.current.has(it.id));
          if (queued.some((it) => it.genre !== AUTOPLAY_GENRE)) {
            doneFor.current = seed; // the operator queued something — theirs wins
            return;
          }
          if (queued.some((it) => it.genre === AUTOPLAY_GENRE)) {
            doneFor.current = seed; // a recommendation for this song is already lined up
            return;
          }
          try {
            const res = await fetch(`/api/sources/youtube-recommend?${params}`);
            if (!res.ok) {
              console.log("[VONO Autoplay] recommend failed", { status: res.status, attempt: attempt + 1 });
              if (attempt >= 1 && (await lineUpFromLibrary())) return;
              continue;
            }
            const data = (await res.json()) as { candidates?: Cand[]; source?: string };
            const pick = (data.candidates ?? []).find((c) => c.videoId && !recent.includes(c.videoId));
            console.log("[VONO Autoplay] recommend", { attempt: attempt + 1, source: data.source, candidates: data.candidates?.length ?? 0, picked: pick?.title ?? null });
            if (!pick || live.current.seed !== seed) {
              if (attempt >= 1 && live.current.seed === seed && (await lineUpFromLibrary())) return;
              continue;
            }
            remember(pick.videoId);
            const next: UnifiedSource = {
              id: `autoplay-${pick.videoId}`,
              title: pick.title,
              genre: AUTOPLAY_GENRE,
              cover: pick.thumbnailUrl ?? null,
              type: "youtube",
              url: pick.url,
              origin: "playlist",
            } as UnifiedSource;
            live.current.add([next]);
            doneFor.current = seed;
            return;
          } catch {
            /* best effort — try again after the back-off; without a recommendation the player behaves exactly as before */
          }
        }
      } finally {
        if (runningFor.current === seed) runningFor.current = null;
      }
    })();
  }, [seed, vid, playing, isControl, sessionLen, lastOfList, title, artist]);

  return null;
}
