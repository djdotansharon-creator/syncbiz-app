"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ScheduleDayLedButton } from "@/components/schedule-block-modal";
import { useTranslations } from "@/lib/locale-context";
import type { Device, Source } from "@/lib/types";

type DayOption = { value: number; label: string };

type ScheduleFormProps = {
  devices: Device[];
  sources: Source[];
  daysOptions: DayOption[];
};

export function ScheduleForm({
  devices,
  sources,
  daysOptions,
}: ScheduleFormProps) {
  const router = useRouter();
  const { t } = useTranslations();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [recurrence, setRecurrence] = useState<"weekly" | "one_off">("weekly");
  const [oneOffDate, setOneOffDate] = useState("");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]); // default weekdays

  function toggleDay(d: number) {
    setDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b),
    );
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaveError(null);
    setSaving(true);
    const form = e.currentTarget;
    const formData = new FormData(form);
    const sourceId = formData.get("sourceId") as string;
    const sourceObj = sources.find((s) => s.id === sourceId);
    const branchId = (sourceObj?.branchId ?? "default").trim() || "default";
    const body = {
      name: formData.get("name") as string,
      branchId,
      targetType: "SOURCE" as const,
      targetId: sourceId,
      sourceId,
      deviceId: (formData.get("deviceId") as string) || undefined,
      recurrence,
      daysOfWeek: recurrence === "weekly" ? days : [],
      oneOffDateLocal: recurrence === "one_off" ? oneOffDate : undefined,
      startTimeLocal: formData.get("startTime") as string,
      endTimeLocal: (formData.get("endTime") as string) || undefined,
      enabled: true,
      priority: 1,
    };
    try {
      const res = await fetch("/api/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (res.ok) {
        router.push("/schedules");
        router.refresh();
        return;
      }
      const errBody = (await res.json().catch(() => ({}))) as { error?: string };
      setSaveError(errBody.error ?? `Request failed (${res.status})`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="max-w-xl space-y-6 rounded-2xl border border-slate-800/80 bg-slate-950/50 p-5"
    >
      <div>
        <label
          htmlFor="name"
          className="block text-xs font-medium text-slate-400"
        >
          {t.scheduleName}
        </label>
        <input
          id="name"
          name="name"
          required
          placeholder={t.placeholderMorningPlaylist}
          className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5 text-sm text-slate-50 placeholder:text-slate-500 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/30"
        />
      </div>

      <div>
        <label
          htmlFor="deviceId"
          className="block text-xs font-medium text-slate-400"
        >
          {t.device}
        </label>
        <select
          id="deviceId"
          name="deviceId"
          className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5 text-sm text-slate-50 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/30"
        >
          <option value="">{t.anyCompatibleDevice}</option>
          {devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} ({d.platform})
            </option>
          ))}
        </select>
      </div>

      <div>
        <label
          htmlFor="sourceId"
          className="block text-xs font-medium text-slate-400"
        >
          {t.playbackTargetSource}
        </label>
        <select
          id="sourceId"
          name="sourceId"
          required
          className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5 text-sm text-slate-50 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/30"
        >
          <option value="">{t.selectSource}</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.type})
            </option>
          ))}
        </select>
      </div>

      <div>
        <p className="block text-xs font-medium text-slate-400">{t.scheduleRecurrence}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setRecurrence("weekly")}
            className={`rounded-lg border px-3 py-2 text-xs font-medium ${
              recurrence === "weekly"
                ? "border-amber-500/45 bg-amber-500/10 text-amber-100"
                : "border-slate-800 bg-slate-900/50 text-slate-300"
            }`}
          >
            {t.scheduleWeekly}
          </button>
          <button
            type="button"
            onClick={() => setRecurrence("one_off")}
            className={`rounded-lg border px-3 py-2 text-xs font-medium ${
              recurrence === "one_off"
                ? "border-amber-500/45 bg-amber-500/10 text-amber-100"
                : "border-slate-800 bg-slate-900/50 text-slate-300"
            }`}
          >
            {t.scheduleOneOff}
          </button>
        </div>
      </div>

      {recurrence === "one_off" ? (
        <div>
          <label htmlFor="oneOffDate" className="block text-xs font-medium text-slate-400">
            {t.scheduleOneOffDateLabel}
          </label>
          <input
            id="oneOffDate"
            type="date"
            required
            value={oneOffDate}
            onChange={(e) => setOneOffDate(e.target.value)}
            className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5 text-sm text-slate-50 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/30"
          />
          <p className="mt-2 text-[11px] text-slate-500">{t.scheduleHintOneOff}</p>
        </div>
      ) : (
      <div>
        <p className="block text-xs font-medium text-slate-400">{t.days}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {daysOptions.map(({ value, label }) => (
            <ScheduleDayLedButton
              key={value}
              label={label}
              on={days.includes(value)}
              onToggle={() => toggleDay(value)}
            />
          ))}
        </div>
      </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="startTime"
            className="block text-xs font-medium text-slate-400"
          >
            {t.startTime}
          </label>
          <input
            id="startTime"
            name="startTime"
            type="time"
            required
            defaultValue="08:00"
            className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5 text-sm text-slate-50 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/30"
          />
        </div>
        <div>
          <label
            htmlFor="endTime"
            className="block text-xs font-medium text-slate-400"
          >
            {t.endTimeOptional}
          </label>
          <input
            id="endTime"
            name="endTime"
            type="time"
            placeholder={t.leaveEmptyAllDay}
            className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5 text-sm text-slate-50 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/30"
          />
        </div>
      </div>

      {saveError ? (
        <p className="text-sm text-rose-400/95" role="alert">
          {saveError}
        </p>
      ) : null}

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={saving || (recurrence === "weekly" && days.length === 0) || (recurrence === "one_off" && !oneOffDate)}
          className="rounded-xl border border-amber-500/45 bg-amber-500/15 px-4 py-2.5 text-sm font-semibold text-amber-100 shadow-[0_0_24px_rgba(245,158,11,0.12)] transition hover:bg-amber-500/25 disabled:opacity-60"
        >
          {saving ? t.saving : t.saveSchedule}
        </button>
        <Link
          href="/schedules"
          className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-slate-800/60"
        >
          {t.cancel}
        </Link>
      </div>
    </form>
  );
}
