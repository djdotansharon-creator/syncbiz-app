"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ActionButtonPlayNow, ActionButtonDelete } from "@/components/ui/action-buttons";
import { DeleteConfirmModal } from "@/components/delete-confirm-modal";
import { useTranslations } from "@/lib/locale-context";
import { runSchedulePlayback } from "@/lib/schedule-playback-client";
import { useSchedulePlaybackHandlers } from "@/lib/use-schedule-playback-handlers";
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
  const { setLastMessage, stop, setQueue, playSource } = useSchedulePlaybackHandlers();
  const [deleting, setDeleting] = useState(false);
  const [playing, setPlaying] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const { autoPlaybackOff, setAutoPlaybackOff } = useScheduleBlockAuto(schedule.id);

  const targetLabel = resolveTargetLabel(schedule, source, playlists, radioStations, t.unknownSource);

  async function handleDelete() {
    setDeleteError(null);
    setDeleting(true);
    try {
      const id = (schedule.id ?? "").trim();
      if (!id) throw new Error("Missing schedule id");
      const res = await fetch(`/api/schedules/${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        if (res.status === 404) {
          try {
            if (typeof localStorage !== "undefined") {
              for (let i = localStorage.length - 1; i >= 0; i--) {
                const k = localStorage.key(i);
                if (k?.startsWith(`syncbiz-schedule-auto-${id}-`)) localStorage.removeItem(k);
              }
            }
          } catch {
            /* ignore */
          }
          router.refresh();
          return;
        }
        throw new Error(data.error ?? `Delete failed (${res.status})`);
      }
      try {
        if (typeof localStorage !== "undefined") {
          for (let i = localStorage.length - 1; i >= 0; i--) {
            const k = localStorage.key(i);
            if (k?.startsWith(`syncbiz-schedule-auto-${id}-`)) localStorage.removeItem(k);
          }
        }
      } catch {
        /* ignore */
      }
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Delete failed";
      setDeleteError(msg);
      throw e;
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
        { stop, setQueue, playSource, setLastMessage },
        router,
      );
      router.refresh();
    } finally {
      setPlaying(false);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-800/80 bg-slate-950/50 p-4 transition hover:border-slate-700/80">
      {/*
        Desktop: [ OFF | ON ] — [ title / meta ] — [ Edit · Play · Delete ], all vertically centered.
        Mobile: title block first, then one row: toggle left, action buttons right.
      */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-4 lg:gap-6">
        <div className="order-1 min-w-0 flex-1 space-y-1 sm:order-2">
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
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-slate-700/70 bg-slate-900/55 px-3 py-2.5 text-sm tabular-nums text-slate-100">
            <span className="font-medium text-amber-100/95">
              {schedule.startTimeLocal}
            </span>
            <span className="text-slate-200">{formatWhen(schedule, t)}</span>
            <span className="text-slate-400">
              {t.priority} <span className="font-semibold text-slate-200">{schedule.priority}</span>
            </span>
          </div>
        </div>
        <div className="order-2 flex items-center justify-between gap-3 sm:contents">
          <div className="shrink-0 sm:order-1">
            <ScheduleSegmentedToggle
              size="xs"
              value={!autoPlaybackOff}
              onChange={(v) => setAutoPlaybackOff(!v)}
              leftLabel={t.scheduleEngineSegmentOff}
              rightLabel={t.scheduleEngineSegmentOn}
              ariaLabel={t.schedulePerBlockAutoAria}
            />
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-3 sm:order-3">
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
              onClick={() => {
                setDeleteError(null);
                setDeleteOpen(true);
              }}
              disabled={deleting}
              title={t.delete}
              aria-label={t.delete}
            />
          </div>
        </div>
      </div>
      <DeleteConfirmModal
        isOpen={deleteOpen}
        onClose={() => {
          setDeleteError(null);
          setDeleteOpen(false);
        }}
        onConfirm={handleDelete}
        loading={deleting}
        message={t.deleteScheduleConfirm}
        errorHint={deleteError}
      />
      <ScheduleBlockModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={() => {
          setEditOpen(false);
          router.refresh();
        }}
        initialScheduleId={(schedule.id ?? "").trim() || undefined}
      />
    </div>
  );
}
