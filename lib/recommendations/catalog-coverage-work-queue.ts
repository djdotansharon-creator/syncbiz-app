/**
 * Stage 7.2 — Editor work queue derived from Music Programming coverage packs (read-only).
 */

import type { CatalogCoverageTargetPack, CatalogCoverageTargetsBundle } from "./catalog-coverage-targets.types";
import {
  catalogItemUrlShape,
  generateCatalogCoverageHealthReport,
  getPackLooseMatchingItems,
  inferCatalogItemUrlType,
  isStrictPackMatch,
  listMissingPackTagDimensions,
  manualEnergyInPackRange,
  type CatalogItemRowForHealth,
  type CatalogCoverageHealthReport,
  type PackTagDimension,
} from "./catalog-coverage-health";

export type EditorTaskKind = "tagging" | "metadata" | "content";

export type EditorWorkTask = {
  kind: EditorTaskKind;
  /** Lower = higher priority */
  priority: number;
  summary: string;
  detail?: string;
};

export type EditorWorkCandidateRow = {
  catalogItemId: string;
  title: string;
  url: string;
  currentTags: string[];
  missingTagDimensions: PackTagDimension[];
  missingTagHints: { dimension: PackTagDimension; suggestedSlugs: string[] }[];
  hasManualEnergy: boolean;
  energyInTargetRange: boolean;
  needsEnergyAttention: boolean;
  hasBasicMetadata: boolean;
  urlShape: "SINGLE" | "SET_MIX" | "OTHER";
  inferredUrlType: string | null;
  suggestedEditorAction: string;
};

export type PackEditorWorkQueue = {
  packId: string;
  labelEn: string;
  labelHe: string;
  healthSummary: string;
  taggingTasks: EditorWorkTask[];
  metadataTasks: EditorWorkTask[];
  contentAcquisitionTasks: EditorWorkTask[];
  candidates: EditorWorkCandidateRow[];
};

export type CatalogEditorWorkQueueReport = {
  generatedAt: string;
  catalogItemCountActive: number;
  healthReport: CatalogCoverageHealthReport;
  packs: PackEditorWorkQueue[];
};

export type CatalogItemRowForWorkQueue = CatalogItemRowForHealth & {
  id: string;
  title: string;
};

function itemSlugSet(item: CatalogItemRowForHealth): Set<string> {
  return new Set(item.taxonomyLinks.map((l) => l.taxonomyTag.slug));
}

function intersectsSlugs(item: CatalogItemRowForHealth, slugs: string[]): boolean {
  if (slugs.length === 0) return false;
  const s = itemSlugSet(item);
  return slugs.some((x) => s.has(x));
}

function hasBasicMetadata(item: CatalogItemRowForHealth): boolean {
  return (item.thumbnail ?? "").trim().length > 0 || (item.durationSec ?? 0) > 0;
}

function energyNeedsAttention(
  item: CatalogItemRowForHealth,
  pack: CatalogCoverageTargetPack,
): { inRange: boolean; needs: boolean } {
  if (pack.targetEnergyMin == null || pack.targetEnergyMax == null) {
    return { inRange: false, needs: false };
  }
  const r = item.manualEnergyRating;
  if (r == null) return { inRange: false, needs: true };
  const ok = manualEnergyInPackRange(r, pack.targetEnergyMin, pack.targetEnergyMax);
  return { inRange: ok, needs: !ok };
}

function buildSuggestedAction(
  missing: { dimension: PackTagDimension; suggestedSlugs: string[] }[],
  needsEnergy: boolean,
  pack: CatalogCoverageTargetPack,
  hasMeta: boolean,
  urlShape: string,
  inferred: string | null,
): string {
  const parts: string[] = [];
  for (const m of missing) {
    const slugs = m.suggestedSlugs.slice(0, 5).join(", ");
    parts.push(`Tag ${m.dimension} (pick from: ${slugs}${m.suggestedSlugs.length > 5 ? "…" : ""})`);
  }
  if (needsEnergy && pack.targetEnergyMin != null && pack.targetEnergyMax != null) {
    parts.push(`Set manualEnergyRating within ${pack.targetEnergyMin}–${pack.targetEnergyMax} (DB scale 1–10).`);
  }
  if (!hasMeta) {
    parts.push("Refresh provider metadata (durationSec, thumbnail) via workbench / Stage 5.9 snapshot.");
  }
  if (inferred == null) {
    parts.push("Confirm provider / URL type on the row.");
  }
  if (urlShape === "OTHER") {
    parts.push("Verify URL shape (single vs playlist/mix) for programming fit.");
  }
  return parts.length > 0 ? parts.join(" · ") : "No automated gaps — spot-check pack fit.";
}

