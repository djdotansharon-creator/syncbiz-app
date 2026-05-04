/**
 * Stage 7.1 — Read-only coverage health metrics for Music Programming Coverage packs.
 * Uses live CatalogItem + taxonomy links; does not mutate data or scoring.
 */

import { classifyResolveFoundation } from "@/lib/url-resolve-classify";
import type { CatalogCoverageTargetPack, CatalogCoverageTargetsBundle } from "./catalog-coverage-targets.types";
import type { CatalogCoverageUrlType } from "./catalog-coverage-targets.types";

export type CatalogUrlShape = "SINGLE" | "SET_MIX" | "OTHER";

export type CoverageHealthDimensionKey =
  | "genre"
  | "style"
  | "businessFit"
  | "daypart"
  | "vibe"
  | "energy"
  | "urlType"
  | "metadata";

export type CoveragePackHealthStatus = "healthy" | "weak" | "critical";

export type PackCoverageHealthRow = {
  packId: string;
  labelEn: string;
  labelHe: string;
  /** Items: not archived, pass avoid + URL allowlist, overlap pack tag union (any dimension). */
  totalMatching: number;
  /** Among totalMatching: ≥1 linked slug in pack.genreTags (skipped if pack has no genre tags). */
  withGenreTags: number | null;
  withStyleTags: number | null;
  withBusinessFitTags: number | null;
  withDaypartTags: number | null;
  withVibeTags: number | null;
  /** manualEnergyRating within pack target band (1–10 field vs 0–10 pack targets). */
  withEnergyInTargetRange: number;
  missingManualEnergyRating: number;
  singleCount: number;
  setMixCount: number;
  otherUrlShapeCount: number;
  itemsWithThumbnail: number;
  itemsWithDurationSec: number;
  /** max(thumbnail, duration) coverage for “metadata present”. */
  itemsWithBasicMetadata: number;
  targetMinimumItems: number;
  targetSingleCount: number | null;
  targetSetMixCount: number | null;
  gapMinimumItems: number;
  gapSingle: number | null;
  gapSetMix: number | null;
  healthStatus: CoveragePackHealthStatus;
  topMissingDimensions: CoverageHealthDimensionKey[];
  recommendedEditorAction: string;
  /** Items that satisfy every non-empty tag dimension on the pack (stricter inventory). */
  strictAllDeclaredDimensionsCount: number;
};

export type CatalogCoverageHealthReport = {
  generatedAt: string;
  catalogItemCountActive: number;
  packs: PackCoverageHealthRow[];
};

/** Prisma-shaped row; keep loose to avoid importing Prisma in every consumer. */
export type CatalogItemRowForHealth = {
  url: string;
  provider: string | null;
  durationSec: number | null;
  thumbnail: string | null;
  manualEnergyRating: number | null;
  archivedAt: Date | null;
  taxonomyLinks: { taxonomyTag: { slug: string } }[];
};

function inferClassifyContext(url: string, provider: string | null): {
  inferredType: string;
  isRadio: boolean;
  isShazam: boolean;
} {
  const u = url.trim().toLowerCase();
  const p = (provider ?? "").trim().toLowerCase();
  const inferredType =
    p === "youtube" || u.includes("youtube.com") || u.includes("youtu.be")
      ? "youtube"
      : p === "spotify" || u.includes("spotify.com") || u.includes("open.spotify.com")
        ? "spotify"
        : p === "soundcloud" || u.includes("soundcloud.com")
          ? "soundcloud"
          : p === "local" || u.startsWith("file:")
            ? "local"
            : p === "stream-url"
              ? "stream-url"
              : p === "winamp"
                ? "winamp"
                : p &&
                    (["youtube", "spotify", "soundcloud", "local", "stream-url", "winamp"] as const).includes(
                      p as CatalogCoverageUrlType,
                    )
                  ? p
                  : u.includes("youtube.com") || u.includes("youtu.be")
                    ? "youtube"
                    : "stream-url";
  const isRadio = p === "stream-url" || p === "winamp";
  return { inferredType, isRadio, isShazam: false };
}

