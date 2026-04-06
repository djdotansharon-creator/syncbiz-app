"use client";

import { ActionButtonNewSchedule } from "@/components/ui/action-buttons";
import { ScheduleSegmentedToggle } from "@/components/schedule-segmented-toggle";
import { useScheduleEngine } from "@/lib/schedule-engine-context";
import { useTranslations } from "@/lib/locale-context";

/** One toolbar strip: auto-play OFF|ON aligns with blocks + New schedule; hint spans below. */
export function SchedulesPageToolbar({ blockCount }: { blockCount: number }) {
  const { engineEnabled, setEngineEnabled } = useScheduleEngine();
  const { t } = useTranslations();

  return (
    <div className="space-y-2.5 border-b border-slate-800/50 pb-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <span className="shrink-0 text-[10px] font-medium text-slate-500">{t.scheduleEngineLabel}</span>
          <ScheduleSegmentedToggle
            size="xs"
            value={engineEnabled}
            onChange={setEngineEnabled}
            leftLabel={t.scheduleEngineSegmentOff}
            rightLabel={t.scheduleEngineSegmentOn}
            ariaLabel={t.scheduleEngineLabel}
          />
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
          <div className="flex items-baseline gap-1 tabular-nums text-xs text-slate-500">
            <span className="text-sm font-semibold text-slate-200">{blockCount}</span>
            <span>{t.blocks}</span>
          </div>
          <ActionButtonNewSchedule href="/schedules/new" className="!h-7 !px-2.5 !py-0.5 !text-[10px]">
            {t.newSchedule}
          </ActionButtonNewSchedule>
        </div>
      </div>
      <p className="max-w-3xl text-[11px] leading-relaxed text-slate-500">{t.scheduleEngineHint}</p>
    </div>
  );
}
