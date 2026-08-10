/**
 * Music Library Metadata — the single-screen model that replaces daily Excel juggling.
 *
 * CARDINAL RULE (owner directive): music files are READ-ONLY, ALWAYS.
 *   music file  ──read──▶  Layer A (Original, LOCKED)              [one-way mirror]
 *   operator    ──edit──▶  Layer B (SyncBiz Enrichment, Postgres)  [never touches files]
 * Nothing in this module ever opens a music file for writing, renames, or emits an ID3/tag
 * write. Layer A is filled ONLY by a refresh that READS files. Layer B lives only in Postgres.
 *
 * Two layers, merged for display:
 *   A) Original MP3 metadata — locked, read-only mirror (title/artists/album/genres/year/bpm/
 *      originalComments[]/rating/isrc/customTags/filename/metadataHash/availability/lastReadAt).
 *   B) SyncBiz enrichment — editable (myComment/myTags/overrides/manualSelected/scope/…/customFields).
 */
import type { PrismaClient, LocalTrackFile, TrackEnrichment, EnrichmentScope, CustomFieldDefinition } from "@prisma/client";
import { createHash } from "node:crypto";

// ── Token logic (mirrors desktop/scripts/build-general-tags.mjs, owner-approved rules) ──
const str = (v: unknown): string => (v == null ? "" : String(v));
/** split by "|" ONLY → keeps compound tokens whole ("R&B", "Disco & Soul"). */
export const segmentTokens = (c: unknown): string[] => str(c).split("|").map((t) => t.trim()).filter(Boolean);
/** fine split → detects SELECTED even inside "ANGELINA-SELECTED". */
export const selectedTokens = (c: unknown): string[] => str(c).split(/[|,;\s\-/]+/).map((t) => t.trim()).filter(Boolean);
export const isSelectedComment = (c: unknown): boolean => selectedTokens(c).some((t) => t.toUpperCase() === "SELECTED");

/** Original comments preserved separately; a display-only join. Never a source of truth. */
export const deriveDisplayComment = (originalComments: string[]): string =>
  (originalComments ?? []).map((c) => str(c).trim()).filter(Boolean).join("  ·  ");

/** SELECTED from the ORIGINAL file (any comment frame), independent of enrichment. */
export const originalSelected = (originalComments: string[]): boolean =>
  (originalComments ?? []).some((c) => isSelectedComment(c));

/** Effective SELECTED: manual override wins, else the original file's own SELECTED. */
export function effectiveSelected(originalComments: string[], manualSelected: boolean | null | undefined): boolean {
  if (manualSelected === true) return true;
  if (manualSelected === false) return false;
  return originalSelected(originalComments);
}

// ── Possible-Typo detection (SELECTES → SELECTED). NEVER auto-applied, NEVER edits a comment. ──
const KNOWN_TYPOS: Record<string, string> = { SELECTES: "SELECTED", SELECTD: "SELECTED", SELCTED: "SELECTED", SELECED: "SELECTED", SEELCTED: "SELECTED" };
function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}

export interface TypoHit { rawToken: string; suggestedMeaning: string; category: "possible_typo"; confidence: string }

/** Flag tokens that look like a typo of SELECTED (or a known typo) — for a REVIEW queue only. */
export function detectTypoTokens(originalComments: string[]): TypoHit[] {
  const hits = new Map<string, TypoHit>();
  for (const comment of originalComments ?? []) {
    for (const tok of selectedTokens(comment)) {
      const up = tok.toUpperCase();
      if (up === "SELECTED") continue; // correct spelling — not a typo
      if (KNOWN_TYPOS[up]) { hits.set(up, { rawToken: tok, suggestedMeaning: KNOWN_TYPOS[up], category: "possible_typo", confidence: "possible typo" }); continue; }
      // near-miss to SELECTED, but not a substring/superset that changes meaning
      if (up.length >= 6 && up.length <= 9 && editDistance(up, "SELECTED") <= 2 && up !== "SELECT") {
        hits.set(up, { rawToken: tok, suggestedMeaning: "SELECTED", category: "possible_typo", confidence: "possible typo" });
      }
    }
  }
  return [...hits.values()];
}

