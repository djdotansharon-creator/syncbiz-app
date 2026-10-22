import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";
import { ISRAELI_RADIO_PRESETS, isIsraelCountry, matchPreset } from "@/lib/radio-presets-il";

export const dynamic = "force-dynamic";

const RADIO_BROWSER_HOSTS = ["https://de1.api.radio-browser.info", "https://all.api.radio-browser.info"];
const DIRECTORY_TTL_MS = 6 * 60 * 60 * 1000;

type DirectoryStation = Parameters<typeof matchPreset>[1][number];

let directoryCache: { at: number; stations: DirectoryStation[] } | null = null;

/** Israeli stations from the Radio Browser directory — one request, cached per process for 6 hours. */
async function israeliDirectory(): Promise<DirectoryStation[]> {
  if (directoryCache && Date.now() - directoryCache.at < DIRECTORY_TTL_MS) return directoryCache.stations;
  for (const host of RADIO_BROWSER_HOSTS) {
    try {
      const res = await fetch(
        `${host}/json/stations/bycountrycodeexact/IL?hidebroken=true&order=votes&reverse=true&limit=500`,
        { headers: { "User-Agent": "VONO/1.0" }, signal: AbortSignal.timeout(8000) },
      );
      if (!res.ok) continue;
      const stations = (await res.json()) as DirectoryStation[];
      if (!Array.isArray(stations)) continue;
      directoryCache = { at: Date.now(), stations };
      return stations;
    } catch (e) {
      console.warn("[api/radio/presets] Radio Browser request failed:", host, e);
    }
  }
  return directoryCache?.stations ?? [];
}

async function workspaceIsInIsrael(workspaceId: string): Promise<boolean> {
  const profile = await prisma.workspaceBusinessProfile.findUnique({
    where: { workspaceId },
    select: { countryCode: true },
  });
  if (profile?.countryCode?.trim()) return isIsraelCountry(profile.countryCode);
  const branches = await prisma.branch.findMany({ where: { workspaceId }, select: { country: true } });
  return branches.some((b) => isIsraelCountry(b.country));
}

/**
 * GET — the default Israeli radio stations with their current stream URLs, for workspaces in
 * Israel only (business profile country, else a branch in Israel). Other workspaces get an
 * empty list. Read-only: nothing is stored until a user adds or plays a station.
 */
export async function GET() {
  const user = await getCurrentUserFromCookies();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!(await workspaceIsInIsrael(user.tenantId))) {
    return NextResponse.json({ country: null, stations: [] });
  }

  const directory = await israeliDirectory();
  const stations = ISRAELI_RADIO_PRESETS.flatMap((preset) => {
    const hit = matchPreset(preset, directory);
    const url = hit?.url_resolved || hit?.url;
    if (!url) return [];
    return [{
      key: preset.key,
      name: preset.name,
      genre: preset.genre,
      url,
      cover: hit?.favicon || null,
      directoryName: hit?.name ?? null,
    }];
  });

  return NextResponse.json({ country: "IL", stations });
}
