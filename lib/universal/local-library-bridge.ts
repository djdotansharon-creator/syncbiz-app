/**
 * Phase C — desktop local music bank → UniversalTrack bridge.
 *
 * Consumes a PRIVACY-SAFE payload (localRef hash + filename + metadata; NEVER a path) and
 * syncs a LocalTrackFile linked to a UniversalTrack + a ProviderMapping(provider="local").
 * Change detection uses metadataHash + fileSize (the desktop already gates on size/mtime).
 * A vanished file is marked MISSING, never deleted. Identity fields (ISRC/title/year/version)
 * are merged with FIELD-LEVEL PRECEDENCE so a re-scan never overwrites manual/excel metadata.
 */

import type { PrismaClient } from "@prisma/client";
import { normalizeTitle, versionTypeFromTitle } from "@/lib/universal/normalize";
import { looksLikeLocalPath } from "@/lib/universal/local-privacy";
import { mergeMetadata, type MetadataSource } from "@/lib/universal/metadata-precedence";

export interface LocalTrackSyncPayload {
  deviceId: string;
  /** Opaque device-local hash. MUST NOT be an absolute path. */
  localRef: string;
  filename: string;
  fileSize?: number;
  modifiedAt?: string;
  metadataHash?: string;
  availability?: "available" | "missing";
  durationMs?: number;
  metadata?: {
    title?: string;
    artists?: string[];
    album?: string;
    genres?: string[];
    year?: string;
    bpm?: number;
    comment?: string;
    rating?: number;
    isrc?: string;
    customTags?: Record<string, string>;
  };
  /** Source of these tags (defaults to mp3). manual/excel take precedence over mp3. */
  metadataSource?: MetadataSource;
}

export interface LocalSyncReport {
  localRef: string;
  action: "created" | "updated" | "unchanged" | "missing";
  universalTrackId: string | null;
  fileStatus: string;
  changedFields: string[];
}

async function resolveUniversalTrackId(prisma: PrismaClient, sourceId: string, localRef: string, isrc?: string): Promise<string | null> {
  const existingFile = await prisma.localTrackFile.findUnique({ where: { sourceId_localRef: { sourceId, localRef } }, select: { universalTrackId: true } });
  if (existingFile?.universalTrackId) return existingFile.universalTrackId;
  const mapping = await prisma.providerMapping.findFirst({ where: { provider: "local", externalId: localRef }, select: { universalTrackId: true } });
  if (mapping?.universalTrackId) return mapping.universalTrackId;
  if (isrc) {
    const byIsrc = await prisma.universalTrack.findUnique({ where: { canonicalIsrc: isrc.toUpperCase() }, select: { id: true } });
    if (byIsrc) return byIsrc.id;
  }
  return null;
}

