/**
 * Phase C MVP — build/reconcile a UniversalPlaylist from normalized tracks.
 *
 * Reader-agnostic: takes NormalizedTrack[] (from YouTube reader, M3U tracklist, DJ Creator)
 * and resolves each via CatalogResolver, then creates OR idempotently reconciles a
 * UniversalPlaylist (keyed by sourceKey). Never writes an absolute local path — local refs
 * are hashed. Re-import updates order + changed tracks, marks removed items MISSING, and
 * never deletes a UniversalTrack or overwrites manual (non-null) metadata.
 */

import type { PrismaClient } from "@prisma/client";
import type { NormalizedTrack } from "@/lib/universal/universal-track";
import { resolveUniversalTrack, type ResolverPrisma } from "@/lib/universal/catalog-resolver";
import { normalizeArtistName, normalizeTitle, versionTypeFromTitle } from "@/lib/universal/normalize";
import { filenameOnly, hashLocalPath, looksLikeLocalPath } from "@/lib/universal/local-privacy";

type ItemStatus = "RESOLVED" | "PROVIDER_RESOLVED" | "AMBIGUOUS" | "UNRESOLVED" | "MISSING" | "REMOVED_FROM_SOURCE";

const VALID_VIDEO_ID = /^[A-Za-z0-9_-]{6,}$/;

/** Find the UniversalTrack already mapped to a provider externalId (e.g. a YouTube videoId). */
async function findProviderTrackId(prisma: PrismaClient, provider: string, externalId: string): Promise<string | null> {
  const m = await prisma.providerMapping.findFirst({ where: { provider, externalId }, select: { universalTrackId: true } });
  return m?.universalTrackId ?? null;
}

/**
 * Ensure a UniversalTrack + ProviderMapping exists for a directly-playable provider id
 * (e.g. a YouTube videoId). Idempotent via the unique (provider, externalId) mapping.
 * The universal catalog grows from imports — a valid videoId is playable regardless of the
 * catalog's title index.
 */
async function ensureProviderTrack(
  prisma: PrismaClient,
  args: { provider: string; externalId: string; externalUrl?: string; title: string; artists: string[]; durationMs: number | null },
): Promise<string> {
  const existing = await findProviderTrackId(prisma, args.provider, args.externalId);
  if (existing) return existing;
  return prisma.$transaction(async (tx) => {
    const track = await tx.universalTrack.create({
      data: {
        displayTitle: args.title,
        normalizedTitle: normalizeTitle(args.title),
        durationMs: args.durationMs,
        versionType: versionTypeFromTitle(args.title),
      },
      select: { id: true },
    });
    for (let i = 0; i < args.artists.length; i += 1) {
      const displayName = args.artists[i];
      const normalizedName = normalizeArtistName(displayName);
      if (!normalizedName) continue;
      const found = await tx.artist.findUnique({ where: { normalizedName }, select: { id: true } });
      const artist = found ?? (await tx.artist.create({ data: { normalizedName, displayName }, select: { id: true } }));
      await tx.trackArtist.create({ data: { universalTrackId: track.id, artistId: artist.id, order: i, role: i === 0 ? "primary" : "featured" } });
    }
    await tx.providerMapping.create({
      data: { universalTrackId: track.id, provider: args.provider, externalId: args.externalId, externalUrl: args.externalUrl, playableStatus: args.provider === "youtube" ? "PLAYABLE" : "UNKNOWN" },
    });
    await tx.sourceProvenance.create({ data: { universalTrackId: track.id, source: "playlist_import", sourceType: "playlist", externalReference: args.externalId } });
    return track.id;
  });
}

export interface UniversalPlaylistSource {
  name: string;
  description?: string;
  sourceProvider: string;
  sourceType: "IMPORTED_URL" | "LOCAL_M3U" | "DJ_CREATOR";
  sourcePlaylistId?: string;
  sourceUrl?: string;
  sourceKey: string;
  deviceId?: string;
}

interface BuiltItem {
  position: number;
  itemKey: string;
  universalTrackId: string | null;
  rawTitle: string;
  rawArtists: string[];
  rawDurationMs: number | null;
  sourceExternalId: string | null;
  sourceRef: string | null;
  filename: string | null;
  status: ItemStatus;
  matchConfidence: number | null;
  matchMethod: string | null;
  matchReasons: string[];
  bpm: number | null;
  comment: string | null;
  rating: number | null;
  isrc: string | null;
  metadataHash: string | null;
}

export interface UniversalPlaylistReport {
  mode: "dry-run" | "apply";
  action: "created" | "updated";
  playlistId?: string;
  sourceKey: string;
  name: string;
  itemCount: number;
  totalDurationMs: number;
  resolved: number;
  providerResolved: number;
  ambiguous: number;
  unresolved: number;
  missing: number;
  newItems: number;
  reorderedItems: number;
  removedFromSource: number;
  sample: Array<{ position: number; status: ItemStatus; confidence: number | null; title: string; reasons: string[] }>;
}

