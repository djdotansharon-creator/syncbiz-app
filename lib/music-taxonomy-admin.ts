import "server-only";

import type {
  MusicTaxonomyCategory,
  MusicTaxonomyTag,
  MusicTaxonomyTagStatus,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  type MusicTaxonomyCategoryLiteral,
  isValidMusicTaxonomySlugFormat,
  type MusicTaxonomyTagStatusLiteral,
} from "@/lib/music-taxonomy-types";

export const MUSIC_TAXONOMY_CATEGORIES: MusicTaxonomyCategoryLiteral[] = [
  "PLAYBACK_CONTEXT",
  "VIBE_ENERGY",
  "MAIN_SOUND_GENRE",
  "STYLE_TAGS",
  "ISRAELI_SPECIALS",
  "TECHNICAL_TAGS",
  "BUSINESS_FIT",
  "DAYPART_FIT",
  "CATALOG_PROGRAMMING",
];

export const MUSIC_TAXONOMY_STATUSES: MusicTaxonomyTagStatusLiteral[] = [
  "ACTIVE",
  "DEPRECATED",
  "HIDDEN",
  "MERGED",
];

export function isValidTaxonomySlug(slug: string): boolean {
  return isValidMusicTaxonomySlugFormat(slug);
}

export function parseMusicTaxonomyCategory(
  raw: unknown,
): MusicTaxonomyCategory | null {
  if (typeof raw !== "string") return null;
  return (MUSIC_TAXONOMY_CATEGORIES as string[]).includes(raw)
    ? (raw as MusicTaxonomyCategory)
    : null;
}

export function parseMusicTaxonomyStatus(
  raw: unknown,
): MusicTaxonomyTagStatus | null {
  if (typeof raw !== "string") return null;
  return (MUSIC_TAXONOMY_STATUSES as string[]).includes(raw)
    ? (raw as MusicTaxonomyTagStatus)
    : null;
}

export type MusicTaxonomyTagListFilters = {
  category?: MusicTaxonomyCategory;
  status?: MusicTaxonomyTagStatus;
  q?: string;
};

export type MusicTaxonomyTagWithLinks = MusicTaxonomyTag & {
  parent: { id: string; slug: string; labelEn: string } | null;
  mergedInto: { id: string; slug: string; labelEn: string } | null;
};

const tagSelectLinks = {
  parent: { select: { id: true, slug: true, labelEn: true } },
  mergedInto: { select: { id: true, slug: true, labelEn: true } },
} satisfies Prisma.MusicTaxonomyTagInclude;

export async function loadAllMusicTaxonomyTags(): Promise<MusicTaxonomyTagWithLinks[]> {
  return prisma.musicTaxonomyTag.findMany({
    orderBy: [{ sortOrder: "asc" }, { labelEn: "asc" }],
    include: tagSelectLinks,
  });
}

export function filterMusicTaxonomyTags(
  rows: MusicTaxonomyTagWithLinks[],
  filters: MusicTaxonomyTagListFilters,
): MusicTaxonomyTagWithLinks[] {
  let list = rows;
  if (filters.category) list = list.filter((t) => t.category === filters.category);
  if (filters.status) list = list.filter((t) => t.status === filters.status);

  const q = filters.q?.trim();
  if (!q) return list;

  const lower = q.toLowerCase();
  return list.filter((t) => {
    if (t.slug.toLowerCase().includes(lower)) return true;
    if (t.labelEn.toLowerCase().includes(lower)) return true;
    if (t.labelHe.includes(q)) return true;
    return t.aliases.some((a) => a.toLowerCase().includes(lower));
  });
}

export async function queryMusicTaxonomyTags(
  filters: MusicTaxonomyTagListFilters,
): Promise<MusicTaxonomyTagWithLinks[]> {
  const rows = await loadAllMusicTaxonomyTags();
  return filterMusicTaxonomyTags(rows, filters);
}

