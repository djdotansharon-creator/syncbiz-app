import type {
  MusicTaxonomyCategory,
  MusicTaxonomyTagStatus,
} from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { getPlaylistProAliasMergeEntries } from "@/lib/music-taxonomy-playlist-pro-merge";
import { applyMusicTaxonomyStage3DefaultDuplicateMerges } from "@/lib/music-taxonomy-stage3-default-merge-cleanup";
import { DEFAULT_MUSIC_TAXONOMY_SEED_ROWS } from "@/lib/music-taxonomy-seed-defaults";
import type {
  MusicTaxonomyCategoryLiteral,
  MusicTaxonomySeedRow,
} from "@/lib/music-taxonomy-types";

/** Canonical Prisma enum strings for `MusicTaxonomyCategory` (matches schema.prisma). */
const MUSIC_TAXONOMY_CATEGORY_ENUMS = new Set<string>([
  "PLAYBACK_CONTEXT",
  "VIBE_ENERGY",
  "MAIN_SOUND_GENRE",
  "STYLE_TAGS",
  "ISRAELI_SPECIALS",
  "TECHNICAL_TAGS",
  "BUSINESS_FIT",
  "DAYPART_FIT",
]);

/**
 * Human / sheet labels from Stage 3 Excel → Prisma enum values.
 * Keys use {@link categoryCanonicalForLookup} after trimming/lowercase/slash normalization.
 */
const CATEGORY_ALIAS_TO_ENUM: Record<string, MusicTaxonomyCategoryLiteral> = {
  "playback context": "PLAYBACK_CONTEXT",
  "vibe/energy": "VIBE_ENERGY",
  "main sound (genre)": "MAIN_SOUND_GENRE",
  "main sound/genre": "MAIN_SOUND_GENRE",
  genre: "MAIN_SOUND_GENRE",
  "style tags": "STYLE_TAGS",
  "israeli specials": "ISRAELI_SPECIALS",
  "technical tags": "TECHNICAL_TAGS",
  "business fit": "BUSINESS_FIT",
  "daypart fit": "DAYPART_FIT",
};

/** Normalize whitespace and slashes so "Vibe / Energy" and "Vibe/Energy" share one lookup key. */
function categoryCanonicalForLookup(raw: string): string {
  let s = raw.trim().toLowerCase().replace(/\s+/g, " ");
  s = s.replace(/\s*\/\s*/g, "/");
  return s;
}

/**
 * Maps Excel/human category labels or Prisma enum strings to `MusicTaxonomyCategoryLiteral`.
 */
export function normalizeMusicTaxonomyCategory(raw: string, slugForError: string): MusicTaxonomyCategoryLiteral {
  const t = raw.trim();
  if (MUSIC_TAXONOMY_CATEGORY_ENUMS.has(t)) {
    return t as MusicTaxonomyCategoryLiteral;
  }
  const key = categoryCanonicalForLookup(t);
  const mapped = CATEGORY_ALIAS_TO_ENUM[key];
  if (mapped) return mapped;
  throw new Error(
    `Music taxonomy seed: unknown category "${raw}" for slug "${slugForError}". ` +
      `Use a MusicTaxonomyCategory value (e.g. PLAYBACK_CONTEXT) or a known sheet label such as "Playback Context".`,
  );
}

function normalizeSeedRows(rows: unknown): MusicTaxonomySeedRow[] {
  if (!Array.isArray(rows)) throw new Error("Seed rows must be a JSON array");
  const out: MusicTaxonomySeedRow[] = [];
  let i = 0;
  for (const row of rows) {
    i += 1;
    if (!row || typeof row !== "object") throw new Error(`Row ${i}: expected object`);
    const r = row as Record<string, unknown>;
    if (typeof r.slug !== "string" || !r.slug.trim()) throw new Error(`Row ${i}: slug required`);
    if (typeof r.category !== "string") throw new Error(`Row ${i}: category required`);
    if (typeof r.labelEn !== "string") throw new Error(`Row ${i}: labelEn required`);
    if (typeof r.labelHe !== "string") throw new Error(`Row ${i}: labelHe required`);
    const slug = r.slug.trim();
    out.push({
      slug,
      category: normalizeMusicTaxonomyCategory(r.category, slug),
      labelEn: r.labelEn.trim(),
      labelHe: r.labelHe.trim(),
      descriptionHeUser:
        r.descriptionHeUser === undefined || r.descriptionHeUser === null
          ? null
          : String(r.descriptionHeUser),
      descriptionAi:
        r.descriptionAi === undefined || r.descriptionAi === null
          ? null
          : String(r.descriptionAi),
      aliases:
        r.aliases === undefined
          ? []
          : Array.isArray(r.aliases)
            ? r.aliases.map((a) => String(a).trim()).filter(Boolean)
            : String(r.aliases)
                .split(/[,;|]/u)
                .map((s) => s.trim())
                .filter(Boolean),
      status: (typeof r.status === "string" ? r.status : "ACTIVE") as MusicTaxonomySeedRow["status"],
      parentSlug:
        r.parentSlug === undefined || r.parentSlug === null ? null : String(r.parentSlug).trim() || null,
      mergedIntoSlug:
        r.mergedIntoSlug === undefined || r.mergedIntoSlug === null
          ? null
          : String(r.mergedIntoSlug).trim() || null,
      sortOrder:
        typeof r.sortOrder === "number" && Number.isFinite(r.sortOrder)
          ? Math.floor(r.sortOrder)
          : 0,
    });
  }
  return out;
}