// ── Metadata hash of the ORIGINAL layer (change detection for refresh). ──
export interface OriginalRead {
  localRef: string; filename: string; fileSize?: number | null; modifiedAt?: Date | null;
  originalTitle?: string | null; originalArtists?: string[]; originalAlbum?: string | null;
  originalGenres?: string[]; originalYear?: number | null; originalBpm?: number | null;
  originalComments?: string[]; originalRating?: number | null; originalIsrc?: string[];
  originalCustomTags?: Record<string, unknown> | null;
}

/** Order-independent representation of custom tags — Postgres jsonb does NOT preserve key order,
 *  so the hash must not depend on it (otherwise a round-trip looks like a change). */
function canonicalTags(x: Record<string, unknown> | null | undefined): string | null {
  if (!x || typeof x !== "object") return null;
  const keys = Object.keys(x).sort();
  if (keys.length === 0) return null;
  return JSON.stringify(keys.map((k) => [k, str((x as Record<string, unknown>)[k])]));
}

export function computeMetadataHash(r: OriginalRead): string {
  const norm = {
    t: str(r.originalTitle).trim(), a: (r.originalArtists ?? []).map((x) => str(x).trim()),
    al: str(r.originalAlbum).trim(), g: (r.originalGenres ?? []).map((x) => str(x).trim()),
    y: r.originalYear ?? null, b: r.originalBpm ?? null,
    c: (r.originalComments ?? []).map((x) => str(x).trim()), r: r.originalRating ?? null,
    i: (r.originalIsrc ?? []).map((x) => str(x).trim()), x: canonicalTags(r.originalCustomTags),
  };
  return createHash("sha256").update(JSON.stringify(norm)).digest("hex");
}

const looksLikePath = (s: string): boolean => /[\\]|^[a-zA-Z]:|^\//.test(s);

// ── Refresh From Music Bank: one-way MP3 → Layer A. Preview then Apply. ──
export interface RefreshPlan {
  musicFilesRead: number;
  created: string[]; updated: string[]; unchanged: string[]; missing: string[];
  /** Postgres rows that would change (new + Layer-A updates + availability→missing). */
  syncbizDbChangesProposed: number;
  enrichmentPreserved: number;
  /** INVARIANT — always 0. Refresh never writes a music file. */
  musicFilesModified: 0;
  wouldWriteFiles: false;
}

/** The ONLY columns a refresh Apply may write. Enrichment (Layer B) is NOT here. */
const REFRESH_WRITABLE_COLUMNS = new Set([
  "filename", "fileSize", "modifiedAt", "metadataHash", "availability", "status", "lastReadAt",
  "originalTitle", "originalArtists", "originalAlbum", "originalGenres", "originalYear", "originalBpm",
  "originalComments", "displayComment", "originalRating", "originalIsrc", "originalCustomTags",
]);
function assertRefreshWritesLayerAOnly(data: Record<string, unknown>) {
  for (const k of Object.keys(data))
    if (!REFRESH_WRITABLE_COLUMNS.has(k)) throw new Error(`refuse: refresh may not write "${k}" (enrichment is never touched by refresh)`);
}

/**
 * Compute (and optionally apply) a refresh of Layer A for a source from freshly-read files.
 * NEVER deletes tracks or enrichment; vanished files are only marked availability="missing".
 * Layer B (TrackEnrichment) is never read or modified here.
 */
