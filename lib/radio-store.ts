/**
 * Radio stream storage — backed by PostgreSQL via Prisma.
 * Radio stations are stored as Source rows with type = "radio".
 * Replaces the previous file-per-station JSON implementation.
 * All function signatures are preserved for drop-in compatibility.
 */

import { prisma } from "./prisma";
import type { RadioStream } from "./source-types";

export type RadioCreateInput = {
  id?: string;
  name: string;
  url: string;
  genre?: string;
  cover?: string | null;
  branchId?: string;
  tenantId?: string;
};

// ─── Workspace resolution ────────────────────────────────────────────────────

async function resolveWorkspaceId(id: string | undefined): Promise<string | null> {
  if (!id) return null;
  const byId = await prisma.workspace.findUnique({ where: { id } });
  if (byId) return byId.id;
  const bySlug = await prisma.workspace.findUnique({ where: { slug: id } });
  return bySlug?.id ?? null;
}

// ─── Mapping helper ──────────────────────────────────────────────────────────

function rowToRadioStream(row: {
  id: string;
  name: string;
  url: string;
  artworkUrl: string | null;
  tags: string[];
  branchId: string;
  workspaceId: string;
  createdAt: Date;
}): RadioStream {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    genre: row.tags[0] || "Radio",
    cover: row.artworkUrl ?? null,
    branchId: row.branchId,
    tenantId: row.workspaceId,
    createdAt: row.createdAt.toISOString(),
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function listRadioStations(): Promise<RadioStream[]> {
  const rows = await prisma.source.findMany({
    where: { type: "radio" },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(rowToRadioStream);
}

export async function listRadioStationsForTenant(tenantId: string): Promise<RadioStream[]> {
  const wsId = await resolveWorkspaceId(tenantId);
  if (!wsId) return [];
  const rows = await prisma.source.findMany({
    where: { workspaceId: wsId, type: "radio" },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(rowToRadioStream);
}

export async function getRadioStation(id: string): Promise<RadioStream | null> {
  const row = await prisma.source.findFirst({ where: { id, type: "radio" } });
  return row ? rowToRadioStream(row) : null;
}

export async function createRadioStation(input: RadioCreateInput): Promise<RadioStream> {
  const wsId = await resolveWorkspaceId(input.tenantId);
  if (!wsId) throw new Error("Workspace not found for tenantId: " + input.tenantId);

  const branchId = (input.branchId ?? "default").trim() || "default";

  // Ensure branch stub exists (same pattern as store.ts)
  await prisma.branch.upsert({
    where: { id: branchId },
    update: {},
    create: {
      id: branchId,
      workspaceId: wsId,
      name: branchId === "default" ? "Default Branch" : branchId,
      code: branchId.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "BRANCH",
    },
  });

  const id = input.id ?? `radio-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const row = await prisma.source.create({
    data: {
      id,
      workspaceId: wsId,
      name: input.name.trim(),
      url: input.url.trim(),
      type: "radio",
      branchId,
      artworkUrl: input.cover ?? null,
      tags: input.genre?.trim() ? [input.genre.trim()] : ["Radio"],
      isLive: true,
      capabilities: [],
    },
  });
  return rowToRadioStream(row);
}

export async function updateRadioStation(
  id: string,
  data: Partial<RadioStream>,
): Promise<RadioStream | null> {
  const existing = await getRadioStation(id);
  if (!existing) return null;

  const row = await prisma.source.update({
    where: { id },
    data: {
      ...(data.name != null && { name: data.name }),
      ...(data.url != null && { url: data.url }),
      ...(data.genre != null && { tags: [data.genre] }),
      ...(data.cover !== undefined && { artworkUrl: data.cover ?? null }),
    },
  });
  return rowToRadioStream(row);
}

export async function deleteRadioStation(id: string): Promise<boolean> {
  try {
    await prisma.source.delete({ where: { id } });
    return true;
  } catch {
    return false;
  }
}