/**
 * Canonical vocabulary: Excel-generated JSON (`music-taxonomy.generated.json`) or `MUSIC_TAXONOMY_SEED_JSON`.
 * Embedded defaults are **fallback only** when neither file exists — never merged with JSON rows.
 */
function loadPrimaryMusicTaxonomySeedRowsFromDisk(): MusicTaxonomySeedRow[] {
  const envPath = process.env.MUSIC_TAXONOMY_SEED_JSON?.trim();
  const candidates = [
    envPath,
    path.join(process.cwd(), "prisma", "seed-data", "music-taxonomy.generated.json"),
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const raw = fs.readFileSync(p, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      const normalized = normalizeSeedRows(parsed);
      console.info(`[music-taxonomy seed] Loaded ${normalized.length} canonical rows from ${p}`);
      console.info(
        `[music-taxonomy seed] Embedded defaults skipped — canonical JSON present (fallback defaults not loaded).`,
      );
      return normalized;
    } catch (e) {
      console.warn(`[music-taxonomy seed] Failed reading ${p}:`, e);
    }
  }

  console.info(
    `[music-taxonomy seed] Using embedded defaults (${DEFAULT_MUSIC_TAXONOMY_SEED_ROWS.length} rows).`,
  );
  return DEFAULT_MUSIC_TAXONOMY_SEED_ROWS;
}

/**
 * Optional rows from `data/playlist-pro-genres.pdf` via
 * `scripts/build-playlist-pro-enrichment-from-pdf.cjs` (Stage 3 dictionary enrichment only).
 */
