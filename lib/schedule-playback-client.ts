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

export type SchedulePlaybackHandlers = {
  stop: () => void;
  setQueue: (sources: UnifiedSource[], opts?: { force?: boolean }) => void;
  /** Must route to MASTER when this browser is branch CONTROL — see useSchedulePlaybackHandlers. */
  playSource: (source: UnifiedSource, trackIndex?: number) => void;
  setLastMessage: (msg: string | null) => void;
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
    stop();
    setQueue([unified], { force: true });
    playSource(unified, 0);
    return true;
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
    stop();
    setQueue([unified], { force: true });
    playSource(unified, 0);
    return true;
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
  playSource(sourceToUnified(src), 0);
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
