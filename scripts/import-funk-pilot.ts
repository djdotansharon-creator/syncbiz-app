/**
 * FUNK pilot import — LOCAL syncbiz_dev only. Reuses the hashed Universal pipeline.
 * Treats the M3U as a SELECTION POOL (order kept for provenance only; selectionMode=POOL_RANDOM).
 * local-first (bridge ProviderMapping); YouTube resolved ONLY when a playable mapping is missing,
 * and the found URL is cached in ProviderMapping for reuse. NEVER touches a music file / stores a path.
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { desktopPayloadToNormalizedTracks, type DesktopM3uPayload, type DesktopPlaylistEntry } from "../lib/universal/desktop-m3u-payload";
import { buildUniversalPlaylist } from "../lib/universal/universal-playlist";
import { syncLocalTrackFile } from "../lib/universal/local-library-bridge";
import { searchYouTubeWithYtDlp } from "../lib/yt-dlp-search";
import { ensureUniversalTrackId } from "../lib/universal/ensure-universal-track";

const PAYLOAD = "C:\\Users\\DOTAN-PC\\AppData\\Local\\Temp\\claude\\D--APP-Project-syncbiz-app\\0203139d-08bd-498e-9cf3-de9888d93b73\\scratchpad\\funk-payload.json";
const DEVICE = "dev-local-bank";
const SOURCE_RULE = 'genre HAS "FUNK" AND genre HAS "Easy" AND comment HAS "SELECTED"';

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
    // 1) LOCAL-FIRST via the bridge → UniversalTrack + local ProviderMapping.
    let resolvedLocal = 0;
    const utidByPos = new Map<number, string>();
    for (const e of payload.entries as DesktopPlaylistEntry[]) {
      if (e.kind !== "local") continue;
      const r = await syncLocalTrackFile(prisma, {
        deviceId: DEVICE, localRef: e.localRef, filename: e.filename, durationMs: e.durationMs ?? undefined,
        availability: e.availability ?? "available", metadata: { title: e.title, artists: e.artists },
      }, { apply: true });
      if (r.universalTrackId) { utidByPos.set(e.position, r.universalTrackId); if (e.availability !== "missing") resolvedLocal++; }
    }

    // 2) UniversalPlaylist record (provenance).
    const source = { name: payload.name, sourceProvider: "m3u", sourceType: "LOCAL_M3U" as const, sourceUrl: payload.name, sourceKey: payload.sourceKey, deviceId: DEVICE };
    const report = await buildUniversalPlaylist(prisma, source, desktopPayloadToNormalizedTracks(payload), { apply: true });

    // 3) YouTube ONLY when a playable ProviderMapping is missing; cache the found URL for reuse.
    let resolvedYouTube = 0, mappingsSaved = 0, reusedExisting = 0, unresolved = 0;
    const templateItems: { name: string; url: string; position: number }[] = [];
    for (const e of payload.entries as DesktopPlaylistEntry[]) {
      const artist = e.artists?.[0] ?? "";
      const title = e.title ?? "";
      let utid = utidByPos.get(e.position) ?? null;
      if (!utid) {
        // Single identity path — no strong id available here → a NEW Recording (never merge by title).
        utid = (await ensureUniversalTrackId(prisma, { title, durationMs: e.durationMs ?? null })).universalTrackId;
      }
      let ytUrl: string | null = null;
      const existingYt = await prisma.providerMapping.findFirst({ where: { universalTrackId: utid, provider: "youtube", playableStatus: "PLAYABLE" } });
      if (existingYt?.externalUrl) { ytUrl = existingYt.externalUrl; reusedExisting++; } // reuse — no new search
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
      else unresolved++;
    }

    // 4) Materialize the SELECTION-POOL TEMPLATE (http URLs only). genre=FUNK, energy/style=Easy, POOL_RANDOM.
    const ws = await prisma.workspace.findFirstOrThrow({ where: { slug: "universal-validation" } });
    await prisma.playlist.deleteMany({ where: { workspaceId: ws.id, name: payload.name, publicationScope: "TEMPLATE" } });
    const tpl = await prisma.playlist.create({
      data: {
        workspaceId: ws.id, name: payload.name, genre: "FUNK", playlistType: "youtube", publicationScope: "TEMPLATE",
        primaryGenre: "FUNK", subGenres: ["funk"], mood: "Easy", energyLevel: "Easy", useCases: [],
        description: "Smart selection pool — FUNK / Easy / SELECTED. Random selection; order is provenance only.",
        adminNotes: JSON.stringify({ selectionMode: "POOL_RANDOM", sourceRule: SOURCE_RULE, importedFrom: "FUNK - Easy [SELECTED].m3u" }),
        url: templateItems[0]?.url ?? "",
        items: { create: [...templateItems].sort((a, b) => a.position - b.position).map((t, i) => ({ name: t.name, url: t.url, trackType: "youtube", position: i })) },
      },
      include: { items: true },
    });

    // 5) Absolute-path audit.
    const utids = [...utidByPos.values()];
    const dump = JSON.stringify([
      await prisma.universalPlaylistItem.findMany({ where: { playlistId: report.playlistId! } }),
      await prisma.providerMapping.findMany({ where: { OR: [{ universalTrackId: { in: utids } }, { externalId: { startsWith: "loc_" } }] } }),
      tpl,
    ]);
    const absPathLeak = /[A-Za-z]:\\|\\\\[^"]/.test(dump);

    console.log(JSON.stringify({
      imported: payload.name, sourceRule: SOURCE_RULE, selectionMode: "POOL_RANDOM",
      tracksIngested: payload.entries.length, resolvedLocal, missing: (payload.entries as DesktopPlaylistEntry[]).filter((e) => e.kind === "local" && e.availability === "missing").length,
      resolvedYouTube, providerMappingsSaved: mappingsSaved, reusedExistingYouTube: reusedExisting, unresolved,
      templateId: tpl.id, templateGenre: tpl.genre, templateEnergy: tpl.energyLevel, templatePlayableItems: tpl.items.filter((i) => /^https?:\/\//.test(i.url)).length,
      absolutePathLeak: absPathLeak, musicFilesModified: 0,
    }, null, 2));
  } finally { await prisma.$disconnect(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