export function catalogItemUrlShape(url: string, provider: string | null): CatalogUrlShape {
  const ctx = inferClassifyContext(url, provider);
  const { contentNodeKind } = classifyResolveFoundation({
    rawUrl: url,
    inferredType: ctx.inferredType,
    isRadio: ctx.isRadio,
    isShazam: ctx.isShazam,
  });
  if (contentNodeKind === "single_track") return "SINGLE";
  if (contentNodeKind === "mix_set" || contentNodeKind === "external_playlist") return "SET_MIX";
  return "OTHER";
}

export function inferCatalogItemUrlType(url: string, provider: string | null): CatalogCoverageUrlType | null {
  const u = url.trim().toLowerCase();
  const p = (provider ?? "").trim().toLowerCase();
  if (p === "youtube" || u.includes("youtube.com") || u.includes("youtu.be")) return "youtube";
  if (p === "spotify" || u.includes("spotify.com") || u.includes("open.spotify.com")) return "spotify";
  if (p === "soundcloud" || u.includes("soundcloud.com")) return "soundcloud";
  if (p === "local" || u.startsWith("file:")) return "local";
  if (p === "stream-url") return "stream-url";
  if (p === "winamp") return "winamp";
  if ((["youtube", "spotify", "soundcloud", "local", "stream-url", "winamp"] as const).includes(p as CatalogCoverageUrlType)) {
    return p as CatalogCoverageUrlType;
  }
  return null;
}

function passesUrlAllowlist(
  url: string,
  provider: string | null,
  allowlist: CatalogCoverageTargetPack["urlTypeAllowlist"],
): boolean {
  if (allowlist == null || allowlist.length === 0) return true;
  const t = inferCatalogItemUrlType(url, provider);
  if (t == null) return false;
  return allowlist.includes(t);
}

function packTagUnion(pack: CatalogCoverageTargetPack): Set<string> {
  const u = new Set<string>();
  for (const x of pack.genreTags) u.add(x);
  for (const x of pack.styleTags) u.add(x);
  for (const x of pack.businessFitTags) u.add(x);
  for (const x of pack.daypartTags) u.add(x);
  for (const x of pack.vibeTags) u.add(x);
  for (const x of pack.catalogProgrammingTags) u.add(x);
  return u;
}

function itemSlugSet(item: CatalogItemRowForHealth): Set<string> {
  return new Set(item.taxonomyLinks.map((l) => l.taxonomyTag.slug));
}

function intersects(set: Set<string>, slugs: string[]): boolean {
  if (slugs.length === 0) return false;
  return slugs.some((s) => set.has(s));
}

/** Non-empty pack dimension lists the item does not yet satisfy (slug intersection). */
export type PackTagDimension =
  | "genre"
  | "style"
  | "businessFit"
  | "daypart"
  | "vibe"
  | "catalogProgramming";

export function listMissingPackTagDimensions(
  item: CatalogItemRowForHealth,
  pack: CatalogCoverageTargetPack,
): { dimension: PackTagDimension; suggestedSlugs: string[] }[] {
  const s = itemSlugSet(item);
  const pairs: [PackTagDimension, string[]][] = [
    ["genre", pack.genreTags],
    ["style", pack.styleTags],
    ["businessFit", pack.businessFitTags],
    ["daypart", pack.daypartTags],
    ["vibe", pack.vibeTags],
    ["catalogProgramming", pack.catalogProgrammingTags],
  ];
  const out: { dimension: PackTagDimension; suggestedSlugs: string[] }[] = [];
  for (const [dim, slugs] of pairs) {
    if (slugs.length === 0) continue;
    if (!slugs.some((slug) => s.has(slug))) out.push({ dimension: dim, suggestedSlugs: [...slugs] });
  }
  return out;
}

export function getPackLooseMatchingItems(
  pack: CatalogCoverageTargetPack,
  activeItems: CatalogItemRowForHealth[],
): CatalogItemRowForHealth[] {
  const union = packTagUnion(pack);
  const matching: CatalogItemRowForHealth[] = [];
  for (const item of activeItems) {
    if (!baseEligible(item, pack)) continue;
    const slugs = itemSlugSet(item);
    let touches = false;
    for (const s of union) {
      if (slugs.has(s)) {
        touches = true;
        break;
      }
    }
    if (!touches) continue;
    matching.push(item);
  }
  return matching;
}

