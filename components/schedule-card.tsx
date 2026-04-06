"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ActionButtonPlayNow, ActionButtonDelete } from "@/components/ui/action-buttons";
import { DeleteConfirmModal } from "@/components/delete-confirm-modal";
import { useTranslations } from "@/lib/locale-context";
import { usePlayback } from "@/lib/playback-provider";
import { runSchedulePlayback } from "@/lib/schedule-playback-client";
import type { Playlist } from "@/lib/playlist-types";
import { ScheduleSegmentedToggle } from "@/components/schedule-segmented-toggle";
import { ScheduleBlockModal } from "@/components/schedule-block-modal";
import { useScheduleBlockAuto } from "@/lib/use-schedule-block-auto";
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

function formatWhen(schedule: Schedule, t: Record<string, string>) {
  if (schedule.recurrence === "one_off" && schedule.oneOffDateLocal) {
    return `${schedule.oneOffDateLocal} (${t.scheduleOneOff})`;
  }
  return formatDays(schedule.daysOfWeek, t);
}

function resolveTargetLabel(
  schedule: Schedule,
  source: Source | null,
  playlists: Playlist[],
  radios: { id: string; name: string }[],
  unknownLabel: string,
): string {
  const tid = (schedule.targetId || schedule.sourceId || "").trim();
  if (schedule.targetType === "SOURCE") {
    return source?.name ?? (tid || unknownLabel);
  }
  if (schedule.targetType === "PLAYLIST") {
    const p = playlists.find((x) => x.id === tid);
    return p?.name ?? tid;
  }
  if (schedule.targetType === "RADIO") {
    const r = radios.find((x) => x.id === tid);
    return r?.name ?? tid;
  }
  return tid;
}

type ScheduleCardProps = {
  schedule: Schedule;
  device: Device | null;
  source: Source | null;
  playlists: Playlist[];
  radioStations: { id: string; name: string }[];
};

export function ScheduleCard({ schedule, device, source, playlists, radioStations }: ScheduleCardProps) {
  const router = useRouter();
  const { t } = useTranslations();
  const { playSourceFromDb, setLastMessage, stop, setQueue, playSource } = usePlayback();
  const [deleting, setDeleting] = useState(false);
  const [playing, setPlaying] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const { autoPlaybackOff, setAutoPlaybackOff } = useScheduleBlockAuto(schedule.id);

  const targetLabel = resolveTargetLabel(schedule, source, playlists, radioStations, t.unknownSource);

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
    setPlaying(true);
    setLastMessage(null);
    try {
      await runSchedulePlayback(
        schedule,
        source,
        { stop, setQueue, playSource, playSourceFromDb, setLastMessage },
        router,
      );
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
            <span className="text-slate-300">{targetLabel}</span>
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-2 text-xs text-slate-500">
            <span>
              {schedule.startTimeLocal} – {schedule.endTimeLocal || "23:59"}
            </span>
            <span>{formatWhen(schedule, t)}</span>
            <span>{t.priority} {schedule.priority}</span>
          </div>
        </div>
        <div className="flex flex-col items-stretch gap-3 sm:items-end">
          <div className="flex flex-wrap items-center justify-end gap-3">
          <span
            className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium ${
              schedule.enabled
                ? "border-emerald-500/40 bg-emerald-950/40 text-emerald-300"
                : "border-red-500/45 bg-red-950/35 text-red-300/95"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                schedule.enabled
                  ? "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.9)]"
                  : "bg-red-400 shadow-[0_0_10px_rgba(248,113,113,0.85)]"
              }`}
            />
            {schedule.enabled ? t.enabled : t.disabled}
          </span>
          <ScheduleSegmentedToggle
            size="sm"
            value={!autoPlaybackOff}
            onChange={(v) => setAutoPlaybackOff(!v)}
            leftLabel={t.scheduleBlockSegmentPaused}
            rightLabel={t.scheduleBlockSegmentArmed}
            ariaLabel={t.scheduleBlockAutoShort}
          />
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-100 transition hover:bg-amber-500/20"
          >
            {t.edit}
          </button>
          <ActionButtonPlayNow
            variant="console"
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
      </div>
      <DeleteConfirmModal
        isOpen={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
        loading={deleting}
        message={t.deleteScheduleConfirm}
      />
      <ScheduleBlockModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={() => {
          setEditOpen(false);
          router.refresh();
        }}
        initialScheduleId={schedule.id}
      />
    </div>
  );
}
