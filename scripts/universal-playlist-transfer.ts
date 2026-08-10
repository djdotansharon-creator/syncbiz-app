/**
 * Phase C MVP — Universal Playlist Transfer (LOCAL only).
 *
 *   npx tsx scripts/universal-playlist-transfer.ts --source=m3u --file=fixtures/universal-playlist/seed-mix.m3u
 *   --source=youtube --file=fixtures/universal-playlist/youtube-playlist.sample.json
 *   --source=desktop-m3u --file=fixtures/universal-playlist/desktop-m3u-payload.sample.json
 *   ... --apply            # persist the UniversalPlaylist
 *   ... --apply --write     # + materialize into a SyncBiz Playlist
 *   ... --apply --write --fallback   # + enable the safe Spotify-only → YouTube fallback (fixture)
 *
 * Guarded to development/localhost/syncbiz_dev. Dry-run by default. Prints target first.
 */

import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { assertSafeIngestionTarget } from "@/lib/universal/ingestion-env-guard";
import { parseM3uText } from "@/lib/universal/m3u-tracklist";
import { youtubeReader } from "@/lib/universal/readers/youtube-reader";
import { desktopPayloadToNormalizedTracks, type DesktopM3uPayload } from "@/lib/universal/desktop-m3u-payload";
import { buildUniversalPlaylist, type UniversalPlaylistSource } from "@/lib/universal/universal-playlist";
import { SyncBizPlaylistWriter } from "@/lib/universal/playlist-writer";
import type { YouTubeCandidateProvider } from "@/lib/universal/youtube-fallback";
import type { YouTubeSearchResult } from "@/lib/search-service";
import type { NormalizedTrack } from "@/lib/universal/universal-track";

function parseArgs(argv: string[]) {
  const flags = new Set<string>();
  const opts: Record<string, string> = {};
  for (const a of argv) {
    if (!a.startsWith("--")) continue;
    const [k, v] = a.slice(2).split("=");
    if (v === undefined) flags.add(k);
    else opts[k] = v;
  }
  return { flags, opts };
}

async function ensureValidationWorkspace(prisma: PrismaClient): Promise<string> {
  const email = "universal-validation@syncbiz.local";
  const user = await prisma.user.upsert({ where: { email }, update: {}, create: { email, name: "Universal Validation" }, select: { id: true } });
  const slug = "universal-validation";
  const ws = await prisma.workspace.upsert({ where: { slug }, update: {}, create: { name: "Universal Validation WS", slug, ownerId: user.id }, select: { id: true } });
  return ws.id;
}

/** Fixture YouTube candidate provider for the Spotify-only fallback test (no network). */
const fixtureFallbackProvider: YouTubeCandidateProvider = async (_query, row): Promise<YouTubeSearchResult[]> => {
  const t = (row.title ?? "").toLowerCase();
  if (t.includes("violet sky")) {
    return [
      { title: "Nova Kane - Violet Sky (Official Audio)", url: "https://www.youtube.com/watch?v=ytfallVSok1", cover: null, type: "youtube", viewCount: 50000, durationSeconds: 200 },
      { title: "Violet Sky (Live at Wembley)", url: "https://www.youtube.com/watch?v=ytfallVSliv", cover: null, type: "youtube", viewCount: 90000, durationSeconds: 240 },
      { title: "Violet Sky - Karaoke Version", url: "https://www.youtube.com/watch?v=ytfallVSkar", cover: null, type: "youtube", viewCount: 10000, durationSeconds: 200 },
    ];
  }
  return [];
};

function loadSource(sourceKind: string, file: string, opts: Record<string, string>): { tracks: NormalizedTrack[]; source: UniversalPlaylistSource } {
  const text = fs.readFileSync(file, "utf8");
  if (sourceKind === "desktop-m3u") {
    const payload = JSON.parse(text) as DesktopM3uPayload;
    return {
      tracks: desktopPayloadToNormalizedTracks(payload),
      source: { name: payload.name, sourceProvider: "m3u", sourceType: "LOCAL_M3U", sourceUrl: payload.sourceUrl, sourceKey: payload.sourceKey, deviceId: "validation-device" },
    };
  }
  if (sourceKind === "m3u") {
    return {
      tracks: parseM3uText(text),
      source: { name: "Seed Mix", sourceProvider: "m3u", sourceType: "LOCAL_M3U", sourceUrl: path.basename(file), sourceKey: opts["source-key"] ?? "m3u:seed-mix", deviceId: "validation-device" },
    };
  }
  if (sourceKind === "youtube") {
    const json = JSON.parse(text) as { candidates: unknown[] };
    return {
      tracks: (json.candidates ?? []).map((c) => youtubeReader.normalize(c)),
      source: { name: "YouTube Sample", sourceProvider: "youtube", sourceType: "IMPORTED_URL", sourceUrl: "(fixture)", sourceKey: opts["source-key"] ?? "youtube:seed-sample" },
    };
  }
  throw new Error(`unknown --source: ${sourceKind}`);
}

async function main() {
  const { flags, opts } = parseArgs(process.argv.slice(2));
  const apply = flags.has("apply");
  const write = flags.has("write");
  const sourceKind = (opts.source ?? "m3u").toLowerCase();
  const defaultFile: Record<string, string> = {
    m3u: "fixtures/universal-playlist/seed-mix.m3u",
    youtube: "fixtures/universal-playlist/youtube-playlist.sample.json",
    "desktop-m3u": "fixtures/universal-playlist/desktop-m3u-payload.sample.json",
  };
  const file = path.resolve(process.cwd(), opts.file ?? defaultFile[sourceKind] ?? defaultFile.m3u);

  const target = assertSafeIngestionTarget("universal playlist transfer");
  console.log(`[target] env=${target.env} host=${target.host} db=${target.database} user=${target.userMasked}`);
  if (!apply) console.log("DRY-RUN — resolves read-only, writes nothing. Pass --apply (LOCAL dev only).");
  if (!fs.existsSync(file)) throw new Error(`source file not found: ${file}`);

  const { tracks, source } = loadSource(sourceKind, file, opts);

  const prisma = new PrismaClient();
  try {
    const report = await buildUniversalPlaylist(prisma, source, tracks, { apply });
    console.log("\n[universal playlist]", JSON.stringify({ ...report, sample: undefined }, null, 2));
    console.log("[sample]");
    for (const s of report.sample) console.log(`  #${String(s.position).padStart(2)} ${s.status.padEnd(18)} ${s.confidence === null ? "  -  " : s.confidence.toFixed(2)} "${s.title}"  [${s.reasons.join(", ")}]`);

    if (write) {
      if (!apply) { console.log("\n[writer] skipped — --write requires --apply."); return; }
      if (!report.playlistId) throw new Error("no playlistId after apply");
      const workspaceId = await ensureValidationWorkspace(prisma);
      const writer = new SyncBizPlaylistWriter(prisma, flags.has("fallback") ? fixtureFallbackProvider : undefined);
      const result = await writer.write(report.playlistId, { apply: true, workspaceId });
      console.log("\n[SyncBiz writer]", JSON.stringify(result, null, 2));
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
