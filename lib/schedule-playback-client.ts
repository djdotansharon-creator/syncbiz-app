"use client";

import type { Playlist } from "@/lib/playlist-types";
import { radioToUnified } from "@/lib/radio-utils";
import type { RadioStream, UnifiedSource } from "@/lib/source-types";
import { supportsEmbedded } from "@/lib/player-utils";
import type { Schedule, Source } from "@/lib/types";

export type SchedulePlaybackHandlers = {
  stop: () => void;
  setQueue: (sources: UnifiedSource[]) => void;
  playSource: (source: UnifiedSource, trackIndex?: number) => void;
  playSourceFromDb: (source: Source, opts?: { auditScheduledNonEmbedded?: boolean }) => void;
  setLastMessage: (msg: string | null) => void;
};

type AppRouterLike = { push: (href: string) => void };

/**
 * Same rules as ScheduleCard "Play now": playlist / radio / source, embedded → /player, else in-app or play-local.
 * @returns whether playback was started or navigation was triggered successfully
 */
export async function runSchedulePlayback(
  schedule: Schedule,
  source: Source | null,
  handlers: SchedulePlaybackHandlers,
  router: AppRouterLike,
): Promise<boolean> {
  const tid = (schedule.targetId || schedule.sourceId || "").trim();
  const { stop, setQueue, playSource, playSourceFromDb, setLastMessage } = handlers;

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
    const unified: UnifiedSource = {
      id: `pl-${playlist.id}`,
      title: playlist.name,
      genre: playlist.genre || "Mixed",
      cover: playlist.thumbnail || playlist.cover || null,
      type: (playlist.tracks?.[0]?.type ?? playlist.type) as UnifiedSource["type"],
      url: playlist.url,
      origin: "playlist",
      playlist,
    };
    stop();
    setQueue([unified]);
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
    setQueue([unified]);
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
  playSourceFromDb(src, { auditScheduledNonEmbedded: true });
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
