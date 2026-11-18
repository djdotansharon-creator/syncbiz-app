"use client";

import type { Playlist } from "@/lib/playlist-types";
import { getPlaylistTracks } from "@/lib/playlist-types";
import { firstHttpUrlFromPlaylist, playlistHasHttpPlayableUrl } from "@/lib/playlist-playability";
import { unifiedPlaylistSourceId } from "@/lib/playlist-utils";
import { radioToUnified } from "@/lib/radio-utils";
import type { RadioStream, UnifiedSource } from "@/lib/source-types";
import { sourceToUnified } from "@/lib/playback-provider";
import { supportsEmbedded } from "@/lib/player-utils";
import type { Schedule, Source } from "@/lib/types";
import { stationMayStart, type ScheduleRoute } from "@/lib/schedule-station-route";
import { bankPackToUnified, findBankPack } from "@/lib/music-bank/bank-play-source";
import { markScheduleDriven } from "@/lib/schedule-driven";
import type { PlayStatus } from "@/lib/schedule-start-retry";

export type SchedulePlaybackHandlers = {
  stop: () => void;
  setQueue: (sources: UnifiedSource[], opts?: { force?: boolean }) => void;
  /** Must route to MASTER when this browser is branch CONTROL — see useSchedulePlaybackHandlers. */
  playSource: (source: UnifiedSource, trackIndex?: number) => void;
  setLastMessage: (msg: string | null) => void;
  /** 2026-11-11 — stop the music for a scheduled END / quiet block: the Stop button's own path (`device.stopOrSend`: MAIN's STOP on a station / controller, the local stop otherwise). Omitted = `stop`. */
  stopScheduled?: () => void;
  /** 2026-11-17 — is music playing right now (the station's own status, else this window's)? The engine uses it to see that a quiet block's stop really worked (lib/schedule-quiet-stop.ts). Omitted = no signal. */
  isAudible?: () => boolean;
  /** 2026-11-18 — what the Player is doing: "playing" | "paused" | "idle" | "stopped", or null while that is not known (a station whose first status has not arrived). The engine uses it to see that a block's start really started the music (lib/schedule-start-retry.ts). Omitted = no signal. */
  getPlayStatus?: () => PlayStatus;
  /** 2026-11-18 — this window only CONTROLS another player (a browser / the phone with a station playing elsewhere): it must not play over music that is already playing when it opens in the middle of a block (see decideScheduleAction `watch`). Omitted = false. */
  controlsAnotherPlayer?: () => boolean;
  /** 2026-11-17 — a block's own volume (lib/schedule-volume.ts): the volume now, and the way to change it (the Player's own path: MAIN's SET_VOLUME on a station / controller, else the local one). Omitted = the engine leaves the volume alone. */
  getVolume?: () => number | null;
  setVolume?: (value: number) => void;
  /** 2026-11-04 — where a schedule starts (lib/schedule-station-route.ts). Omitted = "default" (existing behavior). */
  route?: ScheduleRoute;
  /** 2026-11-12 — a music BANK streams through the media token the MASTER holds (a CONTROL just routes the token-free source to it). False = not ready yet: the block waits and the next poll retries. Omitted = ready. */
  bankStreamReady?: boolean;
};

type AppRouterLike = { push: (href: string) => void };

/**
 * Same rules as ScheduleCard "Play now": playlist / radio / source, embedded → /player, else in-app or play-local.
 * Playlist/radio paths use setQueue(..., { force: true }) so a scheduled block always preempts whatever was playing.
 * Playlist payload uses GET /api/playlists/:id (disk) only — no localStorage merge.
 * @returns whether playback was started or navigation was triggered successfully
 */
