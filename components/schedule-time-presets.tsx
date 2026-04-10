"use client";

import { useTranslations } from "@/lib/locale-context";
import { normalizeScheduleTimeLocal } from "@/lib/schedule-target-helpers";

const PRESETS = [
  { key: "morning" as const, hhmmss: "08:00:00" },
  { key: "noon" as const, hhmmss: "12:00:00" },
  { key: "afternoon" as const, hhmmss: "16:00:00" },
  { key: "evening" as const, hhmmss: "19:00:00" },
  { key: "night" as const, hhmmss: "21:00:00" },
];

type PresetKey = (typeof PRESETS)[number]["key"];

function matchesPreset(current: string, presetHhmmss: string): boolean {
  return normalizeScheduleTimeLocal(current) === normalizeScheduleTimeLocal(presetHhmmss);
}

/** Quick time presets above the start-time input; does not lock manual edits. */
export function ScheduleTimePresets({
  value,
  onPreset,
  className = "",
}: {
  value: string;
  onPreset: (hhmmss: string) => void;
  className?: string;
}) {
  const { t } = useTranslations();
  const labels: Record<PresetKey, string> = {
    morning: t.scheduleTimePresetMorning,
    noon: t.scheduleTimePresetNoon,
    afternoon: t.scheduleTimePresetAfternoon,
    evening: t.scheduleTimePresetEvening,
    night: t.scheduleTimePresetNight,
  };

  return (
    <div
      className={`flex flex-wrap gap-2 ${className}`}
      role="group"
      aria-label={t.scheduleTimePresetsAria}
    >
      {PRESETS.map((p) => {
        const active = matchesPreset(value, p.hhmmss);
        return (
          <button
            key={p.key}
            type="button"
            onClick={() => onPreset(p.hhmmss)}
            aria-pressed={active}
            className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white/35 ${
              active
                ? "border-white/35 bg-white/12 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
                : "border-slate-600/70 bg-slate-900/45 text-slate-300 hover:border-slate-500 hover:bg-slate-800/55 hover:text-slate-50"
            }`}
          >
            {labels[p.key]}
          </button>
        );
      })}
    </div>
  );
}
