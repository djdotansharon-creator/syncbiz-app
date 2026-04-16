/**
 * Playlist storage — backed by PostgreSQL via Prisma.
 * Replaces the previous file-based (JSON) implementation.
 * All function signatures are preserved for drop-in compatibility.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { normalizePlaylistForPersist, PlaylistPersistError } from "./playlist-persist-rules";
import type { Playlist, PlaylistCreateInput, PlaylistTrack } from "./playlist-types";

type PlaylistRow = Prisma.PlaylistGetPayload<{ include: { items: true } }>;

export { PlaylistPersistError, isPlaylistPersistError } from "./playlist-persist-rules";

// ─── Workspace resolution ────────────────────────────────────────────────────

async function resolveWorkspaceId(id: string | undefined): Promise<string | null> {
  if (!id) return null;
  const byId = await prisma.workspace.findUnique({ where: { id } });
  if (byId) return byId.id;
  const bySlug = await prisma.workspace.findUnique({ where: { slug: id } });
  return bySlug?.id ?? null;
}

// ─── Mapping helpers ─────────────────────────────────────────────────────────

function rowToPlaylist(row: PlaylistRow): Playlist {
  const tracks: PlaylistTrack[] = row.items
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((item) => ({
      id: item.trackId || item.catalogId || "",
      name: item.name,
      type: item.trackType as Playlist["type"],
      url: item.url,
      cover: item.cover ?? undefined,
    }));

  return {
    id: row.id,
    name: row.name,
    genre: row.genre,
    type: row.playlistType as Playlist["type"],
    url: row.url,
    thumbnail: row.thumbnail,
    cover: row.thumbnail || undefined,
    createdAt: row.createdAt.toISOString(),
    branchId: row.branchId ?? undefined,
    tenantId: row.workspaceId,
    catalogItemId: row.catalogItemId ?? undefined,
    viewCount: row.viewCount ?? undefined,
    durationSeconds: row.durationSeconds ?? undefined,
    tracks: tracks.length > 0 ? tracks : undefined,
    order: row.trackOrder.length > 0 ? row.trackOrder : undefined,
    adminNotes: row.adminNotes ?? undefined,
    useCase: (row.useCase as Playlist["useCase"]) ?? undefined,
    useCases: row.useCases.length > 0 ? (row.useCases as Playlist["useCases"]) : undefined,
    primaryGenre: (row.primaryGenre as Playlist["primaryGenre"]) ?? undefined,
    subGenres: row.subGenres.length > 0 ? (row.subGenres as Playlist["subGenres"]) : undefined,
    mood: (row.mood as Playlist["mood"]) ?? undefined,
    energyLevel: (row.energyLevel as Playlist["energyLevel"]) ?? undefined,
    libraryPlacement: (row.libraryPlacement as Playlist["libraryPlacement"]) ?? undefined,
    playlistOwnershipScope: (row.playlistOwnershipScope as Playlist["playlistOwnershipScope"]) ?? undefined,
    scheduleContributorBlocks: row.scheduleContributorBlocks
      ? (row.scheduleContributorBlocks as Playlist["scheduleContributorBlocks"])
      : undefined,
    isShared: row.isShared,
    sharedById: row.sharedById ?? undefined,
  } as Playlist;
}

const INCLUDE_ITEMS = { items: true } as const;

// ─── Public API ──────────────────────────────────────────────────────────────

export async function listPlaylists(): Promise<Playlist[]> {
  const rows = await prisma.playlist.findMany({
    include: INCLUDE_ITEMS,
    orderBy: { createdAt: "desc" },
  });
  return rows.map(rowToPlaylist);
}

export async function listPlaylistsForTenant(tenantId: string): Promise<Playlist[]> {
  const wsId = await resolveWorkspaceId(tenantId);
  if (!wsId) return [];
  const rows = await prisma.playlist.findMany({
    where: { workspaceId: wsId },
    include: INCLUDE_ITEMS,
    orderBy: { createdAt: "desc" },
  });
  return rows.map(rowToPlaylist);
}

export async function getPlaylist(id: string): Promise<Playlist | null> {
  const row = await prisma.playlist.findUnique({
    where: { id },
    include: INCLUDE_ITEMS,
  });
  if (!row) return null;
  return rowToPlaylist(row);
}

export async function createPlaylist(input: PlaylistCreateInput): Promise<Playlist> {
  const normalized = normalizePlaylistForPersist({ ...input, id: input.id ?? crypto.randomUUID(), createdAt: new Date().toISOString() } as Playlist);
  const wsId = await resolveWorkspaceId(normalized.tenantId);
  if (!wsId) throw new Error("Workspace not found for tenantId: " + normalized.tenantId);

  const tracks = normalized.tracks ?? [];
  const order = normalized.order ?? tracks.map((t) => t.id);

  const row = await prisma.playlist.create({
    data: {
      id: normalized.id,
      workspaceId: wsId,
      name: normalized.name,
      genre: normalized.genre ?? "",
      playlistType: normalized.type ?? "youtube",
      url: normalized.url ?? "",
      thumbnail: normalized.thumbnail ?? "",
      branchId: normalized.branchId ?? null,
      catalogItemId: normalized.catalogItemId ?? null,
      viewCount: normalized.viewCount ?? null,
      durationSeconds: normalized.durationSeconds ?? null,
      adminNotes: normalized.adminNotes ?? null,
      useCase: normalized.useCase ?? null,
      useCases: normalized.useCases ?? [],
      primaryGenre: normalized.primaryGenre ?? null,
      subGenres: normalized.subGenres ?? [],
      mood: normalized.mood ?? null,
      energyLevel: normalized.energyLevel ?? null,
      libraryPlacement: normalized.libraryPlacement ?? null,
      playlistOwnershipScope: normalized.playlistOwnershipScope ?? null,
      trackOrder: order,
      scheduleContributorBlocks: normalized.scheduleContributorBlocks
        ? (normalized.scheduleContributorBlocks as object)
        : undefined,
      isShared: false,
      items: {
        create: tracks.map((t, idx) => ({
          trackId: t.id,
          name: t.name,
          trackType: t.type,
          url: t.url,
          cover: t.cover ?? null,
          position: idx,
        })),
      },
    },
    include: INCLUDE_ITEMS,
  });
  return rowToPlaylist(row);
}

export async function updatePlaylist(id: string, data: Partial<Playlist>): Promise<Playlist | null> {
  const existing = await prisma.playlist.findUnique({ where: { id } });
  if (!existing) return null;
  if (data.tracks !== undefined && data.tracks.length === 0) {
    throw new PlaylistPersistError("TRACKS_EMPTY", "tracks cannot be empty.");
  }

  const updateData: Parameters<typeof prisma.playlist.update>[0]["data"] = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.genre !== undefined) updateData.genre = data.genre;
  if (data.type !== undefined) updateData.playlistType = data.type;
  if (data.url !== undefined) updateData.url = data.url;
  if (data.thumbnail !== undefined) updateData.thumbnail = data.thumbnail;
  if (data.viewCount !== undefined) updateData.viewCount = data.viewCount;
  if (data.durationSeconds !== undefined) updateData.durationSeconds = data.durationSeconds;
  if (data.adminNotes !== undefined) updateData.adminNotes = data.adminNotes;
  if (data.useCase !== undefined) updateData.useCase = data.useCase ?? null;
  if (data.useCases !== undefined) updateData.useCases = data.useCases ?? [];
  if (data.primaryGenre !== undefined) updateData.primaryGenre = data.primaryGenre ?? null;
  if (data.subGenres !== undefined) updateData.subGenres = data.subGenres ?? [];
  if (data.mood !== undefined) updateData.mood = data.mood ?? null;
  if (data.energyLevel !== undefined) updateData.energyLevel = data.energyLevel ?? null;
  if ("scheduleContributorBlocks" in data) {
    updateData.scheduleContributorBlocks = data.scheduleContributorBlocks
      ? (data.scheduleContributorBlocks as object)
      : undefined;
  }

  if (data.tracks !== undefined) {
    const tracks = data.tracks;
    const order = data.order ?? tracks.map((t) => t.id);
    updateData.trackOrder = order;
    updateData.items = {
      deleteMany: {},
      create: tracks.map((t, idx) => ({
        trackId: t.id,
        name: t.name,
        trackType: t.type,
        url: t.url,
        cover: t.cover ?? null,
        position: idx,
      })),
    };
  } else if (data.order !== undefined) {
    updateData.trackOrder = data.order;
  }

  const row = await prisma.playlist.update({
    where: { id },
    data: updateData,
    include: INCLUDE_ITEMS,
  });
  return rowToPlaylist(row);
}

export async function deletePlaylist(id: string): Promise<boolean> {
  try {
    await prisma.playlist.delete({ where: { id } });
    return true;
  } catch {
    return false;
  }
}