function itemKeyFor(sourceExternalId: string | null, rawTitle: string, primaryArtist: string): string {
  if (sourceExternalId) return `ext:${sourceExternalId}`;
  return `ta:${normalizeTitle(rawTitle)}|${normalizeArtistName(primaryArtist)}`;
}

async function resolveToBuiltItem(prisma: PrismaClient, track: NormalizedTrack, position: number, deviceId: string | undefined, apply: boolean): Promise<BuiltItem> {
  const artists = track.artists.map((a) => a.displayName);
  const rawDurationMs = typeof track.durationMs === "number" ? track.durationMs : null;
  const ref = track.providerRef;
  const isLocal = ref?.provider === "local";
  const rawFilename = (track.raw as { filename?: string } | undefined)?.filename;
  const sourceExternalId = ref && !isLocal ? ref.externalId : null;
  // Privacy: a raw absolute path is hashed here; a desktop-supplied opaque ref (already hashed) is kept as-is.
  const sourceRef = isLocal && ref ? (looksLikeLocalPath(ref.externalId) ? hashLocalPath(ref.externalId, deviceId) : ref.externalId) : null;
  const filename = isLocal && ref ? (rawFilename ?? filenameOnly(ref.externalId)) : null;

  const result = await resolveUniversalTrack(prisma as unknown as ResolverPrisma, {
    title: track.displayTitle,
    artists,
    isrc: track.isrc,
    durationMs: rawDurationMs ?? undefined,
  });

  let status: ItemStatus;
  let universalTrackId: string | null = null;
  let matchMethod: string = result.method;
  let matchReasons = result.reasons;

  if (result.decision === "auto_match") {
    status = "RESOLVED";
    universalTrackId = result.match?.id ?? null;
  } else if (ref?.provider === "youtube" && VALID_VIDEO_ID.test(ref.externalId)) {
    // A valid, directly-playable videoId is authoritative — do NOT rely on title parsing.
    status = "PROVIDER_RESOLVED";
    matchMethod = "provider_youtube";
    matchReasons = ["valid youtube videoId"];
    universalTrackId = apply
      ? await ensureProviderTrack(prisma, { provider: "youtube", externalId: ref.externalId, externalUrl: ref.externalUrl, title: track.displayTitle, artists, durationMs: rawDurationMs })
      : await findProviderTrackId(prisma, "youtube", ref.externalId);
  } else {
    status = result.decision === "ambiguous" ? "AMBIGUOUS" : "UNRESOLVED";
  }

  // Desktop can flag a (possibly resolved) track whose underlying file is currently unavailable.
  if ((track.raw as { availability?: string } | undefined)?.availability === "missing") status = "MISSING";

  return {
    position,
    itemKey: itemKeyFor(sourceExternalId, track.displayTitle, artists[0] ?? ""),
    universalTrackId,
    rawTitle: track.displayTitle,
    rawArtists: artists,
    rawDurationMs,
    sourceExternalId,
    sourceRef,
    filename,
    status,
    matchConfidence: result.confidence,
    matchMethod,
    matchReasons,
    bpm: track.enrichment?.bpm ?? null,
    comment: track.enrichment?.comment ?? null,
    rating: track.enrichment?.rating ?? null,
    isrc: track.isrc ?? null,
    metadataHash: track.enrichment?.metadataHash ?? null,
  };
}

const ENRICHED_KEYS = ["bpm", "comment", "rating", "isrc", "metadataHash"] as const;