function loadPlaylistProEnrichmentRowsFromDisk(): MusicTaxonomySeedRow[] {
  const p = path.join(
    process.cwd(),
    "prisma",
    "seed-data",
    "music-taxonomy-playlist-pro-enrichment.generated.json",
  );
  if (!fs.existsSync(p)) return [];
  try {
    const raw = fs.readFileSync(p, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const normalized = normalizeSeedRows(parsed);
    console.info(
      `[music-taxonomy seed] Loaded ${normalized.length} Playlist Pro (PDF) enrichment rows from ${p}`,
    );
    return normalized;
  } catch (e) {
    console.warn(`[music-taxonomy seed] Failed reading Playlist Pro enrichment ${p}:`, e);
    return [];
  }
}

function mergePlaylistProEnrichment(
  primary: MusicTaxonomySeedRow[],
  playlistPro: MusicTaxonomySeedRow[],
): MusicTaxonomySeedRow[] {
  if (playlistPro.length === 0) return primary;

  const bySlug = new Map<string, MusicTaxonomySeedRow>(
    primary.map((r) => [r.slug, { ...r, aliases: [...(r.aliases ?? [])] }]),
  );

  for (const row of playlistPro) {
    const prev = bySlug.get(row.slug);
    if (!prev) {
      bySlug.set(row.slug, { ...row, aliases: [...(row.aliases ?? [])] });
      continue;
    }
    const merged = new Set([...(prev.aliases ?? []), ...(row.aliases ?? [])]);
    const le = row.labelEn.trim();
    if (le) merged.add(le);
    prev.aliases = [...merged];
    const desc = [prev.descriptionAi, row.descriptionAi].filter(Boolean);
    if (desc.length) prev.descriptionAi = [...new Set(desc)].join(" | ");
  }

  const out = [...bySlug.values()];
  console.info(`[music-taxonomy seed] Combined primary + Playlist Pro PDF: ${out.length} rows`);
  return out;
}

export function loadMusicTaxonomySeedRowsFromDisk(): MusicTaxonomySeedRow[] {
  const primary = loadPrimaryMusicTaxonomySeedRowsFromDisk();
  const playlistPro = loadPlaylistProEnrichmentRowsFromDisk();
  return mergePlaylistProEnrichment(primary, playlistPro);
}

/** Append Playlist Pro vendor strings onto canonical taxonomy tags (Excel canonical slugs). */
async function applyPlaylistProAliasMergesFromConfig(): Promise<number> {
  let applied = 0;
  const entries = getPlaylistProAliasMergeEntries();
  for (const { labelEn, targetSlug } of entries) {
    const tag = await prisma.musicTaxonomyTag.findUnique({
      where: { slug: targetSlug },
      select: { slug: true, aliases: true },
    });
    if (!tag) {
      console.warn(
        `[playlist-pro alias merge] Missing target slug "${targetSlug}" for label "${labelEn}" — skipping`,
      );
      continue;
    }
    const next = new Set(tag.aliases);
    next.add(labelEn);
    await prisma.musicTaxonomyTag.update({
      where: { slug: targetSlug },
      data: { aliases: [...next] },
    });
    applied += 1;
  }
  console.info(
    `[music-taxonomy seed] Playlist Pro alias merges applied: ${applied}/${entries.length}`,
  );
  return applied;
}

/**
 * Seed by slug: **creates** use seed rows for status (usually ACTIVE); **updates** refresh vocabulary only
 * (`category`, labels, descriptions, aliases, `sortOrder`) and never overwrite admin lifecycle fields
 * (`status`, `mergedIntoId`). Parent links from seed apply only when `parentSlug` is set (omit otherwise
 * so DB parent is preserved). Merge targets are not driven by seed JSON — only Stage 3 duplicate cleanup
 * sets `mergedIntoId`.
 *
 * Uses individual statements (no long interactive `$transaction`). Safe against Railway / remote Postgres
 * interactive-transaction timeouts (Prisma P2028).
 */
export async function runMusicTaxonomySeed(
  rows?: MusicTaxonomySeedRow[],
): Promise<{
  upserted: number;
  playlistProAliasesMerged: number;
  defaultDuplicatePairsMerged: number;
}> {
  const source = rows ?? loadMusicTaxonomySeedRowsFromDisk();
  const sorted = [...source].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  const seedSlugs = sorted.map((r) => r.slug);
  const existingSlugSet = new Set(
    (
      await prisma.musicTaxonomyTag.findMany({
        where: { slug: { in: seedSlugs } },
        select: { slug: true },
      })
    ).map((t) => t.slug),
  );

  for (const row of sorted) {
    const category = row.category as MusicTaxonomyCategory;
    const status = (row.status ?? "ACTIVE") as MusicTaxonomyTagStatus;

    const contentData = {
      category,
      labelEn: row.labelEn,
      labelHe: row.labelHe,
      descriptionHeUser: row.descriptionHeUser ?? null,
      descriptionAi: row.descriptionAi ?? null,
      aliases: row.aliases ?? [],
      sortOrder: row.sortOrder ?? 0,
    };

    if (!existingSlugSet.has(row.slug)) {
      await prisma.musicTaxonomyTag.create({
        data: {
          slug: row.slug,
          ...contentData,
          status,
          parentId: null,
          mergedIntoId: null,
        },
      });
      existingSlugSet.add(row.slug);
    } else {
      await prisma.musicTaxonomyTag.update({
        where: { slug: row.slug },
        data: contentData,
      });
    }
  }

  const idBySlug = new Map(
    (await prisma.musicTaxonomyTag.findMany({ select: { id: true, slug: true } })).map((t) => [
      t.slug,
      t.id,
    ]),
  );

  for (const row of sorted) {
    if (!row.parentSlug) continue;

    const parentId = idBySlug.get(row.parentSlug) ?? null;
    if (!parentId) {
      console.warn(`[music-taxonomy seed] Unknown parentSlug "${row.parentSlug}" for ${row.slug}`);
      continue;
    }

    await prisma.musicTaxonomyTag.update({
      where: { slug: row.slug },
      data: { parentId },
    });
  }

  let defaultDuplicatePairsMerged = 0;
  if (rows === undefined) {
    const mergeResult = await applyMusicTaxonomyStage3DefaultDuplicateMerges();
    defaultDuplicatePairsMerged = mergeResult.merged;
  }

  const playlistProAliasesMerged =
    rows === undefined ? await applyPlaylistProAliasMergesFromConfig() : 0;

  return {
    upserted: sorted.length,
    playlistProAliasesMerged,
    defaultDuplicatePairsMerged,
  };
}
