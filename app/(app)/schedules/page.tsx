import { headers } from "next/headers";

import { getApiBase } from "@/lib/api-base";
import { getLocale } from "@/lib/locale-server";
import { getTranslations } from "@/lib/translations";
import type { Playlist } from "@/lib/playlist-types";
import type { Device, Schedule, Source } from "@/lib/types";
import { ScheduleCard } from "@/components/schedule-card";
import { SchedulesPageToolbar } from "@/components/schedules-page-toolbar";
import { ActionButtonNewSchedule } from "@/components/ui/action-buttons";

async function getData(): Promise<{
  schedules: Schedule[];
  devices: Device[];
  sources: Source[];
  playlists: Playlist[];
  radioStations: { id: string; name: string }[];
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
    const [schedulesRes, devicesRes, sourcesRes, playlistsRes, radioRes] = await Promise.all([
      authFetch("/api/schedules"),
      authFetch("/api/devices"),
      authFetch("/api/sources"),
      authFetch("/api/playlists"),
      authFetch("/api/radio"),
    ]);
    const [schedules, devices, sources, playlistsRaw, radioRaw] = (await Promise.all([
      schedulesRes.ok ? schedulesRes.json() : [],
      devicesRes.ok ? devicesRes.json() : [],
      sourcesRes.ok ? sourcesRes.json() : [],
      playlistsRes.ok ? playlistsRes.json() : [],
      radioRes.ok ? radioRes.json() : [],
    ])) as [Schedule[], Device[], Source[], unknown, unknown];
    const playlists = Array.isArray(playlistsRaw) ? (playlistsRaw as Playlist[]) : [];
    const radioStations = Array.isArray(radioRaw)
      ? (radioRaw as { id?: string; name?: string }[]).map((r) => ({
          id: String(r.id ?? ""),
          name: String(r.name ?? r.id ?? ""),
        }))
      : [];
    return {
      schedules: Array.isArray(schedules) ? schedules : [],
      devices: Array.isArray(devices) ? devices : [],
      sources: Array.isArray(sources) ? sources : [],
      playlists,
      radioStations,
    };
  } catch (e) {
    console.error("[schedules] getData error:", e);
    return { schedules: [], devices: [], sources: [], playlists: [], radioStations: [] };
  }
}

export default async function SchedulesPage() {
  const locale = await getLocale();
  const t = getTranslations(locale);
  const { schedules, devices, sources, playlists, radioStations } = await getData();

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-50">{t.schedules}</h1>
          <p className="mt-1 text-sm text-slate-400">
            {t.schedulesSubtitle}
          </p>
        </div>
        <SchedulesPageToolbar blockCount={schedules.length} />
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
            const sourceId = schedule.targetType === "SOURCE" ? schedule.targetId : schedule.sourceId;
            const source = sources.find((s) => s.id === (sourceId ?? schedule.sourceId)) ?? null;
            return (
              <ScheduleCard
                key={schedule.id}
                schedule={schedule}
                device={device}
                source={source}
                playlists={playlists}
                radioStations={radioStations}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
