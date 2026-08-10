/**
 * Vertical slice: import ONE hashed M3U payload through the EXISTING Universal pipeline.
 * LOCAL syncbiz_dev only. NEVER touches a music file. NEVER stores an absolute path.
 * Reuses: syncLocalTrackFile (local-first mapping), buildUniversalPlaylist (Universal record),
 * searchYouTubeWithYtDlp (existing YouTube resolver), ProviderMapping (playback cache).
 * local stays PRIMARY on the bank machine; every track also gets a YouTube URL for remote clients.
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { desktopPayloadToNormalizedTracks, type DesktopM3uPayload, type DesktopPlaylistEntry } from "../lib/universal/desktop-m3u-payload";
import { buildUniversalPlaylist } from "../lib/universal/universal-playlist";
import { syncLocalTrackFile } from "../lib/universal/local-library-bridge";
import { searchYouTubeWithYtDlp } from "../lib/yt-dlp-search";

const PAYLOAD = "C:\\Users\\DOTAN-PC\\AppData\\Local\\Temp\\claude\\D--APP-Project-syncbiz-app\\0203139d-08bd-498e-9cf3-de9888d93b73\\scratchpad\\m3u-payload.json";
const DEVICE = "dev-local-bank";
const norm = (s: string) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

function assertLocalDev() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/@(localhost|127\.0\.0\.1)/.test(url) || !/dev/.test(url)) throw new Error("refuse: not local dev");
  if ((process.env.SYNCBIZ_ENV ?? "development") !== "development") throw new Error("refuse: SYNCBIZ_ENV must be development");
}

async function main() {
  assertLocalDev();
  const payload = JSON.parse(readFileSync(PAYLOAD, "utf8")) as DesktopM3uPayload;
  const prisma = new PrismaClient();
  try {
    // 1) LOCAL-FIRST: sync each local entry through the bridge → UniversalTrack + local ProviderMapping.
    let resolvedLocal = 0;
    const utidByPos = new Map<number, string>();
    for (const e of payload.entries as DesktopPlaylistEntry[]) {
      if (e.kind !== "local") continue;
      const r = await syncLocalTrackFile(prisma, {
        deviceId: DEVICE, localRef: e.localRef, filename: e.filename, durationMs: e.durationMs ?? undefined,
        availability: e.availability ?? "available", metadata: { title: e.title, artists: e.artists },
      }, { apply: true });
      if (r.universalTrackId) { utidByPos.set(e.position, r.universalTrackId); resolvedLocal++; }
    }

    // 2) Build the UniversalPlaylist record (order/names/artists preserved; locals now RESOLVED).
    const source = { name: payload.name, sourceProvider: "m3u", sourceType: "LOCAL_M3U" as const, sourceUrl: payload.name, sourceKey: payload.sourceKey, deviceId: DEVICE };
    const report = await buildUniversalPlaylist(prisma, source, desktopPayloadToNormalizedTracks(payload), { apply: true });

    // 3) Ensure a YouTube URL for EVERY entry (remote clients). Cache in ProviderMapping → no re-search.
    let resolvedYouTube = 0, mappingsSaved = 0, unresolved = 0;
    const templateItems: { name: string; url: string; position: number }[] = [];
    for (const e of payload.entries as DesktopPlaylistEntry[]) {
      const artist = e.artists?.[0] ?? "";
      const title = e.title ?? "";
      let utid = utidByPos.get(e.position) ?? null;

      // find-or-create a UniversalTrack so the YouTube mapping (and cache) has an owner.
      if (!utid) {
        const found = await prisma.universalTrack.findFirst({ where: { normalizedTitle: norm(title) } });
        utid = found?.id ?? (await prisma.universalTrack.create({ data: { normalizedTitle: norm(title), displayTitle: title, durationMs: e.durationMs ?? null } })).id;
      }

      let ytUrl: string | null = null;
      const existingYt = await prisma.providerMapping.findFirst({ where: { universalTrackId: utid, provider: "youtube" } });
      if (existingYt?.externalUrl) ytUrl = existingYt.externalUrl; // cache hit → NO re-search
      else {
        try {
          const res = await searchYouTubeWithYtDlp(`${artist} ${title}`.trim(), 3);
          const hit = res.find((r) => (r as { id?: string; url?: string }).id || (r as { url?: string }).url) as { id?: string; url?: string } | undefined;
          const videoId = hit?.id ?? (hit?.url?.match(/[?&]v=([^&]+)/)?.[1] ?? "");
          const url = hit?.url ?? (videoId ? `https://www.youtube.com/watch?v=${videoId}` : "");
          if (videoId && url) {
            await prisma.providerMapping.upsert({
              where: { provider_externalId: { provider: "youtube", externalId: videoId } },
              create: { provider: "youtube", externalId: videoId, externalUrl: url, universalTrackId: utid, playableStatus: "PLAYABLE", matchMethod: "safe_search", matchConfidence: 0.9, lastVerifiedAt: new Date() },
              update: { externalUrl: url, universalTrackId: utid, playableStatus: "PLAYABLE", lastVerifiedAt: new Date() },
            });
            ytUrl = url; mappingsSaved++;
          }
        } catch { /* leave unresolved */ }
      }
      if (ytUrl) { resolvedYouTube++; templateItems.push({ name: [artist, title].filter(Boolean).join(" — ") || title, url: ytUrl, position: e.position }); }
      else if (!utidByPos.has(e.position)) unresolved++;
    }

    // 4) Materialize an ADMIN TEMPLATE (http URLs only — never a local path) for DJ Creator top-up.
    const ws = await prisma.workspace.findFirstOrThrow({ where: { slug: "universal-validation" } });
    await prisma.playlist.deleteMany({ where: { workspaceId: ws.id, name: payload.name, publicationScope: "TEMPLATE" } });
    const tpl = await prisma.playlist.create({
      data: {
        workspaceId: ws.id, name: payload.name, genre: "Imported M3U", playlistType: "youtube", publicationScope: "TEMPLATE",
        primaryGenre: "Imported", useCases: ["restaurant", "cafe", "bar", "evening", "dinner"], mood: "Mixed",
        url: templateItems[0]?.url ?? "",
        items: { create: [...templateItems].sort((a, b) => a.position - b.position).map((t, i) => ({ name: t.name, url: t.url, trackType: "youtube", position: i })) },
      },
      include: { items: true },
    });

    // 5) Absolute-path audit across everything persisted.
    const utids = [...utidByPos.values()];
    const dump = JSON.stringify([
      await prisma.universalPlaylistItem.findMany({ where: { playlistId: report.playlistId! } }),
      await prisma.providerMapping.findMany({ where: { OR: [{ universalTrackId: { in: utids } }, { externalId: { startsWith: "loc_" } }] } }),
      tpl,
    ]);
    const absPathLeak = /[A-Za-z]:\\|\\\\[^"]/.test(dump);

    console.log(JSON.stringify({
      m3uImported: payload.name, tracksIngested: payload.entries.length,
      resolvedLocal, resolvedYouTube, providerMappingsSaved: mappingsSaved, unresolved,
      templateId: tpl.id, templatePlayableItems: tpl.items.filter((i) => /^https?:\/\//.test(i.url)).length,
      absolutePathLeak: absPathLeak, musicFilesModified: 0,
      universalPlaylistStatus: { RESOLVED: report.resolved, PROVIDER_RESOLVED: report.providerResolved, AMBIGUOUS: report.ambiguous, UNRESOLVED: report.unresolved, MISSING: report.missing },
    }, null, 2));
  } finally { await prisma.$disconnect(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