export function generateCatalogEditorWorkQueueReport(
  bundle: CatalogCoverageTargetsBundle,
  itemsInput: CatalogItemRowForWorkQueue[],
  opts?: { candidateLimit?: number },
): CatalogEditorWorkQueueReport {
  const candidateLimit = opts?.candidateLimit ?? 15;
  const baseItems: CatalogItemRowForHealth[] = itemsInput;
  const healthReport = generateCatalogCoverageHealthReport(bundle, baseItems);
  const activeItems = itemsInput.filter((i) => i.archivedAt == null);

  const packsOut: PackEditorWorkQueue[] = [];

  for (const pack of bundle.packs.filter((p) => p.active)) {
    const hr = healthReport.packs.find((x) => x.packId === pack.id);
    const loose = getPackLooseMatchingItems(pack, activeItems);
    const nonStrict = loose.filter((i) => !isStrictPackMatch(i, pack));

    const taggingTasks: EditorWorkTask[] = [];
    let pri = 1;

    const dimAdd = (
      label: string,
      slugs: string[],
      count: number,
      extra?: string,
    ) => {
      if (slugs.length === 0 || count <= 0) return;
      taggingTasks.push({
        kind: "tagging",
        priority: pri++,
        summary: `${label} on ${count} loose-matching candidate(s) for pack “${pack.labelEn}” (${pack.id}).`,
        detail: `Choose from slugs: ${slugs.join(", ")}.${extra ? ` ${extra}` : ""}`,
      });
    };

    if (pack.genreTags.length > 0) {
      const n = loose.filter((i) => !intersectsSlugs(i, pack.genreTags)).length;
      dimAdd("Add Main Sound (genre) tags", pack.genreTags, n);
    }
    if (pack.styleTags.length > 0) {
      const n = loose.filter((i) => !intersectsSlugs(i, pack.styleTags)).length;
      dimAdd("Add Style tags", pack.styleTags, n);
    }
    if (pack.businessFitTags.length > 0) {
      const n = loose.filter((i) => !intersectsSlugs(i, pack.businessFitTags)).length;
      dimAdd("Add Business Fit tags", pack.businessFitTags, n);
    }
    if (pack.daypartTags.length > 0) {
      const n = loose.filter((i) => !intersectsSlugs(i, pack.daypartTags)).length;
      dimAdd("Add Daypart Fit tags", pack.daypartTags, n);
    }
    if (pack.vibeTags.length > 0) {
      const n = loose.filter((i) => !intersectsSlugs(i, pack.vibeTags)).length;
      dimAdd("Add Vibe/Energy tags", pack.vibeTags, n);
    }
    if (pack.catalogProgrammingTags.length > 0) {
      const n = loose.filter((i) => !intersectsSlugs(i, pack.catalogProgrammingTags)).length;
      dimAdd("Add Catalog Programming tags", pack.catalogProgrammingTags, n);
    }

    const energyNeedCount = loose.filter((i) => energyNeedsAttention(i, pack).needs).length;
    if (energyNeedCount > 0 && pack.targetEnergyMin != null && pack.targetEnergyMax != null) {
      taggingTasks.push({
        kind: "tagging",
        priority: pri++,
        summary: `Set manualEnergyRating for ${energyNeedCount} item(s) in loose pool — target band ${pack.targetEnergyMin}–${pack.targetEnergyMax} (1–10 field).`,
        detail: "Unset or out-of-band ratings break energy coverage for this pack.",
      });
    }
    taggingTasks.sort((a, b) => a.priority - b.priority);

    const metadataTasks: EditorWorkTask[] = [];
    let mp = 1;
    const noDur = loose.filter((i) => i.durationSec == null || i.durationSec <= 0).length;
    if (noDur > 0) {
      metadataTasks.push({
        kind: "metadata",
        priority: mp++,
        summary: `Refresh source metadata / durationSec for ${noDur} loose-matching item(s) (${pack.id}).`,
        detail: "Stage 5.9 snapshots or manual edit in catalog workbench.",
      });
    }
    const noThumb = loose.filter((i) => !(i.thumbnail ?? "").trim()).length;
    if (noThumb > 0) {
      metadataTasks.push({
        kind: "metadata",
        priority: mp++,
        summary: `Add or fetch thumbnails for ${noThumb} item(s) lacking cover art (${pack.id}).`,
      });
    }
    const unknownUrlType = loose.filter((i) => inferCatalogItemUrlType(i.url, i.provider) == null).length;
    if (unknownUrlType > 0) {
      metadataTasks.push({
        kind: "metadata",
        priority: mp++,
        summary: `Classify / normalize provider metadata for ${unknownUrlType} item(s) with ambiguous URL type (${pack.id}).`,
      });
    }

    const contentAcquisitionTasks: EditorWorkTask[] = [];
    let cp = 1;
    const gapMin = Math.max(0, pack.targetMinimumItems - loose.length);
    const gapMix =
      pack.targetSetMixCount != null ? Math.max(0, pack.targetSetMixCount - (hr?.setMixCount ?? 0)) : 0;
    const gapSingle =
      pack.targetSingleCount != null ? Math.max(0, pack.targetSingleCount - (hr?.singleCount ?? 0)) : 0;

    if (gapMix > 0) {
      contentAcquisitionTasks.push({
        kind: "content",
        priority: cp++,
        summary: `Add up to ${gapMix} SET_MIX catalog URL(s) (mixes / external playlists) for “${pack.labelEn}”.`,
        detail: "YouTube list=RD…, Spotify/SoundCloud sets, etc. — import via normal catalog flow (no auto-add here).",
      });
    }
    if (gapSingle > 0) {
      contentAcquisitionTasks.push({
        kind: "content",
        priority: cp++,
        summary: `Add up to ${gapSingle} SINGLE-track catalog URL(s) if singles target still short for “${pack.labelEn}”.`,
      });
    }
    if (gapMin > 0) {
      contentAcquisitionTasks.push({
        kind: "content",
        priority: cp++,
        summary: `Grow inventory by up to ${gapMin} catalog item(s) to reach pack minimum (${pack.targetMinimumItems} total).`,
      });
    }
    const flavor = [...pack.styleTags, ...pack.genreTags].filter(Boolean).slice(0, 5).join(", ");
    if (flavor) {
      contentAcquisitionTasks.push({
        kind: "content",
        priority: 9,
        summary: `Editorial acquisition hints: ${flavor}.`,
        detail: "Use when sourcing new URLs manually; does not auto-tag or auto-import.",
      });
    }

    nonStrict.sort((a, b) => {
      const ma = listMissingPackTagDimensions(a, pack).length;
      const mb = listMissingPackTagDimensions(b, pack).length;
      if (ma !== mb) return ma - mb;
      const metaA = hasBasicMetadata(a) ? 1 : 0;
      const metaB = hasBasicMetadata(b) ? 1 : 0;
      if (metaA !== metaB) return metaB - metaA;
      const ea = energyNeedsAttention(a, pack).needs ? 1 : 0;
      const eb = energyNeedsAttention(b, pack).needs ? 1 : 0;
      return eb - ea;
    });

    const candidates: EditorWorkCandidateRow[] = [];
    for (const raw of nonStrict.slice(0, candidateLimit)) {
      const row = raw as CatalogItemRowForWorkQueue;
      const missingDims = listMissingPackTagDimensions(raw, pack);
      const inferred = inferCatalogItemUrlType(raw.url, raw.provider);
      const urlShape = catalogItemUrlShape(raw.url, raw.provider);
      const tagSlugs = [...itemSlugSet(raw)].sort();
      const en = energyNeedsAttention(raw, pack);
      const meta = hasBasicMetadata(raw);
      candidates.push({
        catalogItemId: row.id,
        title: row.title,
        url: raw.url,
        currentTags: tagSlugs,
        missingTagDimensions: missingDims.map((m) => m.dimension),
        missingTagHints: missingDims,
        hasManualEnergy: raw.manualEnergyRating != null,
        energyInTargetRange: en.inRange,
        needsEnergyAttention: en.needs,
        hasBasicMetadata: meta,
        urlShape,
        inferredUrlType: inferred,
        suggestedEditorAction: buildSuggestedAction(missingDims, en.needs, pack, meta, urlShape, inferred),
      });
    }

    const healthSummary = hr
      ? `Health ${hr.healthStatus.toUpperCase()}; loose ${hr.totalMatching}/${hr.targetMinimumItems}; strict ${hr.strictAllDeclaredDimensionsCount}; SET_MIX ${hr.setMixCount}/${hr.targetSetMixCount ?? "—"}.`
      : "(no health row)";

    packsOut.push({
      packId: pack.id,
      labelEn: pack.labelEn,
      labelHe: pack.labelHe,
      healthSummary,
      taggingTasks,
      metadataTasks,
      contentAcquisitionTasks,
      candidates,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    catalogItemCountActive: activeItems.length,
    healthReport,
    packs: packsOut,
  };
}

export function formatEditorWorkQueueConsole(report: CatalogEditorWorkQueueReport): string {
  const lines: string[] = [];
  lines.push(`Catalog editor work queue — ${report.generatedAt}`);
  lines.push(`Active catalog items: ${report.catalogItemCountActive}`);
  lines.push("");
  for (const p of report.packs) {
    lines.push(`━━ ${p.packId} — ${p.labelEn} ━━`);
    lines.push(`  ${p.healthSummary}`);
    lines.push("  ── Tagging tasks");
    for (const t of p.taggingTasks) {
      lines.push(`    [${t.priority}] ${t.summary}`);
      if (t.detail) lines.push(`        → ${t.detail}`);
    }
    if (p.taggingTasks.length === 0) lines.push("    (none)");
    lines.push("  ── Metadata tasks");
    for (const t of p.metadataTasks) {
      lines.push(`    [${t.priority}] ${t.summary}`);
      if (t.detail) lines.push(`        → ${t.detail}`);
    }
    if (p.metadataTasks.length === 0) lines.push("    (none)");
    lines.push("  ── Content acquisition tasks");
    for (const t of p.contentAcquisitionTasks) {
      lines.push(`    [${t.priority}] ${t.summary}`);
      if (t.detail) lines.push(`        → ${t.detail}`);
    }
    if (p.contentAcquisitionTasks.length === 0) lines.push("    (none)");
    lines.push("  ── Close candidates (loose, not strict)");
    for (const c of p.candidates) {
      lines.push(
        `    • ${c.catalogItemId} — ${c.title.slice(0, 72)}${c.title.length > 72 ? "…" : ""}`,
      );
      lines.push(`      url: ${c.url.slice(0, 96)}${c.url.length > 96 ? "…" : ""}`);
      lines.push(`      tags: ${c.currentTags.slice(0, 12).join(", ")}${c.currentTags.length > 12 ? "…" : ""}`);
      lines.push(`      missing dims: ${c.missingTagDimensions.join(", ") || "—"}`);
      lines.push(
        `      energy: ${c.hasManualEnergy ? "set" : "none"}${c.needsEnergyAttention ? " (needs band)" : ""}; meta: ${c.hasBasicMetadata ? "ok" : "thin"}; url: ${c.inferredUrlType ?? "?"}/${c.urlShape}`,
      );
      lines.push(`      → ${c.suggestedEditorAction}`);
    }
    if (p.candidates.length === 0) lines.push("    (none — add loose matches or tagging to surface candidates)");
    lines.push("");
  }
  return lines.join("\n");
}
