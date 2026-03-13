import Link from "next/link";
import { getApiBase } from "@/lib/api-base";
import { getLocale } from "@/lib/locale-server";
import { getTranslations } from "@/lib/translations";
import type { Device, Source } from "@/lib/types";
import { ScheduleForm } from "./schedule-form";

async function getData(): Promise<{ devices: Device[]; sources: Source[] }> {
  try {
    const base = getApiBase();
    const [devicesRes, sourcesRes] = await Promise.all([
      fetch(`${base}/api/devices`, { cache: "no-store" }),
      fetch(`${base}/api/sources`, { cache: "no-store" }),
    ]);
    const [devices, sources] = (await Promise.all([
      devicesRes.ok ? devicesRes.json() : [],
      sourcesRes.ok ? sourcesRes.json() : [],
    ])) as [Device[], Source[]];
    return {
      devices: Array.isArray(devices) ? devices : [],
      sources: Array.isArray(sources) ? sources : [],
    };
  } catch (e) {
    console.error("[schedules/new] getData error:", e);
    return { devices: [], sources: [] };
  }
}

const DAYS = [
  { value: 0, labelKey: "sun" as const },
  { value: 1, labelKey: "mon" as const },
  { value: 2, labelKey: "tue" as const },
  { value: 3, labelKey: "wed" as const },
  { value: 4, labelKey: "thu" as const },
  { value: 5, labelKey: "fri" as const },
  { value: 6, labelKey: "sat" as const },
];

export default async function NewSchedulePage() {
  const locale = await getLocale();
  const t = getTranslations(locale);
  const { devices, sources } = await getData();
  const daysOptions = DAYS.map((d) => ({ value: d.value, label: t[d.labelKey] }));

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs text-slate-500">
          <Link href="/schedules" className="hover:text-sky-400">
            {t.schedulesBreadcrumb}
          </Link>
          {" / "}
          {t.newBreadcrumb}
        </p>
        <h1 className="mt-1 text-xl font-semibold text-slate-50">
          {t.newScheduleBlock}
        </h1>
        <p className="text-sm text-slate-400">
          {t.newScheduleDescription}
        </p>
      </div>

      <ScheduleForm
        devices={devices}
        sources={sources}
        daysOptions={daysOptions}
      />
    </div>
  );
}