export function isStrictPackMatch(item: CatalogItemRowForHealth, pack: CatalogCoverageTargetPack): boolean {
  return listMissingPackTagDimensions(item, pack).length === 0;
}

/** Map 0–10 pack targets onto nullable 1–10 DB field (no zero stored). */
export function manualEnergyInPackRange(
  rating: number | null,
  min: number | null,
  max: number | null,
): boolean {
  if (min == null || max == null) return false;
  if (rating == null) return false;
  const lo = min <= 0 ? 1 : min;
  const hi = Math.min(10, max);
  return rating >= lo && rating <= hi;
}

function baseEligible(item: CatalogItemRowForHealth, pack: CatalogCoverageTargetPack): boolean {
  if (item.archivedAt != null) return false;
  if (!passesUrlAllowlist(item.url, item.provider, pack.urlTypeAllowlist)) return false;
  const slugSet = itemSlugSet(item);
  for (const a of pack.avoidTags) {
    if (slugSet.has(a)) return false;
  }
  return true;
}

function computeTopMissingDimensions(
  pack: CatalogCoverageTargetPack,
  t: number,
  counts: {
    genre: number;
    style: number;
    businessFit: number;
    daypart: number;
    vibe: number;
    energyInRange: number;
    missingEnergy: number;
    thumbnail: number;
    duration: number;
    urlOk: boolean;
  },
): CoverageHealthDimensionKey[] {
  const gaps: { key: CoverageHealthDimensionKey; score: number }[] = [];
  const rate = (n: number) => (t > 0 ? n / t : 0);

  if (pack.genreTags.length > 0) gaps.push({ key: "genre", score: 1 - rate(counts.genre) });
  if (pack.styleTags.length > 0) gaps.push({ key: "style", score: 1 - rate(counts.style) });
  if (pack.businessFitTags.length > 0) gaps.push({ key: "businessFit", score: 1 - rate(counts.businessFit) });
  if (pack.daypartTags.length > 0) gaps.push({ key: "daypart", score: 1 - rate(counts.daypart) });
  if (pack.vibeTags.length > 0) gaps.push({ key: "vibe", score: 1 - rate(counts.vibe) });
  if (pack.targetEnergyMin != null && pack.targetEnergyMax != null) {
    const energyCoverage = rate(counts.energyInRange);
    const missingRate = rate(counts.missingEnergy);
    gaps.push({ key: "energy", score: missingRate * 0.6 + (1 - energyCoverage) * 0.4 });
  }
  if (pack.urlTypeAllowlist != null && pack.urlTypeAllowlist.length > 0 && !counts.urlOk) {
    gaps.push({ key: "urlType", score: 0.5 });
  }
  const metaRate = rate(Math.max(counts.thumbnail, counts.duration));
  gaps.push({ key: "metadata", score: 1 - metaRate });

  gaps.sort((a, b) => b.score - a.score);
  return gaps.filter((g) => g.score > 0.35).slice(0, 5).map((g) => g.key);
}

