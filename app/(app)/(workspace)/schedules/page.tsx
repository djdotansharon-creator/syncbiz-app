import { headers } from "next/headers";

import { getApiBase } from "@/lib/api-base";

/** Lists must refetch after DELETE/POST/PATCH — avoid stale RSC cache. */
export const dynamic = "force-dynamic";
import type { Playlist } from "@/lib/playlist-types";
import type { Device, Schedule, Source } from "@/lib/types";
import { SchedulesStudio } from "@/components/schedules-studio/schedules-studio";

async function getData(): Promise<{
  schedules: Schedule[];
  devices: Device[];
  sources: Source[];
  playlists: Playlist[];
  radioStations: { id: string; name: string }[];
  branches: { id: string; name: string }[];
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
    const [schedulesRes, devicesRes, sourcesRes, playlistsRes, radioRes, branchesRes] = await Promise.all([
      authFetch("/api/schedules"),
      authFetch("/api/devices"),
      authFetch("/api/sources"),
      authFetch("/api/playlists"),
      authFetch("/api/radio"),
      authFetch("/api/branches"),
    ]);
    const [schedules, devices, sources, playlistsRaw, radioRaw, branchesRaw] = (await Promise.all([
      schedulesRes.ok ? schedulesRes.json() : [],
      devicesRes.ok ? devicesRes.json() : [],
      sourcesRes.ok ? sourcesRes.json() : [],
      playlistsRes.ok ? playlistsRes.json() : [],
      radioRes.ok ? radioRes.json() : [],
      branchesRes.ok ? branchesRes.json() : [],
    ])) as [Schedule[], Device[], Source[], unknown, unknown, unknown];
    const playlists = Array.isArray(playlistsRaw) ? (playlistsRaw as Playlist[]) : [];
    const radioStations = Array.isArray(radioRaw)
      ? (radioRaw as { id?: string; name?: string }[]).map((r) => ({
          id: String(r.id ?? ""),
          name: String(r.name ?? r.id ?? ""),
        }))
      : [];
    const branches = Array.isArray(branchesRaw)
      ? (branchesRaw as { id?: string; name?: string }[]).map((b) => ({ id: String(b.id ?? ""), name: String(b.name ?? b.id ?? "") })).filter((b) => b.id)
      : [];
    return {
      schedules: Array.isArray(schedules) ? schedules : [],
      devices: Array.isArray(devices) ? devices : [],
      sources: Array.isArray(sources) ? sources : [],
      playlists,
      radioStations,
      branches,
    };
  } catch (e) {
    console.error("[schedules] getData error:", e);
    return { schedules: [], devices: [], sources: [], playlists: [], radioStations: [], branches: [] };
  }
}

export default async function SchedulesPage() {
  const { schedules, devices, sources, playlists, radioStations, branches } = await getData();
  // Schedules Studio (owner 2026-11-10): the whole screen is one calendar of what plays when, with the owner's music on the side
  return (
    <SchedulesStudio
      initialSchedules={schedules}
      playlists={playlists}
      sources={sources}
      radioStations={radioStations}
      devices={devices}
      branches={branches}
    />
  );
}