export async function buildUniversalPlaylist(
  prisma: PrismaClient,
  source: UniversalPlaylistSource,
  tracks: NormalizedTrack[],
  opts: { apply?: boolean } = {},
): Promise<UniversalPlaylistReport> {
  const apply = opts.apply === true;

  const built: BuiltItem[] = [];
  for (let i = 0; i < tracks.length; i += 1) built.push(await resolveToBuiltItem(prisma, tracks[i], i, source.deviceId, apply));

  const totalDurationMs = built.reduce((sum, b) => sum + (b.rawDurationMs ?? 0), 0);
  const resolved = built.filter((b) => b.status === "RESOLVED").length;
  const providerResolved = built.filter((b) => b.status === "PROVIDER_RESOLVED").length;
  const ambiguous = built.filter((b) => b.status === "AMBIGUOUS").length;
  const unresolved = built.filter((b) => b.status === "UNRESOLVED").length;
  const missing = built.filter((b) => b.status === "MISSING").length;

  const existing = await prisma.universalPlaylist.findUnique({
    where: { sourceKey: source.sourceKey },
    include: { items: true },
  });
  const action: "created" | "updated" = existing ? "updated" : "created";

  // reconcile counts (vs existing)
  let newItems = built.length;
  let reorderedItems = 0;
  let removedItems = 0;
  type ExistingItem = NonNullable<typeof existing>["items"][number];
  const existingByKey = new Map<string, ExistingItem>();
  if (existing) {
    for (const it of existing.items) {
      const key = itemKeyFor(it.sourceExternalId, it.rawTitle, it.rawArtists[0] ?? "");
      existingByKey.set(key, it);
    }
    newItems = 0;
    for (const b of built) {
      const prev = existingByKey.get(b.itemKey);
      if (!prev) newItems += 1;
      else if (prev.position !== b.position) reorderedItems += 1;
    }
    const newKeys = new Set(built.map((b) => b.itemKey));
    removedItems = existing.items.filter((it) => {
      const key = itemKeyFor(it.sourceExternalId, it.rawTitle, it.rawArtists[0] ?? "");
      return !newKeys.has(key) && it.status !== "REMOVED_FROM_SOURCE";
    }).length;
  }

  const report: UniversalPlaylistReport = {
    mode: apply ? "apply" : "dry-run",
    action,
    playlistId: existing?.id,
    sourceKey: source.sourceKey,
    name: source.name,
    itemCount: built.length,
    totalDurationMs,
    resolved,
    providerResolved,
    ambiguous,
    unresolved,
    missing,
    newItems,
    reorderedItems,
    removedFromSource: removedItems,
    sample: built.slice(0, 10).map((b) => ({ position: b.position, status: b.status, confidence: b.matchConfidence, title: b.rawTitle, reasons: b.matchReasons })),
  };

  if (!apply) return report;

  const playlist = await prisma.universalPlaylist.upsert({
    where: { sourceKey: source.sourceKey },
    create: {
      name: source.name,
      description: source.description,
      sourceProvider: source.sourceProvider,
      sourceType: source.sourceType,
      sourcePlaylistId: source.sourcePlaylistId,
      sourceUrl: source.sourceUrl,
      sourceKey: source.sourceKey,
      totalDurationMs,
      itemCount: built.length,
      status: unresolved > 0 || ambiguous > 0 || missing > 0 ? "partial" : "ready",
    },
    update: {
      name: source.name,
      description: source.description,
      totalDurationMs,
      itemCount: built.length,
      status: unresolved > 0 || ambiguous > 0 || missing > 0 ? "partial" : "ready",
    },
    select: { id: true },
  });
  report.playlistId = playlist.id;

  if (!existing) {
    await prisma.universalPlaylistItem.createMany({
      data: built.map((b) => itemCreateData(playlist.id, b)),
    });
    return report;
  }

  // Reconcile: update matched keys (a returning item recovers its real status), create new,
  // and mark entries dropped from the source REMOVED_FROM_SOURCE. Preserve manual metadata.
  for (const b of built) {
    const prev = existingByKey.get(b.itemKey);
    if (prev) {
      await prisma.universalPlaylistItem.update({
        where: { id: prev.id },
        data: {
          position: b.position,
          universalTrackId: b.universalTrackId,
          rawTitle: b.rawTitle,
          rawArtists: b.rawArtists,
          rawDurationMs: b.rawDurationMs,
          status: b.status,
          matchConfidence: b.matchConfidence,
          matchMethod: b.matchMethod,
          matchReasons: b.matchReasons,
          // enriched: only fill when incoming is non-null (never overwrite manual with null)
          ...Object.fromEntries(ENRICHED_KEYS.map((k) => [k, b[k] ?? prev[k]])),
        },
      });
    } else {
      await prisma.universalPlaylistItem.create({ data: itemCreateData(playlist.id, b) });
    }
  }
  const newKeys = new Set(built.map((b) => b.itemKey));
  for (const it of existing.items) {
    const key = itemKeyFor(it.sourceExternalId, it.rawTitle, it.rawArtists[0] ?? "");
    if (!newKeys.has(key) && it.status !== "REMOVED_FROM_SOURCE") {
      await prisma.universalPlaylistItem.update({ where: { id: it.id }, data: { status: "REMOVED_FROM_SOURCE" } });
    }
  }
  return report;
}

function itemCreateData(playlistId: string, b: BuiltItem) {
  return {
    playlistId,
    position: b.position,
    universalTrackId: b.universalTrackId,
    rawTitle: b.rawTitle,
    rawArtists: b.rawArtists,
    rawDurationMs: b.rawDurationMs,
    sourceExternalId: b.sourceExternalId,
    sourceRef: b.sourceRef,
    filename: b.filename,
    status: b.status,
    matchConfidence: b.matchConfidence,
    matchMethod: b.matchMethod,
    matchReasons: b.matchReasons,
    bpm: b.bpm,
    comment: b.comment,
    rating: b.rating,
    isrc: b.isrc,
    metadataHash: b.metadataHash,
  };
}