export async function refreshFromBank(
  prisma: PrismaClient, sourceId: string, reads: OriginalRead[], opts: { apply: boolean },
): Promise<RefreshPlan> {
  for (const r of reads) if (looksLikePath(r.localRef)) throw new Error("refuse: localRef looks like a filesystem path");

  const existing = await prisma.localTrackFile.findMany({ where: { sourceId }, select: { id: true, localRef: true, metadataHash: true } });
  const byRef = new Map(existing.map((e) => [e.localRef, e]));
  const incomingRefs = new Set(reads.map((r) => r.localRef));

  const plan: RefreshPlan = {
    musicFilesRead: reads.length, created: [], updated: [], unchanged: [], missing: [],
    syncbizDbChangesProposed: 0, enrichmentPreserved: 0, musicFilesModified: 0, wouldWriteFiles: false,
  };

  for (const r of reads) {
    const hash = computeMetadataHash(r);
    const prev = byRef.get(r.localRef);
    const data = {
      filename: r.filename, fileSize: r.fileSize ?? null, modifiedAt: r.modifiedAt ?? null,
      metadataHash: hash, availability: "available", status: "available", lastReadAt: new Date(),
      originalTitle: r.originalTitle ?? null, originalArtists: r.originalArtists ?? [], originalAlbum: r.originalAlbum ?? null,
      originalGenres: r.originalGenres ?? [], originalYear: r.originalYear ?? null, originalBpm: r.originalBpm ?? null,
      originalComments: r.originalComments ?? [], displayComment: deriveDisplayComment(r.originalComments ?? []),
      originalRating: r.originalRating ?? null, originalIsrc: r.originalIsrc ?? [],
      originalCustomTags: (r.originalCustomTags ?? null) as never,
    };
    assertRefreshWritesLayerAOnly(data); // hard guard: refresh writes Layer A only, never enrichment
    if (!prev) {
      plan.created.push(r.localRef);
      if (opts.apply) await prisma.localTrackFile.create({ data: { sourceId, localRef: r.localRef, ...data } });
    } else if (prev.metadataHash !== hash) {
      plan.updated.push(r.localRef);
      // Layer A only — TrackEnrichment untouched (separate table, not in this update).
      if (opts.apply) await prisma.localTrackFile.update({ where: { id: prev.id }, data });
    } else {
      plan.unchanged.push(r.localRef);
      if (opts.apply) await prisma.localTrackFile.update({ where: { id: prev.id }, data: { availability: "available", status: "available", lastReadAt: new Date() } });
    }
  }

  for (const e of existing) {
    if (!incomingRefs.has(e.localRef)) {
      plan.missing.push(e.localRef);
      if (opts.apply) await prisma.localTrackFile.update({ where: { id: e.id }, data: { availability: "missing", status: "missing" } });
    }
  }

  // enrichment is fully preserved — count rows still attached to affected files
  plan.enrichmentPreserved = await prisma.trackEnrichment.count({ where: { localFile: { sourceId } } });
  plan.syncbizDbChangesProposed = plan.created.length + plan.updated.length + plan.missing.length;
  return plan;
}

// ── Save enrichment (Layer B only). Never touches Layer A or any music file. ──
export type EnrichmentPatch = Partial<{
  myComment: string | null; myTags: string[]; genreOverride: string | null; bpmOverride: number | null;
  ratingOverride: number | null; manualSelected: boolean | null; scope: EnrichmentScope;
  mood: string | null; energy: string | null; familiarity: string | null; businessType: string | null;
  daypart: string | null; clientEvent: string | null; includeInGeneralDjCreator: boolean;
  notes: string | null; customFields: Record<string, unknown> | null;
}>;

const ORIGINAL_KEYS = new Set(["originalTitle", "originalArtists", "originalAlbum", "originalGenres", "originalYear", "originalBpm", "originalComments", "originalRating", "originalIsrc", "originalCustomTags", "filename", "metadataHash", "availability", "lastReadAt"]);

export async function saveEnrichment(prisma: PrismaClient, localFileId: string, patch: EnrichmentPatch): Promise<TrackEnrichment> {
  for (const k of Object.keys(patch)) if (ORIGINAL_KEYS.has(k)) throw new Error(`refuse: "${k}" is a LOCKED Original (Layer A) field and cannot be edited`);
  const data = { ...patch, customFields: (patch.customFields ?? undefined) as never };
  return prisma.trackEnrichment.upsert({
    where: { localFileId },
    create: { localFileId, ...data },
    update: data,
  });
}

// ── Merged read model for the screen (Layer A + Layer B + effective/derived) ──
export interface MetadataRow {
  id: string; localRef: string; filename: string; availability: string;
  original: {
    title: string | null; artists: string[]; album: string | null; genres: string[];
    year: number | null; bpm: number | null; comments: string[]; displayComment: string;
    rating: number | null; isrc: string[]; customTags: Record<string, unknown> | null;
    metadataHash: string | null; lastReadAt: Date; locked: true;
  };
  enrichment: TrackEnrichment | null;
  effective: { selected: boolean; genre: string | null; bpm: number | null; rating: number | null };
  scope: EnrichmentScope | "REVIEW";
  hasComment: boolean; hasManualEnrichment: boolean; possibleTypos: TypoHit[];
}

