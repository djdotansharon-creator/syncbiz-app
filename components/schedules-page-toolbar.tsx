"use client";

import { ActionButtonNewSchedule } from "@/components/ui/action-buttons";
import { ScheduleEngineToggle } from "@/components/schedule-engine-toggle";
import { useTranslations } from "@/lib/locale-context";

export function SchedulesPageToolbar({ blockCount }: { blockCount: number }) {
  const { t } = useTranslations();

  return (
    <div className="flex w-full flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <ScheduleEngineToggle />
      <div className="flex flex-wrap items-center gap-3 lg:justify-end">
        <div className="flex items-baseline gap-1.5 border-b border-transparent text-sm tabular-nums text-slate-500">
          <span className="text-lg font-semibold text-slate-200">{blockCount}</span>
          <span className="text-slate-500">{t.blocks}</span>
        </div>
        <ActionButtonNewSchedule href="/schedules/new">{t.newSchedule}</ActionButtonNewSchedule>
      </div>
    </div>
  );
}
