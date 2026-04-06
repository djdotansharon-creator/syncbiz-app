"use client";

import type { Playlist } from "@/lib/playlist-types";
import { getPlaylistTracks } from "@/lib/playlist-types";
import { getPlaylistsLocal } from "@/lib/playlists-local-store";
import { unifiedPlaylistSourceId } from "@/lib/playlist-utils";
import { radioToUnified } from "@/lib/radio-utils";
import type { RadioStream, UnifiedSource } from "@/lib/source-types";
import { sourceToUnified } from "@/lib/playback-provider";
import { supportsEmbedded } from "@/lib/player-utils";
import type { Schedule, Source } from "@/lib/types";

function playlistHasHttpPlayableUrl(playlist: Playlist): boolean {
  const top = (playlist.url ?? "").trim();
  if (top.startsWith("http://") || top.startsWith("https://")) return true;
  for (const t of getPlaylistTracks(playlist)) {
    const u = (t?.url ?? "").trim();
    if (u.startsWith("http://") || u.startsWith("https://")) return true;
  }
  return false;
}

function firstHttpUrlFromPlaylist(playlist: Playlist): string {
  const top = (playlist.url ?? "").trim();
  if (top.startsWith("http://") || top.startsWith("https://")) return top;
  for (const t of getPlaylistTracks(playlist)) {
    const u = (t?.url ?? "").trim();
    if (u.startsWith("http://") || u.startsWith("https://")) return u;
  }
  return "";
}

/** API returns on-disk JSON; browser may have richer `tracks` in localStorage from the same session. */
function mergePlaylistFromLocalCache(api: Playlist): Playlist {
  if (typeof window === "undefined") return api;
  try {
    const local = getPlaylistsLocal().find((p) => p.id === api.id);
    if (!local) return api;
    const localTracks = local.tracks?.length ?? 0;
    const apiTracks = api.tracks?.length ?? 0;
    const localHasHttp = playlistHasHttpPlayableUrl(local);
    const apiHasHttp = playlistHasHttpPlayableUrl(api);
    if (localTracks > apiTracks || (localHasHttp && !apiHasHttp)) {
      const topUrl = (() => {
        const lu = (local.url ?? "").trim();
        if (lu.startsWith("http://") || lu.startsWith("https://")) return lu;
        return api.url;
      })();
      return {
        ...api,
        tracks: local.tracks ?? api.tracks,
        order: local.order ?? api.order,
        url: topUrl,
      };
    }
  } catch {
    /* ignore */
  }
  return api;
}

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
    let playlist = (await res.json()) as Playlist;
    if (!playlist?.id) {
      setLastMessage("Failed: Invalid playlist");
      return false;
    }
    playlist = mergePlaylistFromLocalCache(playlist);
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