export async function runSchedulePlayback(
  schedule: Schedule,
  source: Source | null,
  handlers: SchedulePlaybackHandlers,
  router: AppRouterLike,
): Promise<boolean> {
  const tid = (schedule.targetId || schedule.sourceId || "").trim();
  const { stop, setQueue, playSource, setLastMessage } = handlers;
  const route: ScheduleRoute = handlers.route ?? { kind: "default" };
  // Designated station's own window, route not known yet (MAIN's designation snapshot pending): start nothing — the
  // current music keeps playing and the next poll retries (never the renderer's own player on top of MAIN's session).
  if (route.kind === "wait") return false;
  /**
   * Start a playlist / radio target. Designated station's own window: EXACTLY a manual library click — queue + playSourceOrSend
   * (URL → MAIN's session, LOCAL → the accepted LOCAL path), WITHOUT stopping the current music first; a URL target waits
   * (false → retried next poll) until it can reach MAIN. Every other window: unchanged (stop → queue → play row 0).
   */
  const start = (unified: UnifiedSource, stationTrackIndex: number): boolean => {
    if (route.kind === "station") {
      if (!stationMayStart(route, unified.type)) return false;
      setQueue([unified], { force: true });
      playSource(unified, stationTrackIndex);
      markScheduleDriven(unified.id); // the player may line up a suggested song after it instead of starting it over (lib/schedule-driven.ts)
      return true;
    }
    stop();
    setQueue([unified], { force: true });
    playSource(unified, 0);
    markScheduleDriven(unified.id);
    return true;
  };

  if (schedule.targetType === "PLAYLIST" && tid) {
    if (source && supportsEmbedded(source)) {
      router.push(`/player?playlistId=${encodeURIComponent(tid)}`);
      return true;
    }
    setLastMessage(null);
    const res = await fetch(`/api/playlists/${encodeURIComponent(tid)}`, {
      credentials: "include",
      cache: "no-store",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setLastMessage(data?.error ? `Failed: ${data.error}` : "Playlist not found.");
      return false;
    }
    const playlist = (await res.json()) as Playlist;
    if (!playlist?.id) {
      setLastMessage("Failed: Invalid playlist");
      return false;
    }
    if (!playlistHasHttpPlayableUrl(playlist)) {
      setLastMessage(
        "הפלייליסט נשמר רק כמעטפת קטלוג (local) בלי קישורי YouTube/HTTP. פתח את הפלייליסט בספרייה והוסף שירים, או בחר פלייליסט עם קישורים ישירים — ניגון אוטומטי בדפדפן דורש כתובת https.",
      );
      return false;
    }
    const tracks = getPlaylistTracks(playlist);
    const effectiveUrl = firstHttpUrlFromPlaylist(playlist);
    if (!effectiveUrl) {
      setLastMessage("Failed: Playlist has no playable URL");
      return false;
    }
    const first =
      tracks.find((t) => {
        const u = (t?.url ?? "").trim();
        return u.startsWith("http://") || u.startsWith("https://");
      }) ?? tracks[0];
    const unified: UnifiedSource = {
      id: unifiedPlaylistSourceId(playlist.id),
      title: playlist.name,
      genre: playlist.genre || "Mixed",
      cover: playlist.thumbnail || playlist.cover || null,
      type: (first?.type ?? playlist.type) as UnifiedSource["type"],
      url: effectiveUrl,
      origin: "playlist",
      playlist,
    };
    // Station: the exact row of the first playable track (a shell at row 0 keeps the existing payload rule).
    return start(unified, Math.max(0, tracks.indexOf(first)));
  }

  if (schedule.targetType === "RADIO" && tid) {
    setLastMessage(null);
    const res = await fetch(`/api/radio/${encodeURIComponent(tid)}`, {
      credentials: "include",
      cache: "no-store",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setLastMessage(data?.error ? `Failed: ${data.error}` : "Radio station not found.");
      return false;
    }
    const station = (await res.json()) as RadioStream;
    if (!station?.url) {
      setLastMessage("Failed: Invalid radio station");
      return false;
    }
    const unified = radioToUnified(station);
    return start(unified, 0);
  }

  if (schedule.targetType === "BANK" && tid) {
    // a royalty-free music bank: played exactly like the Royalty-Free screen's "Listen" (a token-free /api/media/<id> playlist) — see lib/music-bank/bank-play-source.ts
    if (handlers.bankStreamReady === false) return false;
    setLastMessage(null);
    const pack = await findBankPack(tid);
    if (!pack) {
      setLastMessage("Failed: Music bank not found.");
      return false;
    }
    const unified = bankPackToUnified(pack, typeof window !== "undefined" ? window.location.origin : "");
    if (!unified) {
      setLastMessage("Failed: This music bank has no songs.");
      return false;
    }
    return start(unified, 0);
  }

  let src = source;
  if (!src && tid) {
    const res = await fetch("/api/sources", { credentials: "include", cache: "no-store" });
    if (res.ok) {
      const list = (await res.json()) as Source[];
      src = Array.isArray(list) ? list.find((s) => s.id === tid) ?? null : null;
    }
  }
  if (!src) return false;

  if (supportsEmbedded(src)) {
    router.push(`/player?sourceId=${src.id}`);
    return true;
  }
  setLastMessage(null);
  const unifiedSrc = sourceToUnified(src);
  if (route.kind === "station" && !stationMayStart(route, unifiedSrc.type)) return false;
  playSource(unifiedSrc, 0);
  markScheduleDriven(unifiedSrc.id);
  const target = (src.target ?? src.uriOrPath ?? "").trim();
  if (!target) {
    setLastMessage("Failed: No target path");
    return false;
  }
  // Browser schedule playback for HTTP/HTTPS targets is already handled by playSource()
  // (embedded / in-app transport). Avoid forcing server-side play-local here, which is
  // Windows-only and causes repeated retry loops on Linux runtimes (e.g. Railway).
  if (target.startsWith("http://") || target.startsWith("https://")) {
    return true;
  }
  const res = await fetch("/api/commands/play-local", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      target,
      browserPreference: src.browserPreference ?? "default",
    }),
  });
  if (res.ok) {
    setLastMessage("Local playback command sent");
    return true;
  }
  const data = await res.json().catch(() => ({}));
  setLastMessage(data?.error ? `Failed: ${data.error}` : "Playback failed.");
  return false;
}