export async function syncLocalTrackFile(prisma: PrismaClient, payload: LocalTrackSyncPayload, opts: { apply?: boolean } = {}): Promise<LocalSyncReport> {
  const apply = opts.apply === true;
  if (looksLikeLocalPath(payload.localRef)) {
    throw new Error("REFUSED: localRef looks like an absolute path — the desktop must send a hashed reference, never a path.");
  }
  const meta = payload.metadata ?? {};
  const source: MetadataSource = payload.metadataSource ?? "mp3";

  // Ensure the device's LocalLibrarySource.
  const src = apply
    ? await prisma.localLibrarySource.upsert({ where: { deviceId: payload.deviceId }, update: {}, create: { deviceId: payload.deviceId }, select: { id: true } })
    : await prisma.localLibrarySource.findUnique({ where: { deviceId: payload.deviceId }, select: { id: true } });
  const sourceId = src?.id ?? "__dry_run__";

  const existing = src
    ? await prisma.localTrackFile.findUnique({ where: { sourceId_localRef: { sourceId, localRef: payload.localRef } } })
    : null;

  // Vanished file → mark MISSING (never delete).
  if (payload.availability === "missing") {
    if (apply && existing) await prisma.localTrackFile.update({ where: { id: existing.id }, data: { status: "missing", lastScannedAt: new Date() } });
    return { localRef: payload.localRef, action: "missing", universalTrackId: existing?.universalTrackId ?? null, fileStatus: "missing", changedFields: [] };
  }

  // Unchanged (same content hash + size) → idempotent no-op.
  const unchanged = existing && existing.metadataHash === (payload.metadataHash ?? null) && existing.fileSize === (payload.fileSize ?? null) && existing.status === "available";
  if (unchanged) {
    if (apply) await prisma.localTrackFile.update({ where: { id: existing.id }, data: { lastScannedAt: new Date() } });
    return { localRef: payload.localRef, action: "unchanged", universalTrackId: existing.universalTrackId, fileStatus: "available", changedFields: [] };
  }

  const utId = src ? await resolveUniversalTrackId(prisma, sourceId, payload.localRef, meta.isrc) : null;

  if (!apply) {
    return { localRef: payload.localRef, action: existing ? "updated" : "created", universalTrackId: utId, fileStatus: "available", changedFields: [] };
  }

  // Find-or-create the UniversalTrack.
  const title = meta.title ?? payload.filename.replace(/\.[a-z0-9]{1,5}$/i, "");
  let universalTrackId = utId;
  if (!universalTrackId) {
    const created = await prisma.universalTrack.create({
      data: { displayTitle: title, normalizedTitle: normalizeTitle(title), durationMs: payload.durationMs ?? null, canonicalIsrc: meta.isrc ? meta.isrc.toUpperCase() : null, versionType: versionTypeFromTitle(title), metadataProvenance: { title: source, ...(meta.isrc ? { isrc: source } : {}) } },
      select: { id: true },
    });
    universalTrackId = created.id;
    await prisma.sourceProvenance.create({ data: { universalTrackId, source: "local_library", sourceType: "local_file", externalReference: payload.localRef } });
  }

  // Field-level precedence merge on identity fields (ISRC / releaseYear / title).
  const ut = await prisma.universalTrack.findUnique({ where: { id: universalTrackId }, select: { canonicalIsrc: true, firstReleaseDate: true, displayTitle: true, metadataProvenance: true } });
  const current = { isrc: ut?.canonicalIsrc ?? null, year: ut?.firstReleaseDate ? ut.firstReleaseDate.getUTCFullYear() : null, title };
  const incoming = { isrc: meta.isrc ? meta.isrc.toUpperCase() : undefined, year: meta.year ? Number(meta.year) : undefined, title: meta.title };
  const merged = mergeMetadata(current, (ut?.metadataProvenance as Record<string, MetadataSource> | null) ?? {}, incoming, source);
  await prisma.universalTrack.update({
    where: { id: universalTrackId },
    data: {
      canonicalIsrc: (merged.values.isrc as string | null) ?? null,
      firstReleaseDate: typeof merged.values.year === "number" ? new Date(Date.UTC(merged.values.year, 0, 1)) : ut?.firstReleaseDate ?? null,
      displayTitle: (merged.values.title as string) ?? title,
      metadataProvenance: merged.provenance,
    },
  });

  // Ensure a local ProviderMapping (playable via the desktop).
  await prisma.providerMapping.upsert({
    where: { provider_externalId: { provider: "local", externalId: payload.localRef } },
    update: { playableStatus: "PLAYABLE", matchMethod: "local_file", lastVerifiedAt: new Date() },
    create: { universalTrackId, provider: "local", externalId: payload.localRef, playableStatus: "PLAYABLE", matchMethod: "local_file", matchConfidence: 1 },
  });

  // Upsert the LocalTrackFile.
  await prisma.localTrackFile.upsert({
    where: { sourceId_localRef: { sourceId, localRef: payload.localRef } },
    update: { filename: payload.filename, fileSize: payload.fileSize ?? null, modifiedAt: payload.modifiedAt ? new Date(payload.modifiedAt) : null, metadataHash: payload.metadataHash ?? null, universalTrackId, status: "available", lastScannedAt: new Date() },
    create: { sourceId, localRef: payload.localRef, filename: payload.filename, fileSize: payload.fileSize ?? null, modifiedAt: payload.modifiedAt ? new Date(payload.modifiedAt) : null, metadataHash: payload.metadataHash ?? null, universalTrackId, status: "available" },
  });

  return { localRef: payload.localRef, action: existing ? "updated" : "created", universalTrackId, fileStatus: "available", changedFields: merged.changed };
}
