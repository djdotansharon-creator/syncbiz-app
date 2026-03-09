"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PlayNowButton } from "@/components/playback-controls";
import { useTranslations } from "@/lib/locale-context";
import { usePlayback } from "@/lib/playback-context";
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
  const { playSource, setLastMessage } = usePlayback();
  const [deleting, setDeleting] = useState(false);
  const [playing, setPlaying] = useState(false);

  async function handleDelete() {
    if (!confirm(t.deleteScheduleConfirm)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/schedules/${schedule.id}`, {
        method: "DELETE",
      });
      if (res.ok) router.refresh();
    } finally {
      setDeleting(false);
    }
  }

  async function handlePlayNow() {
    if (!source) return;
    setPlaying(true);
    setLastMessage(null);
    try {
      playSource(source);
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
          <PlayNowButton
            onClick={handlePlayNow}
            disabled={playing}
            loading={playing}
            label={t.playNow}
            loadingLabel={t.sending}
          />
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="text-xs font-medium text-slate-400 hover:text-rose-400 disabled:opacity-50"
          >
            {deleting ? t.deleting : t.delete}
          </button>
        </div>
      </div>
    </div>
  );
}