export function validateCreateBody(raw: unknown): { ok: true; data: Prisma.MusicTaxonomyTagCreateInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Body must be a JSON object" };
  const o = raw as Record<string, unknown>;

  const slug = typeof o.slug === "string" ? o.slug.trim() : "";
  if (!slug || !isValidTaxonomySlug(slug)) {
    return { ok: false, error: "Invalid slug (lowercase letters, digits, hyphens)" };
  }

  const category = parseMusicTaxonomyCategory(o.category);
  if (!category) return { ok: false, error: "Invalid category" };

  const labelEn = typeof o.labelEn === "string" ? o.labelEn.trim() : "";
  const labelHe = typeof o.labelHe === "string" ? o.labelHe.trim() : "";
  if (!labelEn || !labelHe) return { ok: false, error: "labelEn and labelHe are required" };

  const descriptionHeUser =
    o.descriptionHeUser === undefined || o.descriptionHeUser === null
      ? null
      : typeof o.descriptionHeUser === "string"
        ? o.descriptionHeUser
        : undefined;
  if (descriptionHeUser === undefined) {
    return { ok: false, error: "descriptionHeUser must be a string or null" };
  }

  const descriptionAi =
    o.descriptionAi === undefined || o.descriptionAi === null
      ? null
      : typeof o.descriptionAi === "string"
        ? o.descriptionAi
        : undefined;
  if (descriptionAi === undefined) {
    return { ok: false, error: "descriptionAi must be a string or null" };
  }

  let aliases: string[];
  if (o.aliases === undefined || o.aliases === null) {
    aliases = [];
  } else {
    const parsed = parseAliases(o.aliases);
    if (parsed === undefined) return { ok: false, error: "aliases must be an array of strings" };
    aliases = parsed;
  }

  const status = parseMusicTaxonomyStatus(o.status ?? "ACTIVE");
  if (!status) return { ok: false, error: "Invalid status" };

  const sortOrder = typeof o.sortOrder === "number" && Number.isFinite(o.sortOrder) ? Math.floor(o.sortOrder) : 0;

  const parentId = o.parentId === undefined || o.parentId === null ? null : typeof o.parentId === "string" ? o.parentId : undefined;
  if (parentId === undefined) return { ok: false, error: "parentId must be a string or null" };

  const mergedIntoId =
    o.mergedIntoId === undefined || o.mergedIntoId === null
      ? null
      : typeof o.mergedIntoId === "string"
        ? o.mergedIntoId
        : undefined;
  if (mergedIntoId === undefined) return { ok: false, error: "mergedIntoId must be a string or null" };

  if (status === "MERGED" && !mergedIntoId) {
    return { ok: false, error: "MERGED status requires mergedIntoId" };
  }

  return {
    ok: true,
    data: {
      slug,
      category,
      labelEn,
      labelHe,
      descriptionHeUser,
      descriptionAi,
      aliases,
      status,
      sortOrder,
      parent: parentId ? { connect: { id: parentId } } : undefined,
      mergedInto: mergedIntoId ? { connect: { id: mergedIntoId } } : undefined,
    },
  };
}

export function validatePatchBody(
  raw: unknown,
): { ok: true; data: Prisma.MusicTaxonomyTagUpdateInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Body must be a JSON object" };
  const o = raw as Record<string, unknown>;

  const patch: Prisma.MusicTaxonomyTagUpdateInput = {};

  if ("category" in o) {
    const category = parseMusicTaxonomyCategory(o.category);
    if (!category) return { ok: false, error: "Invalid category" };
    patch.category = category;
  }

  if ("labelEn" in o) {
    if (typeof o.labelEn !== "string" || !o.labelEn.trim()) {
      return { ok: false, error: "labelEn must be a non-empty string" };
    }
    patch.labelEn = o.labelEn.trim();
  }

  if ("labelHe" in o) {
    if (typeof o.labelHe !== "string" || !o.labelHe.trim()) {
      return { ok: false, error: "labelHe must be a non-empty string" };
    }
    patch.labelHe = o.labelHe.trim();
  }

  if ("descriptionHeUser" in o) {
    if (o.descriptionHeUser !== null && typeof o.descriptionHeUser !== "string") {
      return { ok: false, error: "descriptionHeUser must be string or null" };
    }
    patch.descriptionHeUser = o.descriptionHeUser === null ? null : o.descriptionHeUser;
  }

  if ("descriptionAi" in o) {
    if (o.descriptionAi !== null && typeof o.descriptionAi !== "string") {
      return { ok: false, error: "descriptionAi must be string or null" };
    }
    patch.descriptionAi = o.descriptionAi === null ? null : o.descriptionAi;
  }

  if ("aliases" in o) {
    const aliases = parseAliases(o.aliases);
    if (aliases === undefined) return { ok: false, error: "aliases must be an array of strings" };
    patch.aliases = aliases;
  }

  if ("status" in o) {
    const status = parseMusicTaxonomyStatus(o.status);
    if (!status) return { ok: false, error: "Invalid status" };
    patch.status = status;
  }

  if ("sortOrder" in o) {
    if (typeof o.sortOrder !== "number" || !Number.isFinite(o.sortOrder)) {
      return { ok: false, error: "sortOrder must be a finite number" };
    }
    patch.sortOrder = Math.floor(o.sortOrder);
  }

  if ("parentId" in o) {
    if (o.parentId !== null && typeof o.parentId !== "string") {
      return { ok: false, error: "parentId must be string or null" };
    }
    patch.parent = o.parentId === null ? { disconnect: true } : { connect: { id: o.parentId } };
  }

  if ("mergedIntoId" in o) {
    if (o.mergedIntoId !== null && typeof o.mergedIntoId !== "string") {
      return { ok: false, error: "mergedIntoId must be string or null" };
    }
    patch.mergedInto =
      o.mergedIntoId === null ? { disconnect: true } : { connect: { id: o.mergedIntoId } };
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false, error: "No fields to update" };
  }

  return { ok: true, data: patch };
}

function parseAliases(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x !== "string" || !x.trim()) return undefined;
    out.push(x.trim());
  }
  return out;
}

export async function assertNoTaxonomyCycles(tagId: string, proposedParentId: string | null): Promise<boolean> {
  if (!proposedParentId) return true;
  if (proposedParentId === tagId) return false;

  let cursor: string | null = proposedParentId;
  const seen = new Set<string>();
  while (cursor) {
    if (seen.has(cursor)) return false;
    seen.add(cursor);
    if (cursor === tagId) return false;
    const row: { parentId: string | null } | null = await prisma.musicTaxonomyTag.findUnique({
      where: { id: cursor },
      select: { parentId: true },
    });
    cursor = row?.parentId ?? null;
  }
  return true;
}
