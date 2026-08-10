/**
 * Phase C MVP — PlaylistWriter contract + SyncBizPlaylistWriter (first, internal target).
 *
 * A PlaylistWriter materializes a UniversalPlaylist into a target. SyncBizPlaylistWriter
 * writes into the existing SyncBiz Playlist/PlaylistItem tables (no external platform), and
 * records a UniversalPlaylistExport row (link + history). Idempotent: re-export reuses the
 * same SyncBiz Playlist. Only RESOLVED items are written; ambiguous/unresolved/missing are
 * reported, never silently dropped. Local items are skipped in SyncBiz export for the MVP
 * (their path is desktop-only) and counted as missing.
 */

import type { PrismaClient } from "@prisma/client";
import { pickSafeYouTubeVideoId, type YouTubeCandidateProvider } from "@/lib/universal/youtube-fallback";

export type WriterTarget = "SYNCBIZ" | "YOUTUBE" | "SPOTIFY";

export interface PlaylistWriteOptions {
  apply?: boolean;
  workspaceId: string;
  branchId?: string;
}

export interface PlaylistWriteResult {
  target: WriterTarget;
  mode: "dry-run" | "apply";
  status: "COMPLETED" | "PARTIAL" | "FAILED";
  exportId?: string;
  targetPlaylistId?: string;
  tracksTotal: number;
  tracksExported: number;
  tracksMissing: number;
  /** Tracks that had no YouTube mapping but were safely recovered via the fallback. */
  fallbackRecovered: number;
  missingTracks: Array<{ position: number; title: string; status: string }>;
  reused: boolean;
  error?: string;
}

export interface PlaylistWriter {
  readonly target: WriterTarget;
  isConnected(): Promise<boolean>;
  write(universalPlaylistId: string, opts: PlaylistWriteOptions): Promise<PlaylistWriteResult>;
}

export class SyncBizPlaylistWriter implements PlaylistWriter {
  readonly target = "SYNCBIZ" as const;
  /**
   * @param youtubeCandidateProvider optional — when set, resolved tracks that lack a YouTube
   * mapping (e.g. Spotify-only) get a SAFE YouTube fallback before being counted as missing.
   * Inject a real yt-dlp search in production, or a fixture in tests.
   */
  constructor(
    private readonly prisma: PrismaClient,
    private readonly youtubeCandidateProvider?: YouTubeCandidateProvider,
  ) {}

  /** SyncBiz is the internal target — always "connected". */
  async isConnected(): Promise<boolean> {
    return true;
  }