export interface MetadataFilters {
  search?: string; originalGenre?: string; effectiveGenre?: string;
  selected?: boolean; scope?: EnrichmentScope; year?: number; minBpm?: number; maxBpm?: number;
  availability?: "available" | "missing"; hasComment?: boolean; hasManualEnrichment?: boolean; possibleTypo?: boolean;
}

function toRow(f: LocalTrackFile & { enrichment: TrackEnrichment | null }): MetadataRow {
  const e = f.enrichment;
  const comments = f.originalComments ?? [];
  const eff = {
    selected: effectiveSelected(comments, e?.manualSelected),
    genre: e?.genreOverride ?? (f.originalGenres?.[0] ?? null),
    bpm: e?.bpmOverride ?? f.originalBpm ?? null,
    rating: e?.ratingOverride ?? f.originalRating ?? null,
  };
  const hasManual = !!e && (
    !!e.myComment || (e.myTags?.length ?? 0) > 0 || e.genreOverride != null || e.bpmOverride != null ||
    e.ratingOverride != null || e.manualSelected != null || e.scope !== "REVIEW" || !!e.mood || !!e.energy ||
    !!e.familiarity || !!e.businessType || !!e.daypart || !!e.clientEvent || e.includeInGeneralDjCreator ||
    !!e.notes || (e.customFields != null && Object.keys(e.customFields as object).length > 0)
  );
  return {
    id: f.id, localRef: f.localRef, filename: f.filename, availability: f.availability,
    original: {
      title: f.originalTitle, artists: f.originalArtists ?? [], album: f.originalAlbum, genres: f.originalGenres ?? [],
      year: f.originalYear, bpm: f.originalBpm, comments, displayComment: f.displayComment ?? deriveDisplayComment(comments),
      rating: f.originalRating, isrc: f.originalIsrc ?? [], customTags: (f.originalCustomTags as Record<string, unknown> | null) ?? null,
      metadataHash: f.metadataHash, lastReadAt: f.lastReadAt, locked: true,
    },
    enrichment: e,
    effective: eff,
    scope: e?.scope ?? "REVIEW",
    hasComment: comments.length > 0 || !!e?.myComment,
    hasManualEnrichment: hasManual,
    possibleTypos: detectTypoTokens(comments),
  };
}

function matches(row: MetadataRow, f: MetadataFilters): boolean {
  if (f.search) {
    const q = f.search.toLowerCase();
    const hay = [row.original.title, row.original.artists.join(" "), row.filename, row.original.displayComment, row.enrichment?.myComment, row.effective.genre, (row.enrichment?.myTags ?? []).join(" ")].map((x) => str(x).toLowerCase()).join("  ");
    if (!hay.includes(q)) return false;
  }
  if (f.originalGenre && !(row.original.genres.some((g) => g.toLowerCase() === f.originalGenre!.toLowerCase()))) return false;
  if (f.effectiveGenre && str(row.effective.genre).toLowerCase() !== f.effectiveGenre.toLowerCase()) return false;
  if (f.selected != null && row.effective.selected !== f.selected) return false;
  if (f.scope && row.scope !== f.scope) return false;
  if (f.year != null && row.original.year !== f.year) return false;
  if (f.minBpm != null && !(row.effective.bpm != null && row.effective.bpm >= f.minBpm)) return false;
  if (f.maxBpm != null && !(row.effective.bpm != null && row.effective.bpm <= f.maxBpm)) return false;
  if (f.availability && row.availability !== f.availability) return false;
  if (f.hasComment != null && row.hasComment !== f.hasComment) return false;
  if (f.hasManualEnrichment != null && row.hasManualEnrichment !== f.hasManualEnrichment) return false;
  if (f.possibleTypo != null && (row.possibleTypos.length > 0) !== f.possibleTypo) return false;
  return true;
}

export async function listMusicLibraryMetadata(
  prisma: PrismaClient, sourceId: string, filters: MetadataFilters = {},
): Promise<{ rows: MetadataRow[]; customFields: CustomFieldDefinition[]; total: number }> {
  const [files, customFields] = await Promise.all([
    prisma.localTrackFile.findMany({ where: { sourceId }, include: { enrichment: true }, orderBy: { filename: "asc" } }),
    prisma.customFieldDefinition.findMany({ where: { active: true }, orderBy: { displayOrder: "asc" } }),
  ]);
  const rows = files.map(toRow).filter((r) => matches(r, filters));
  return { rows, customFields, total: files.length };
}
