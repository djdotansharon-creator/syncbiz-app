import { getApiBase } from "@/lib/api-base";
import { getLocale } from "@/lib/locale-server";
import { getTranslations } from "@/lib/translations";
import type { Device, Schedule, Source } from "@/lib/types";
import { ScheduleCard } from "@/components/schedule-card";
import { ActionButtonNewSchedule } from "@/components/ui/action-buttons";

async function getData() {
  const base = getApiBase();
  const [schedulesRes, devicesRes, sourcesRes] = await Promise.all([
    fetch(`${base}/api/schedules`, { cache: "no-store" }),
    fetch(`${base}/api/devices`, { cache: "no-store" }),
    fetch(`${base}/api/sources`, { cache: "no-store" }),
  ]);
  const [schedules, devices, sources] = (await Promise.all([
    schedulesRes.json(),
    devicesRes.json(),
    sourcesRes.json(),
  ])) as [Schedule[], Device[], Source[]];
  return { schedules, devices, sources };
}

export default async function SchedulesPage() {
  const locale = await getLocale();
  const t = getTranslations(locale);
  const { schedules, devices, sources } = await getData();

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-50">{t.schedules}</h1>
          <p className="mt-1 text-sm text-slate-400">
            {t.schedulesSubtitle}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-slate-700 bg-slate-900/60 px-3 py-1 text-xs text-slate-400">
            {schedules.length} {t.blocks}
          </span>
          <ActionButtonNewSchedule href="/schedules/new">
            {t.newSchedule}
          </ActionButtonNewSchedule>
        </div>
      </div>

      <div className="space-y-4">
        {schedules.length === 0 ? (
          <div className="rounded-2xl border border-slate-800/80 bg-slate-950/50 p-12 text-center">
            <p className="text-slate-400">{t.noScheduleBlocksYet}</p>
            <p className="mt-1 text-sm text-slate-500">
              {t.createBlockDescription}
            </p>
            <ActionButtonNewSchedule href="/schedules/new" className="mt-4 inline-block">
              {t.createFirstSchedule}
            </ActionButtonNewSchedule>
          </div>
        ) : (
          schedules.map((schedule) => {
            const device = devices.find((d) => d.id === schedule.deviceId) ?? null;
            const source = sources.find((s) => s.id === schedule.sourceId) ?? null;
            return (
              <ScheduleCard
                key={schedule.id}
                schedule={schedule}
                device={device}
                source={source}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
