"use client";

import { ScheduleSegmentedToggle } from "@/components/schedule-segmented-toggle";
import { useScheduleEngine } from "@/lib/schedule-engine-context";
import { useTranslations } from "@/lib/locale-context";

/** Global scheduled auto-play — segmented control (same language as MASTER/CONTROL + locale switch). */
export function ScheduleEngineToggle() {
  const { engineEnabled, setEngineEnabled } = useScheduleEngine();
  const { t } = useTranslations();

  return (
    <div className="flex flex-col gap-2 sm:items-end">
      <label className="block text-xs font-medium text-slate-500 sm:text-end">{t.scheduleEngineLabel}</label>
      <ScheduleSegmentedToggle
        value={engineEnabled}
        onChange={setEngineEnabled}
        leftLabel={t.scheduleEngineSegmentOff}
        rightLabel={t.scheduleEngineSegmentOn}
        ariaLabel={t.scheduleEngineLabel}
      />
      <p className="max-w-md text-[11px] leading-snug text-slate-500 sm:text-end">{t.scheduleEngineHint}</p>
    </div>
  );
}
