"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ActionButtonPlayNow, ActionButtonDelete } from "@/components/ui/action-buttons";
import { DeleteConfirmModal } from "@/components/delete-confirm-modal";
import { useTranslations } from "@/lib/locale-context";
import { usePlayback } from "@/lib/playback-provider";
import { getPlaylistTracks, type Playlist } from "@/lib/playlist-types";
import { canonicalYouTubeWatchUrlForPlayback } from "@/lib/playlist-utils";
import { supportsEmbedded } from "@/lib/player-utils";
import type { UnifiedSource } from "@/lib/source-types";
import type { Device, Schedule, Source } from "@/lib/types";

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

function formatDays(
  days: number[],
  t: Record<string, string>,
) {
  if (days.length === 7) return t.everyDay;
  if (days.length === 5 && days.every((d) => d >= 1 && d <= 5))
    return t.weekdays;
  return days
    .sort((a, b) => a - b)
    .map((d) => t[DAY_KEYS[d]])
    .join(", ");
}

type ScheduleCardProps = {
  schedule: Schedule;
  device: Device | null;
  source: Source | null;
};

export function ScheduleCard({ schedule, device, source }: ScheduleCardProps) {
  const router = useRouter();
  const { t } = useTranslations();
  const { playSourceFromDb, setLastMessage, stop, setQueue, playSource } = usePlayback();
  const [deleting, setDeleting] = useState(false);
  const [playing, setPlaying] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/schedules/${schedule.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        router.refresh();
        setDeleteOpen(false);
      }
    } finally {
      setDeleting(false);
    }
  }

  async function handlePlayNow() {
    const schedulePlaylistId =
      schedule.targetType === "PLAYLIST" ? (schedule.targetId || schedule.sourceId || "").trim() : "";

    if (schedulePlaylistId) {
      if (source && supportsEmbedded(source)) {
        router.push(`/player?playlistId=${encodeURIComponent(schedulePlaylistId)}`);
        return;
      }

      setPlaying(true);
      setLastMessage(null);
      try {
        const res = await fetch(`/api/playlists/${encodeURIComponent(schedulePlaylistId)}`, {
          credentials: "include",
          cache: "no-store",
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setLastMessage(data?.error ? `Failed: ${data.error}` : "Playlist not found.");
          return;
        }
        const playlist = (await res.json()) as Playlist;
        if (!playlist?.id) {
          setLastMessage("Failed: Invalid playlist");
          return;
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

        const tracks = getPlaylistTracks(playlist);
        const rawLeaf = (tracks[0]?.url ?? playlist.url).trim();
        if (!rawLeaf) {
          setLastMessage("Failed: No target path");
          return;
        }
        const target = canonicalYouTubeWatchUrlForPlayback(rawLeaf);
        const cmdRes = await fetch("/api/commands/play-local", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            target,
            browserPreference: source?.browserPreference ?? "default",
          }),
        });
        if (cmdRes.ok) {
          setLastMessage("Local playback command sent");
        } else {
          const data = await cmdRes.json().catch(() => ({}));
          setLastMessage(data?.error ? `Failed: ${data.error}` : "Playback failed.");
        }
        router.refresh();
      } finally {
        setPlaying(false);
      }
      return;
    }

    if (!source) return;
    if (supportsEmbedded(source)) {
      router.push(`/player?sourceId=${source.id}`);
      return;
    }
    setPlaying(true);
    setLastMessage(null);
    try {
      playSourceFromDb(source, { auditScheduledNonEmbedded: true });
      const target = (source.target ?? source.uriOrPath ?? "").trim();
      if (!target) {
        setLastMessage("Failed: No target path");
        return;
      }
      const res = await fetch("/api/commands/play-local", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target,
          browserPreference: source.browserPreference ?? "default",
        }),
      });
      if (res.ok) {
        setLastMessage("Local playback command sent");
      } else {
        const data = await res.json().catch(() => ({}));
        setLastMessage(data?.error ? `Failed: ${data.error}` : "Playback failed.");
      }
      router.refresh();
    } finally {
      setPlaying(false);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-800/80 bg-slate-950/50 p-5 transition hover:border-slate-700/80">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-base font-medium text-slate-50">
            {schedule.name}
          </h2>
          <p className="text-sm text-slate-400">
            <span className="text-slate-300">
              {device ? device.name : t.anyDevice}
            </span>
            {" → "}
            <span className="text-slate-300">
              {source ? source.name : t.unknownSource}
            </span>
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-2 text-xs text-slate-500">
            <span>
              {schedule.startTimeLocal} – {schedule.endTimeLocal}
            </span>
            <span>{formatDays(schedule.daysOfWeek, t)}</span>
            <span>{t.priority} {schedule.priority}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
              schedule.enabled
                ? "bg-emerald-500/10 text-emerald-300"
                : "bg-slate-800 text-slate-500"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                schedule.enabled ? "bg-emerald-400" : "bg-slate-500"
              }`}
            />
            {schedule.enabled ? t.enabled : t.disabled}
          </span>
          <ActionButtonPlayNow
            onClick={handlePlayNow}
            disabled={playing}
            loading={playing}
            label={t.playNow}
            loadingLabel={t.sending}
          />
          <ActionButtonDelete
            onClick={() => setDeleteOpen(true)}
            disabled={deleting}
            title={t.delete}
            aria-label={t.delete}
          />
        </div>
      </div>
      <DeleteConfirmModal
        isOpen={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
        loading={deleting}
        message={t.deleteScheduleConfirm}
      />
    </div>
  );
}