function healthAndAction(
  pack: CatalogCoverageTargetPack,
  total: number,
  strict: number,
  missingEnergy: number,
  topMissing: CoverageHealthDimensionKey[],
): { status: CoveragePackHealthStatus; action: string } {
  const minT = pack.targetMinimumItems;
  let status: CoveragePackHealthStatus = "healthy";
  if (total < Math.min(8, minT * 0.35) || total === 0) status = "critical";
  else if (total < minT * 0.75 || (total > 0 && missingEnergy / total > 0.65)) status = "weak";
  else if (total < minT) status = "weak";

  const parts: string[] = [];
  if (total < minT) {
    parts.push(`Grow catalog or tagging toward at least ${minT} loose-matching items (currently ${total}).`);
  }
  if (strict < Math.min(minT, total)) {
    const dims = [
      pack.genreTags.length ? "genre" : "",
      pack.styleTags.length ? "style" : "",
      pack.businessFitTags.length ? "businessFit" : "",
      pack.daypartTags.length ? "daypart" : "",
      pack.vibeTags.length ? "vibe" : "",
      pack.catalogProgrammingTags.length ? "programming" : "",
    ].filter(Boolean);
    parts.push(
      `Increase rows that satisfy every non-empty pack dimension together (strict matches: ${strict}/${total}; target dimensions: ${dims.length ? dims.join(", ") : "declared tags"}).`,
    );
  }
  if (topMissing.includes("energy")) {
    parts.push("Fill manual energy ratings (1–10) for items in this lane.");
  }
  if (topMissing.includes("metadata")) {
    parts.push("Refresh provider metadata / thumbnails (Stage 5.9 snapshots or item fields).");
  }
  if (topMissing.includes("genre") || topMissing.includes("style")) {
    parts.push("Add or confirm Main Sound + Style taxonomy links for items mapped to this pack.");
  }
  if (topMissing.includes("businessFit") || topMissing.includes("daypart") || topMissing.includes("vibe")) {
    parts.push("Tag Business Fit / Daypart / Vibe-Energy slugs on qualifying catalog rows.");
  }
  if (!parts.length) {
    parts.push("Maintain current tagging depth; spot-check new imports against this pack profile.");
  }
  return { status, action: parts.join(" ") };
}