  async write(universalPlaylistId: string, opts: PlaylistWriteOptions): Promise<PlaylistWriteResult> {
    const apply = opts.apply === true;
    const up = await this.prisma.universalPlaylist.findUnique({
      where: { id: universalPlaylistId },
      include: { items: { orderBy: { position: "asc" } } },
    });
    if (!up) throw new Error(`UniversalPlaylist not found: ${universalPlaylistId}`);

    const items = up.items;
    const isPlayable = (s: string) => s === "RESOLVED" || s === "PROVIDER_RESOLVED";
    const resolved = items.filter((i) => isPlayable(i.status) && i.universalTrackId);
    const missing = items.filter((i) => !(isPlayable(i.status) && i.universalTrackId));
    const missingTracks: Array<{ position: number; title: string; status: string }> = missing.map((i) => ({ position: i.position, title: i.rawTitle, status: i.status as string }));

    // Load playable mapping + legacy catalog link for the resolved tracks.
    const trackIds = resolved.map((i) => i.universalTrackId as string);
    const tracks = trackIds.length
      ? await this.prisma.universalTrack.findMany({
          where: { id: { in: trackIds } },
          select: {
            id: true,
            displayTitle: true,
            durationMs: true,
            legacyCatalogItemId: true,
            providerMappings: { where: { provider: "youtube" }, select: { externalId: true, externalUrl: true }, take: 1 },
          },
        })
      : [];
    const trackById = new Map(tracks.map((t) => [t.id, t]));

    // Spotify-only fallback (apply): give resolved tracks that lack a YouTube mapping a SAFE
    // YouTube pick before counting them missing. Uses the existing conservative scorer.
    const fallbackMapping = new Map<string, { externalId: string; externalUrl: string }>();
    let fallbackRecovered = 0;
    if (apply && this.youtubeCandidateProvider) {
      for (const i of resolved) {
        const t = trackById.get(i.universalTrackId as string);
        if (!t || t.providerMappings[0]) continue;
        const artist = i.rawArtists[0];
        const durationSec = t.durationMs ? Math.round(t.durationMs / 1000) : undefined;
        const query = [artist, t.displayTitle].filter(Boolean).join(" ").trim();
        try {
          const candidates = await this.youtubeCandidateProvider(query, { title: t.displayTitle, artist, durationSec });
          const pick = pickSafeYouTubeVideoId({ title: t.displayTitle, artist, durationSec }, candidates);
          if (!pick) continue;
          await this.prisma.providerMapping.create({
            data: { universalTrackId: t.id, provider: "youtube", externalId: pick.videoId, externalUrl: pick.url, playableStatus: "PLAYABLE", matchConfidence: 0.9 },
          });
          fallbackMapping.set(t.id, { externalId: pick.videoId, externalUrl: pick.url });
          fallbackRecovered += 1;
        } catch {
          // videoId already mapped elsewhere, or search failure → leave as missing (safe)
        }
      }
    }

    const rows = resolved
      .map((i) => {
        const t = trackById.get(i.universalTrackId as string);
        const mapping = t?.providerMappings[0] ?? (t ? fallbackMapping.get(t.id) : undefined);
        const url = mapping?.externalUrl ?? (mapping ? `https://www.youtube.com/watch?v=${mapping.externalId}` : "");
        if (!url) return null; // no playable mapping → treated as missing
        return {
          trackId: mapping?.externalId ?? i.id,
          catalogId: t?.legacyCatalogItemId ?? null,
          name: i.rawTitle,
          trackType: "youtube",
          url,
          cover: null as string | null,
          position: i.position,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    const tracksExported = rows.length;
    const tracksMissing = items.length - tracksExported;
    for (const i of resolved) {
      const t = trackById.get(i.universalTrackId as string);
      const hasMapping = Boolean(t?.providerMappings[0]) || Boolean(t && fallbackMapping.get(t.id));
      if (!hasMapping) missingTracks.push({ position: i.position, title: i.rawTitle, status: "no_playable_mapping" });
    }
    const status: PlaylistWriteResult["status"] = tracksMissing > 0 ? "PARTIAL" : "COMPLETED";

    if (!apply) {
      return { target: this.target, mode: "dry-run", status, targetPlaylistId: undefined, tracksTotal: items.length, tracksExported, tracksMissing, fallbackRecovered, missingTracks, reused: false };
    }

    try {
      // Idempotency: reuse the SyncBiz Playlist from a prior SYNCBIZ export, if it still exists.
      const priorExport = await this.prisma.universalPlaylistExport.findFirst({
        where: { universalPlaylistId, target: "SYNCBIZ", syncbizPlaylistId: { not: null } },
        orderBy: { createdAt: "desc" },
      });
      let syncbizPlaylistId: string | null = null;
      let reused = false;
      if (priorExport?.syncbizPlaylistId) {
        const existing = await this.prisma.playlist.findUnique({ where: { id: priorExport.syncbizPlaylistId }, select: { id: true } });
        if (existing) {
          syncbizPlaylistId = existing.id;
          reused = true;
        }
      }

      if (syncbizPlaylistId) {
        // Replace items in place; keep the same Playlist id (idempotent re-export).
        await this.prisma.playlistItem.deleteMany({ where: { playlistId: syncbizPlaylistId } });
        await this.prisma.playlist.update({
          where: { id: syncbizPlaylistId },
          data: {
            name: up.name,
            trackOrder: rows.map((r) => r.trackId),
            durationSeconds: up.totalDurationMs ? Math.round(up.totalDurationMs / 1000) : null,
            items: { create: rows },
          },
        });
      } else {
        const created = await this.prisma.playlist.create({
          data: {
            workspaceId: opts.workspaceId,
            name: up.name,
            description: up.description ?? null,
            genre: "",
            playlistType: "youtube",
            branchId: opts.branchId ?? null,
            durationSeconds: up.totalDurationMs ? Math.round(up.totalDurationMs / 1000) : null,
            trackOrder: rows.map((r) => r.trackId),
            items: { create: rows },
          },
          select: { id: true },
        });
        syncbizPlaylistId = created.id;
      }

      const exportRow = await this.prisma.universalPlaylistExport.create({
        data: {
          universalPlaylistId,
          target: "SYNCBIZ",
          syncbizPlaylistId,
          status,
          tracksTotal: items.length,
          tracksExported,
          tracksMissing,
          completedAt: new Date(),
        },
        select: { id: true },
      });

      return { target: this.target, mode: "apply", status, exportId: exportRow.id, targetPlaylistId: syncbizPlaylistId ?? undefined, tracksTotal: items.length, tracksExported, tracksMissing, fallbackRecovered, missingTracks, reused };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      await this.prisma.universalPlaylistExport.create({
        data: { universalPlaylistId, target: "SYNCBIZ", status: "FAILED", tracksTotal: items.length, tracksExported: 0, tracksMissing: items.length, errorSummary: { error } },
      }).catch(() => undefined);
      return { target: this.target, mode: "apply", status: "FAILED", tracksTotal: items.length, tracksExported: 0, tracksMissing: items.length, fallbackRecovered: 0, missingTracks, reused: false, error };
    }
  }
}
