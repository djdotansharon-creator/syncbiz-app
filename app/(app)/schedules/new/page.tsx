import Link from "next/link";
import { headers } from "next/headers";

import { getApiBase } from "@/lib/api-base";
import { getLocale } from "@/lib/locale-server";
import { getTranslations } from "@/lib/translations";
import type { Playlist } from "@/lib/playlist-types";
import type { Device, Source } from "@/lib/types";
import { ScheduleForm } from "./schedule-form";

async function getData(): Promise<{
  devices: Device[];
  sources: Source[];
  playlists: Playlist[];
  radioStations: { id: string; name: string; branchId?: string | null }[];
}> {
  try {
    const base = getApiBase();
    const h = await headers();
    const cookie = h.get("cookie");
    const authFetch = (path: string) =>
      fetch(`${base}${path}`, {
        cache: "no-store",
        ...(cookie ? { headers: { cookie } } : {}),
      });
    const [devicesRes, sourcesRes, playlistsRes, radioRes] = await Promise.all([
      authFetch("/api/devices"),
      authFetch("/api/sources"),
      authFetch("/api/playlists"),
      authFetch("/api/radio"),
    ]);
    const [devices, sources, playlistsRaw, radioRaw] = (await Promise.all([
      devicesRes.ok ? devicesRes.json() : [],
      sourcesRes.ok ? sourcesRes.json() : [],
      playlistsRes.ok ? playlistsRes.json() : [],
      radioRes.ok ? radioRes.json() : [],
    ])) as [Device[], Source[], unknown, unknown];
    const playlists = Array.isArray(playlistsRaw) ? (playlistsRaw as Playlist[]) : [];
    const radioArr = Array.isArray(radioRaw) ? radioRaw : [];
    const radioStations = radioArr.map((r: { id?: string; name?: string; branchId?: string | null }) => ({
      id: String(r.id ?? ""),
      name: String(r.name ?? r.id ?? ""),
      branchId: r.branchId,
    }));
    return {
      devices: Array.isArray(devices) ? devices : [],
      sources: Array.isArray(sources) ? sources : [],
      playlists,
      radioStations,
    };
  } catch (e) {
    console.error("[schedules/new] getData error:", e);
    return { devices: [], sources: [], playlists: [], radioStations: [] };
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
  const { devices, sources, playlists, radioStations } = await getData();
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
        playlists={playlists}
        radioStations={radioStations}
        daysOptions={daysOptions}
      />
    </div>
  );
}