export function generateCatalogCoverageHealthReport(
  bundle: CatalogCoverageTargetsBundle,
  itemsInput: CatalogItemRowForHealth[],
): CatalogCoverageHealthReport {
  const activeItems = itemsInput.filter((i) => i.archivedAt == null);
  const packs = bundle.packs.filter((p) => p.active).map((pack) => {
    const matching = getPackLooseMatchingItems(pack, activeItems);
    let strict = 0;
    for (const item of matching) {
      if (isStrictPackMatch(item, pack)) strict++;
    }

    const t = matching.length;
    const genreN = pack.genreTags.length > 0 ? matching.filter((i) => intersects(itemSlugSet(i), pack.genreTags)).length : null;
    const styleN = pack.styleTags.length > 0 ? matching.filter((i) => intersects(itemSlugSet(i), pack.styleTags)).length : null;
    const bizN =
      pack.businessFitTags.length > 0 ? matching.filter((i) => intersects(itemSlugSet(i), pack.businessFitTags)).length : null;
    const dayN =
      pack.daypartTags.length > 0 ? matching.filter((i) => intersects(itemSlugSet(i), pack.daypartTags)).length : null;
    const vibeN = pack.vibeTags.length > 0 ? matching.filter((i) => intersects(itemSlugSet(i), pack.vibeTags)).length : null;

    let energyOk = 0;
    let missingEn = 0;
    for (const i of matching) {
      if (i.manualEnergyRating == null) missingEn++;
      else if (
        pack.targetEnergyMin != null &&
        pack.targetEnergyMax != null &&
        manualEnergyInPackRange(i.manualEnergyRating, pack.targetEnergyMin, pack.targetEnergyMax)
      ) {
        energyOk++;
      }
    }

    let single = 0;
    let setMix = 0;
    let otherShape = 0;
    let thumbs = 0;
    let dur = 0;
    let meta = 0;
    for (const i of matching) {
      const sh = catalogItemUrlShape(i.url, i.provider);
      if (sh === "SINGLE") single++;
      else if (sh === "SET_MIX") setMix++;
      else otherShape++;
      if ((i.thumbnail ?? "").trim().length > 0) thumbs++;
      if (i.durationSec != null && i.durationSec > 0) dur++;
      if ((i.thumbnail ?? "").trim().length > 0 || (i.durationSec ?? 0) > 0) meta++;
    }

    const topMissing = computeTopMissingDimensions(pack, t, {
      genre: genreN ?? 0,
      style: styleN ?? 0,
      businessFit: bizN ?? 0,
      daypart: dayN ?? 0,
      vibe: vibeN ?? 0,
      energyInRange: energyOk,
      missingEnergy: missingEn,
      thumbnail: thumbs,
      duration: dur,
      urlOk: pack.urlTypeAllowlist == null || pack.urlTypeAllowlist.length === 0,
    });

    const { status, action } = healthAndAction(pack, t, strict, missingEn, topMissing);

    const tgtSingle = pack.targetSingleCount;
    const tgtMix = pack.targetSetMixCount;

    return {
      packId: pack.id,
      labelEn: pack.labelEn,
      labelHe: pack.labelHe,
      totalMatching: t,
      withGenreTags: genreN,
      withStyleTags: styleN,
      withBusinessFitTags: bizN,
      withDaypartTags: dayN,
      withVibeTags: vibeN,
      withEnergyInTargetRange: energyOk,
      missingManualEnergyRating: missingEn,
      singleCount: single,
      setMixCount: setMix,
      otherUrlShapeCount: otherShape,
      itemsWithThumbnail: thumbs,
      itemsWithDurationSec: dur,
      itemsWithBasicMetadata: meta,
      targetMinimumItems: pack.targetMinimumItems,
      targetSingleCount: tgtSingle,
      targetSetMixCount: tgtMix,
      gapMinimumItems: pack.targetMinimumItems - t,
      gapSingle: tgtSingle != null ? tgtSingle - single : null,
      gapSetMix: tgtMix != null ? tgtMix - setMix : null,
      healthStatus: status,
      topMissingDimensions: topMissing,
      recommendedEditorAction: action,
      strictAllDeclaredDimensionsCount: strict,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    catalogItemCountActive: activeItems.length,
    packs,
  };
}

export function formatCoverageHealthConsole(report: CatalogCoverageHealthReport): string {
  const lines: string[] = [];
  lines.push(`Catalog coverage health — ${report.generatedAt}`);
  lines.push(`Active (non-archived) catalog items: ${report.catalogItemCountActive}`);
  lines.push("");
  for (const p of report.packs) {
    lines.push(`━━ ${p.packId} — ${p.labelEn} ━━`);
    lines.push(`  Health: ${p.healthStatus.toUpperCase()}`);
    lines.push(`  Total matching (loose / union tag overlap): ${p.totalMatching}`);
    lines.push(`  Strict (all non-empty pack dimensions): ${p.strictAllDeclaredDimensionsCount}`);
    lines.push(`  With genre tags: ${p.withGenreTags ?? "n/a (no genre list)"}`);
    lines.push(`  With style tags: ${p.withStyleTags ?? "n/a"}`);
    lines.push(`  With business-fit tags: ${p.withBusinessFitTags ?? "n/a"}`);
    lines.push(`  With daypart tags: ${p.withDaypartTags ?? "n/a"}`);
    lines.push(`  With vibe tags: ${p.withVibeTags ?? "n/a"}`);
    lines.push(`  Energy in target range: ${p.withEnergyInTargetRange}; missing manual energy: ${p.missingManualEnergyRating}`);
    lines.push(`  URL shape SINGLE / SET_MIX / other: ${p.singleCount} / ${p.setMixCount} / ${p.otherUrlShapeCount}`);
    lines.push(`  Thumbnail / duration / either: ${p.itemsWithThumbnail} / ${p.itemsWithDurationSec} / ${p.itemsWithBasicMetadata}`);
    lines.push(
      `  Targets — min items: ${p.targetMinimumItems} (gap ${p.gapMinimumItems}); singles ${p.targetSingleCount ?? "—"} (gap ${p.gapSingle ?? "—"}); set-mix ${p.targetSetMixCount ?? "—"} (gap ${p.gapSetMix ?? "—"})`,
    );
    lines.push(`  Top missing dimensions: ${p.topMissingDimensions.join(", ") || "—"}`);
    lines.push(`  Suggested action: ${p.recommendedEditorAction}`);
    lines.push("");
  }
  lines.push("Later: can feed admin/platform/recommendation-coverage or a dedicated Programming Coverage panel.");
  return lines.join("\n");
}
