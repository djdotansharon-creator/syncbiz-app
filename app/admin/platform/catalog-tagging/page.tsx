/**
 * Stage 4 V1 — SUPER_ADMIN manual tagging: global CatalogItem ↔ MusicTaxonomyTag links only.
 * Stage 5 — Browse-first workbench: default list, filters, rich rows (UI/query only).
 */

import Link from "next/link";
import type { Prisma } from "@prisma/client";
import type { CatalogTagSuggestion } from "@/lib/catalog-tagging-suggestions";
import type { CatalogSourceSnapshotDTO } from "@/lib/catalog-source-snapshot-dto";
import {
  loadSourceMetadataSuggestionsForSnapshot,
  serializeCatalogSourceSnapshot,
  shouldAttemptYouTubeCatalogSnapshot,
} from "@/lib/catalog-source-refresh";
import { CatalogItemTaxonomyEditor } from "@/components/admin/catalog-item-taxonomy-editor";
import { CatalogCurationEditor } from "@/components/admin/catalog-curation-editor";
import { CatalogDisplayTitleEditor } from "@/components/admin/catalog-display-title-editor";
import { CatalogSourceMetadataPanel } from "@/components/admin/catalog-source-metadata-panel";
import { CatalogWorkbenchCleanupAction } from "@/components/admin/catalog-workbench-cleanup-action";
import { CatalogWorkbenchSnapshotPoller } from "@/components/admin/catalog-workbench-snapshot-poller";
import { CatalogManualEnergyEditor } from "@/components/admin/catalog-manual-energy-editor";
import { CatalogWorkbenchItemActions } from "@/components/admin/catalog-workbench-item-actions";
import { CatalogWorkbenchTopDashboard } from "@/components/admin/catalog-workbench-top-dashboard";
import { CatalogMetadataBackfillPanel } from "@/components/admin/catalog-metadata-backfill-panel";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "SyncBiz Admin · Catalog tagging",
  robots: { index: false, follow: false },
};

const LIST_LIMIT = 100;
const SLUG_PREVIEW = 28;

function formatCatalogDuration(sec: number | null | undefined): string | null {
  if (sec == null || sec < 0) return null;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatAdminTimestamp(d: Date): string {
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function catalogUsageTier(input: {
  playlistItemRows: number;
  distinctPlaylists: number;
  scheduleCount: number;
  playCount: number;
}): "HIGH" | "MEDIUM" | "LOW" | "NOT_USED" {
  const { playlistItemRows, distinctPlaylists, scheduleCount, playCount } = input;
  const inactive =
    playlistItemRows === 0 && scheduleCount === 0 && playCount === 0;
  if (inactive) return "NOT_USED";
  if (
    distinctPlaylists >= 5 ||
    playCount >= 100 ||
    scheduleCount >= 8 ||
    playlistItemRows >= 14
  ) {
    return "HIGH";
  }
  if (
    distinctPlaylists >= 2 ||
    playCount >= 12 ||
    scheduleCount >= 2 ||
    playlistItemRows >= 4
  ) {
    return "MEDIUM";
  }
  return "LOW";
}

/** Same rules as CatalogAuditionBar (server-safe links for browse rows only). */
function youtubeAuditionHrefForCatalog(
  url: string,
  provider: string | null,
  videoId: string | null | undefined,
): string | null {
  const prov = (provider ?? "").toLowerCase();
  const looksYt = prov.includes("youtube") || /youtube\.com|youtu\.be/i.test(url);
  if (!looksYt) return null;
  if (videoId) {
    const vid = videoId.trim();
    if (vid.length >= 6 && /^[\w-]+$/.test(vid)) {
      return `https://www.youtube.com/watch?v=${encodeURIComponent(vid)}`;
    }
  }
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtube.com") || u.hostname.includes("youtu.be")) return url;
  } catch {
    return null;
  }
  return null;
}

type FilterMode = "all" | "untagged" | "tagged";

function parseFilter(raw: string | undefined): FilterMode {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (s === "untagged" || s === "tagged") return s;
  return "all";
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function normalizeTitleForDedupe(t: string): string {
  return t.trim().toLowerCase().replace(/\s+/g, " ");
}

function titlesVerySimilar(a: string, b: string): boolean {
  const na = normalizeTitleForDedupe(a);
  const nb = normalizeTitleForDedupe(b);
  if (na === nb) return true;
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return false;
  if (maxLen > 120) {
    return na.includes(nb) || nb.includes(na);
  }
  const dist = levenshtein(na, nb);
  const thresh = Math.min(5, Math.floor(maxLen / 10) + 2);
  return dist <= thresh;
}

type DuplicateAggRow = {
  id: string;
  title: string;
  url: string;
  provider: string | null;
  reasons: Set<string>;
};

async function gatherDuplicateHints(selected: {
  id: string;
  canonicalUrl: string | null;
  videoId: string | null;
  provider: string | null;
  title: string;
}): Promise<Array<{ id: string; title: string; url: string; provider: string | null; reasons: string[] }>> {
  const byId = new Map<string, DuplicateAggRow>();

  function note(row: { id: string; title: string; url: string; provider: string | null }, reason: string) {
    let e = byId.get(row.id);
    if (!e) {
      e = {
        id: row.id,
        title: row.title,
        url: row.url,
        provider: row.provider,
        reasons: new Set<string>(),
      };
      byId.set(row.id, e);
    }
    e.reasons.add(reason);
  }

  await Promise.all([
    selected.canonicalUrl
      ? prisma.catalogItem
          .findMany({
            where: { canonicalUrl: selected.canonicalUrl, NOT: { id: selected.id } },
            select: { id: true, title: true, url: true, provider: true },
            take: 30,
          })
          .then((rows) => {
            for (const r of rows) note(r, "Same canonical URL");
          })
      : Promise.resolve(),
    selected.provider && selected.videoId
      ? prisma.catalogItem
          .findMany({
            where: {
              provider: selected.provider,
              videoId: selected.videoId,
              NOT: { id: selected.id },
            },
            select: { id: true, title: true, url: true, provider: true },
            take: 30,
          })
          .then((rows) => {
            for (const r of rows) note(r, "Same provider + video/source id");
          })
      : Promise.resolve(),
    selected.provider
      ? prisma.catalogItem
          .findMany({
            where: {
              provider: selected.provider,
              title: { equals: selected.title, mode: "insensitive" },
              NOT: { id: selected.id },
            },
            select: { id: true, title: true, url: true, provider: true },
            take: 30,
          })
          .then((rows) => {
            for (const r of rows) note(r, "Same title + same provider");
          })
      : Promise.resolve(),
    selected.provider
      ? prisma.catalogItem
          .findMany({
            where: { provider: selected.provider, NOT: { id: selected.id } },
            select: { id: true, title: true, url: true, provider: true },
            orderBy: { updatedAt: "desc" },
            take: 250,
          })
          .then((candidates) => {
            for (const r of candidates) {
              if (titlesVerySimilar(selected.title, r.title)) {
                note(r, "Very similar title + same provider");
              }
            }
          })
      : Promise.resolve(),
  ]);

  return [...byId.values()]
    .map((e) => ({
      id: e.id,
      title: e.title,
      url: e.url,
      provider: e.provider,
      reasons: [...e.reasons].sort(),
    }))
    .slice(0, 50);
}

function catalogTaggingHref(parts: {
  q?: string;
  catalogItemId?: string;
  filter?: FilterMode;
  provider?: string;
  /** When true, preserve browse mode that includes archived catalog rows. */
  includeArchived?: boolean;
}): string {
  const u = new URLSearchParams();
  const q = parts.q?.trim() ?? "";
  if (q.length >= 1) u.set("q", q);
  if (parts.filter && parts.filter !== "all") u.set("filter", parts.filter);
  const prov = parts.provider?.trim() ?? "";
  if (prov.length >= 1) u.set("provider", prov);
  if (parts.catalogItemId?.trim()) u.set("catalogItemId", parts.catalogItemId.trim());
  if (parts.includeArchived) u.set("includeArchived", "1");
  const qs = u.toString();
  return qs.length ? `/admin/platform/catalog-tagging?${qs}` : "/admin/platform/catalog-tagging";
}

function computeNextUntaggedHref(
  currentId: string,
  queue: Array<{ id: string }>,
  baseParams: { q: string; filter: FilterMode; provider: string; includeArchived?: boolean },
): string | null {
  const ids = queue.map((x) => x.id);
  if (ids.length === 0) return null;
  const pos = ids.indexOf(currentId);
  if (pos >= 0 && pos < ids.length - 1) {
    return catalogTaggingHref({ ...baseParams, catalogItemId: ids[pos + 1] });
  }
  if (pos === -1) {
    const next = ids.find((id) => id !== currentId);
    return next ? catalogTaggingHref({ ...baseParams, catalogItemId: next }) : null;
  }
  return null;
}

export default async function CatalogTaggingAdminPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    catalogItemId?: string;
    filter?: string;
    provider?: string;
    includeArchived?: string;
  }>;
}) {
  await requireSuperAdmin();

  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const catalogItemId = typeof sp.catalogItemId === "string" ? sp.catalogItemId.trim() : "";
  const filterMode = parseFilter(sp.filter);
  const providerQ = typeof sp.provider === "string" ? sp.provider.trim() : "";
  const includeArchived =
    typeof sp.includeArchived === "string" &&
    (sp.includeArchived === "1" || sp.includeArchived.toLowerCase() === "true");

  const clauses: Prisma.CatalogItemWhereInput[] = [];
  if (!includeArchived) {
    clauses.push({ archivedAt: null });
  }

  if (q.length >= 1) {
    clauses.push({
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { url: { contains: q, mode: "insensitive" } },
      ],
    });
  }

  if (filterMode === "untagged") {
    clauses.push({ taxonomyLinks: { none: {} } });
  } else if (filterMode === "tagged") {
    clauses.push({ taxonomyLinks: { some: {} } });
  }

  if (providerQ.length >= 1) {
    clauses.push({ provider: { contains: providerQ, mode: "insensitive" } });
  }

  const where: Prisma.CatalogItemWhereInput = clauses.length > 0 ? { AND: clauses } : {};

  const discoveryScope = includeArchived ? {} : { archivedAt: null };
  const taggedWhere: Prisma.CatalogItemWhereInput = includeArchived
    ? { taxonomyLinks: { some: {} } }
    : { archivedAt: null, taxonomyLinks: { some: {} } };
  const untaggedWhere: Prisma.CatalogItemWhereInput = includeArchived
    ? { taxonomyLinks: { none: {} } }
    : { archivedAt: null, taxonomyLinks: { none: {} } };
  const providerWhere: Prisma.CatalogItemWhereInput = includeArchived
    ? { provider: { not: null } }
    : { archivedAt: null, provider: { not: null } };

  const [
    totalCatalog,
    taggedCount,
    untaggedCount,
    providerSuggestions,
    results,
    selected,
  ] = await Promise.all([
    prisma.catalogItem.count({ where: discoveryScope }),
    prisma.catalogItem.count({ where: taggedWhere }),
    prisma.catalogItem.count({ where: untaggedWhere }),
    prisma.catalogItem.findMany({
      where: providerWhere,
      select: { provider: true },
      distinct: ["provider"],
      orderBy: { provider: "asc" },
      take: 80,
    }),
    prisma.catalogItem.findMany({
      where,
      take: LIST_LIMIT,
      orderBy: [{ taxonomyLinks: { _count: "asc" } }, { updatedAt: "desc" }],
      select: {
        id: true,
        title: true,
        url: true,
        provider: true,
        thumbnail: true,
        durationSec: true,
        videoId: true,
        curationRating: true,
        manualEnergyRating: true,
        archivedAt: true,
        _count: { select: { taxonomyLinks: true } },
        taxonomyLinks: {
          take: SLUG_PREVIEW,
          orderBy: { taxonomyTag: { slug: "asc" } },
          select: {
            taxonomyTag: { select: { slug: true } },
          },
        },
      },
    }),
    catalogItemId.length > 0
      ? prisma.catalogItem.findUnique({
          where: { id: catalogItemId },
          select: {
            id: true,
            title: true,
            url: true,
            provider: true,
            thumbnail: true,
            durationSec: true,
            canonicalUrl: true,
            videoId: true,
            curationRating: true,
            curationNotes: true,
            manualEnergyRating: true,
            addedById: true,
            archivedAt: true,
            archivedByUserId: true,
            archiveReason: true,
            createdAt: true,
            updatedAt: true,
          },
        })
      : Promise.resolve(null),
  ]);

  const baseParams = { q, filter: filterMode, provider: providerQ, includeArchived };

  let serializedLatestSnapshot: CatalogSourceSnapshotDTO | null = null;
  let metadataSuggestionsFromSnapshot: CatalogTagSuggestion[] = [];
  let unknownMetadataCues: string[] = [];

  let playlistUsageRows: Array<{
    id: string;
    position: number;
    name: string;
    playlist: {
      id: string;
      name: string;
      workspaceId: string;
      workspace: { id: string; name: string; slug: string };
    };
  }> = [];
  let addedByUser: { email: string; name: string | null } | null = null;
  let legacyPlaylistUrlGapCount = 0;

  let playlistUsageCount = 0;
  let duplicateHints: Array<{
    id: string;
    title: string;
    url: string;
    provider: string | null;
    reasons: string[];
  }> = [];
  let playlistHintTexts: string[] = [];
  let nextUntaggedHref: string | null = null;

  let metadataHaystackPartsForTaxonomy: string[] = [];
  let catalogAnalyticsRow: {
    playCount: number;
    lastPlayedAt: Date | null;
    sharedCount: number;
    aiDjCount: number;
  } | null = null;
  let scheduleRefsCount = 0;
  let distinctBranchesFromSchedules = 0;
  let lastPlaylistLinkAt: Date | null = null;

  if (selected) {
    const urlCandidates = [
      ...new Set(
        [selected.url, selected.canonicalUrl].filter(
          (x): x is string => typeof x === "string" && x.trim().length > 0,
        ),
      ),
    ];

    const [plc, pRows, hints, untaggedQueue, latestSnapshotRow, userRow, legacyGap] = await Promise.all([
      prisma.playlistItem.count({ where: { catalogId: selected.id } }),
      prisma.playlistItem.findMany({
        where: { catalogId: selected.id },
        include: {
          playlist: {
            select: {
              id: true,
              name: true,
              workspaceId: true,
              workspace: { select: { id: true, name: true, slug: true } },
            },
          },
        },
        orderBy: [{ playlistId: "asc" }, { position: "asc" }],
      }),
      gatherDuplicateHints(selected),
      prisma.catalogItem.findMany({
        where: untaggedWhere,
        orderBy: [{ updatedAt: "desc" }],
        select: { id: true },
        take: 500,
      }),
      prisma.catalogSourceSnapshot.findFirst({
        where: { catalogItemId: selected.id },
        orderBy: { fetchedAt: "desc" },
      }),
      selected.addedById
        ? prisma.user.findUnique({
            where: { id: selected.addedById },
            select: { email: true, name: true },
          })
        : Promise.resolve(null),
      urlCandidates.length === 0
        ? Promise.resolve(0)
        : prisma.playlistItem.count({
            where: {
              catalogId: null,
              OR: urlCandidates.map((u) => ({ url: u })),
            },
          }),
    ]);

    playlistUsageCount = plc;
    playlistUsageRows = pRows;
    duplicateHints = hints;
    playlistHintTexts = [
      ...new Set(
        pRows
          .map((r) => r.playlist?.name)
          .filter((n): n is string => typeof n === "string" && n.trim().length > 0),
      ),
    ];
    nextUntaggedHref = computeNextUntaggedHref(selected.id, untaggedQueue, baseParams);
    addedByUser = userRow;
    legacyPlaylistUrlGapCount = legacyGap;

    if (latestSnapshotRow) {
      serializedLatestSnapshot = serializeCatalogSourceSnapshot(latestSnapshotRow);
      const sug = await loadSourceMetadataSuggestionsForSnapshot(selected.id, latestSnapshotRow);
      metadataSuggestionsFromSnapshot = sug.metadataSuggestions;
      unknownMetadataCues = sug.unknownCues;
    }

    const playlistIds = [...new Set(pRows.map((r) => r.playlistId))];
    const [analyticsRow, scheduleBranchGroups, scheduleCountTotal, playlistAddedAgg] = await Promise.all([
      prisma.catalogAnalytics.findUnique({
        where: { catalogItemId: selected.id },
        select: { playCount: true, lastPlayedAt: true, sharedCount: true, aiDjCount: true },
      }),
      playlistIds.length === 0
        ? Promise.resolve([] as { branchId: string }[])
        : prisma.schedule.groupBy({
            by: ["branchId"],
            where: { playlistId: { in: playlistIds } },
          }),
      playlistIds.length === 0
        ? Promise.resolve(0)
        : prisma.schedule.count({ where: { playlistId: { in: playlistIds } } }),
      prisma.playlistItem.aggregate({
        where: { catalogId: selected.id },
        _max: { addedAt: true },
      }),
    ]);
    catalogAnalyticsRow = analyticsRow;
    scheduleRefsCount = scheduleCountTotal;
    distinctBranchesFromSchedules = scheduleBranchGroups.length;
    lastPlaylistLinkAt = playlistAddedAgg._max.addedAt ?? null;

    if (serializedLatestSnapshot) {
      const snap = serializedLatestSnapshot;
      const parts: string[] = [];
      if (snap.description?.trim()) parts.push(snap.description);
      if (snap.title?.trim()) parts.push(snap.title);
      if (snap.channelTitle?.trim()) parts.push(snap.channelTitle);
      parts.push(...snap.hashtags, ...snap.sourceTags);
      metadataHaystackPartsForTaxonomy = parts;
    }
  }

  const workspacesUsingCatalog =
    playlistUsageRows.length > 0
      ? [...new Map(playlistUsageRows.map((r) => [r.playlist.workspace.id, r.playlist.workspace])).values()]
      : [];

  const distinctPlaylistCount =
    playlistUsageRows.length > 0 ? new Set(playlistUsageRows.map((r) => r.playlist.id)).size : 0;

  const usageTier = selected
    ? catalogUsageTier({
        playlistItemRows: playlistUsageCount,
        distinctPlaylists: distinctPlaylistCount,
        scheduleCount: scheduleRefsCount,
        playCount: catalogAnalyticsRow?.playCount ?? 0,
      })
    : "NOT_USED";

  const strictlyUnused =
    !!selected &&
    playlistUsageCount === 0 &&
    scheduleRefsCount === 0 &&
    (catalogAnalyticsRow?.playCount ?? 0) === 0 &&
    (catalogAnalyticsRow?.sharedCount ?? 0) === 0 &&
    (catalogAnalyticsRow?.aiDjCount ?? 0) === 0;

  const cleanupUsageSummaryLine =
    selected && !strictlyUnused
      ? [
          playlistUsageCount > 0 ? `${playlistUsageCount} playlist item link(s)` : null,
          distinctPlaylistCount > 0 ? `${distinctPlaylistCount} playlist(s)` : null,
          workspacesUsingCatalog.length > 0 ? `${workspacesUsingCatalog.length} workspace(s)` : null,
          scheduleRefsCount > 0 ? `${scheduleRefsCount} schedule row(s)` : null,
          distinctBranchesFromSchedules > 0 ? `${distinctBranchesFromSchedules} branch(es) via schedules` : null,
          (catalogAnalyticsRow?.playCount ?? 0) > 0 ? `${catalogAnalyticsRow!.playCount} analytics play(s)` : null,
          (catalogAnalyticsRow?.sharedCount ?? 0) > 0 ? `${catalogAnalyticsRow!.sharedCount} share signal(s)` : null,
          (catalogAnalyticsRow?.aiDjCount ?? 0) > 0 ? `${catalogAnalyticsRow!.aiDjCount} AI DJ signal(s)` : null,
        ]
          .filter((x): x is string => typeof x === "string" && x.length > 0)
          .join(" · ") || null
      : null;

  const tierBadgeClass =
    usageTier === "HIGH"
      ? "border-emerald-800/70 bg-emerald-950/45 text-emerald-100"
      : usageTier === "MEDIUM"
        ? "border-sky-800/70 bg-sky-950/45 text-sky-100"
        : usageTier === "LOW"
          ? "border-amber-800/65 bg-amber-950/35 text-amber-100"
          : "border-neutral-700 bg-neutral-900/80 text-neutral-400";

  const youtubeEligible = selected ? shouldAttemptYouTubeCatalogSnapshot(selected) : false;
  const providerSnapshotPhase: "UNSUPPORTED" | "PENDING" | "READY" =
    !selected ? "READY" : serializedLatestSnapshot ? "READY" : youtubeEligible ? "PENDING" : "UNSUPPORTED";

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-wide text-neutral-500">
          <Link href="/admin/platform" className="text-sky-400 hover:underline">
            Platform
          </Link>
          <span className="text-neutral-600"> · </span>
          Catalog tagging
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-neutral-50">Catalog taxonomy tagging</h1>
        <p className="mt-2 max-w-2xl text-sm text-neutral-400">
          Stage 4–5 — browse the catalog, filter by tag status or provider, then link dictionary tags to rows (manual SUPER_ADMIN only).
        </p>
      </div>

      <section className="rounded-lg border border-neutral-800 bg-neutral-950/50 px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Catalog summary</p>
        <p className="mt-2 text-sm text-neutral-300">
          <span className="text-neutral-400">Total · </span>
          <span className="tabular-nums font-medium text-neutral-100">{totalCatalog}</span>
          <span className="mx-2 text-neutral-600">·</span>
          <span className="text-neutral-400">Tagged · </span>
          <span className="tabular-nums font-medium text-emerald-300/90">{taggedCount}</span>
          <span className="mx-2 text-neutral-600">·</span>
          <span className="text-neutral-400">Untagged · </span>
          <span className="tabular-nums font-medium text-amber-200/90">{untaggedCount}</span>
        </p>
      </section>

      <CatalogMetadataBackfillPanel />

      <form
        action="/admin/platform/catalog-tagging"
        method="get"
        className="flex flex-col gap-4 rounded-md border border-neutral-800 bg-neutral-900/40 p-4"
      >
        {catalogItemId.length > 0 ? <input type="hidden" name="catalogItemId" value={catalogItemId} /> : null}
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-xs text-neutral-500">
            Search title / URL
            <input
              name="q"
              defaultValue={q}
              placeholder="Optional — narrows the list below"
              className="rounded border border-neutral-700 bg-neutral-950 px-2 py-2 text-sm text-neutral-100"
            />
          </label>
          <label className="flex min-w-[140px] flex-col gap-1 text-xs text-neutral-500">
            Tag status
            <select
              name="filter"
              defaultValue={filterMode}
              className="rounded border border-neutral-700 bg-neutral-950 px-2 py-2 text-sm text-neutral-100"
            >
              <option value="all">All</option>
              <option value="untagged">Untagged</option>
              <option value="tagged">Tagged</option>
            </select>
          </label>
          <label className="flex min-w-[160px] flex-1 flex-col gap-1 text-xs text-neutral-500">
            Provider (contains)
            <input
              name="provider"
              list="catalog-tagging-provider-suggestions"
              defaultValue={providerQ}
              placeholder="e.g. youtube"
              autoComplete="off"
              className="rounded border border-neutral-700 bg-neutral-950 px-2 py-2 text-sm text-neutral-100"
            />
            <datalist id="catalog-tagging-provider-suggestions">
              {providerSuggestions
                .map((r) => r.provider)
                .filter((p): p is string => typeof p === "string" && p.length > 0)
                .map((p) => (
                  <option key={p} value={p} />
                ))}
            </datalist>
          </label>
          <label className="flex cursor-pointer items-center gap-2 rounded border border-neutral-800 bg-neutral-950/60 px-3 py-2 text-xs text-neutral-400">
            <input
              type="checkbox"
              name="includeArchived"
              value="1"
              defaultChecked={includeArchived}
              className="rounded border-neutral-600"
            />
            Show archived
          </label>
          <button
            type="submit"
            className="rounded border border-neutral-600 bg-neutral-800 px-4 py-2 text-sm font-medium text-neutral-100 hover:bg-neutral-700"
          >
            Apply
          </button>
        </div>
        <p className="text-[11px] text-neutral-600">
          Default list loads up to {LIST_LIMIT} items with zero tags first. Use filters or search to narrow.
        </p>
      </form>

      {catalogItemId && !selected ? (
        <p className="rounded-md border border-amber-900/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
          Catalog item not found for this id.
        </p>
      ) : null}

      {/* Editor zone directly under filters */}
      <div className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">Tag editor</h2>
          <p className="mt-1 text-sm text-neutral-500">
            Stage 5.8 review queue — save or skip moves along untagged rows (same filters in URL). Select a row below — tags load here. Deep links with{" "}
            <code className="text-[11px] text-neutral-600">?catalogItemId=…</code> open the editor immediately.
          </p>
        </div>

        {selected ? (
          <div className="rounded-lg border border-sky-900/60 bg-gradient-to-b from-sky-950/30 to-neutral-950/80 p-5 ring-1 ring-sky-500/20">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-sky-400/90">
              Editing tags for this catalog item
            </p>
            <div className="mt-3 flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <CatalogWorkbenchItemActions
                  catalogItemId={selected.id}
                  url={selected.url}
                  provider={selected.provider}
                  videoId={selected.videoId}
                />
              </div>
              <CatalogWorkbenchCleanupAction
                catalogItemId={selected.id}
                strictlyUnused={strictlyUnused}
                isArchived={selected.archivedAt != null}
                distinctPlaylistCount={distinctPlaylistCount}
                workspaceCount={workspacesUsingCatalog.length}
                usageSummaryCompact={strictlyUnused ? null : cleanupUsageSummaryLine}
              />
            </div>
            <CatalogWorkbenchSnapshotPoller
              catalogItemId={selected.id}
              enabled={youtubeEligible && !serializedLatestSnapshot}
            />
            <CatalogWorkbenchTopDashboard
              snapshot={serializedLatestSnapshot}
              providerSnapshotPhase={providerSnapshotPhase}
              archivedAt={selected.archivedAt}
              archiveReason={selected.archiveReason}
              catalogCreatedAt={selected.createdAt}
              lastPlaylistLinkAt={lastPlaylistLinkAt}
              lastAnalyticsPlayAt={catalogAnalyticsRow?.lastPlayedAt ?? null}
              playlistUsageCount={playlistUsageCount}
              distinctPlaylistCount={distinctPlaylistCount}
              workspaceCount={workspacesUsingCatalog.length}
              branchesViaSchedules={distinctBranchesFromSchedules}
              scheduleRefsCount={scheduleRefsCount}
              analyticsPlays={catalogAnalyticsRow?.playCount ?? 0}
              analyticsShares={catalogAnalyticsRow?.sharedCount ?? 0}
              usageTier={usageTier}
              tierBadgeClass={tierBadgeClass}
              curationRating={selected.curationRating}
              manualEnergyRating={selected.manualEnergyRating ?? null}
            />
            <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start">
              {selected.thumbnail ? (
                <div className="shrink-0 overflow-hidden rounded-md border border-neutral-700 bg-neutral-900">
                  {/* eslint-disable-next-line @next/next/no-img-element -- external catalog URLs; admin-only tool */}
                  <img
                    src={selected.thumbnail}
                    alt=""
                    className="h-24 w-24 object-cover"
                    loading="lazy"
                  />
                </div>
              ) : null}
              <div className="min-w-0 flex-1 space-y-2">
                <CatalogDisplayTitleEditor catalogItemId={selected.id} initialTitle={selected.title} />
                {formatCatalogDuration(selected.durationSec) ? (
                  <p className="text-xs text-neutral-400">
                    <span className="text-neutral-600">Duration · </span>
                    {formatCatalogDuration(selected.durationSec)}
                  </p>
                ) : null}
                <p className="break-all font-mono text-xs text-neutral-400">{selected.url}</p>
                <p className="font-mono text-[11px] text-neutral-500">
                  <span className="text-neutral-600">catalogItemId · </span>
                  {selected.id}
                </p>
                {selected.provider ? (
                  <p className="text-sm text-neutral-300">
                    <span className="text-neutral-500">Provider · </span>
                    {selected.provider}
                  </p>
                ) : (
                  <p className="text-xs text-neutral-600">Provider · —</p>
                )}
              </div>
            </div>

            <div className="mt-4 border-t border-sky-900/35 pt-4 space-y-4">
              <CatalogCurationEditor
                key={`cur-${selected.id}`}
                catalogItemId={selected.id}
                initialRating={selected.curationRating}
                initialNotes={selected.curationNotes}
              />
              <CatalogManualEnergyEditor
                catalogItemId={selected.id}
                initialManualEnergyRating={selected.manualEnergyRating ?? null}
              />
            </div>

            <div className="mt-4 border-t border-teal-900/35 pt-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-teal-300/95">
                Playlist usage (detail)
              </p>
              <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
                Rows linked via <code className="text-neutral-600">PlaylistItem.catalogId</code> → this catalog row (
                <code className="text-neutral-600">PlaylistItem.playlistId</code> → playlist / workspace).
              </p>
              {playlistUsageCount === 0 ? (
                <p className="mt-3 text-sm text-neutral-500">Not used in any playlist yet.</p>
              ) : (
                <>
                  <p className="mt-3 text-sm text-neutral-300">
                    <span className="text-neutral-500">Playlist item rows · </span>
                    <span className="tabular-nums font-semibold text-neutral-100">{playlistUsageCount}</span>
                  </p>
                  <details className="mt-2 rounded-md border border-neutral-800 bg-neutral-950/40 px-3 py-2">
                    <summary className="cursor-pointer text-[11px] font-medium text-teal-200/90 hover:text-teal-100">
                      Expand playlist rows (IDs & editors)
                    </summary>
                    <ul className="mt-3 space-y-3">
                      {playlistUsageRows.map((row) => (
                        <li
                          key={row.id}
                          className="rounded border border-neutral-800 bg-neutral-950/65 px-3 py-2 text-[11px] text-neutral-300"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-medium text-neutral-100">{row.playlist.name}</span>
                            <span className="tabular-nums text-neutral-500">position {row.position}</span>
                          </div>
                          <div className="mt-1 font-mono text-[10px] text-neutral-600">
                            playlistId · {row.playlist.id}
                            <span className="mx-2 text-neutral-700">·</span>
                            workspace · {row.playlist.workspace.name}{" "}
                            <span className="text-neutral-600">({row.playlist.workspace.slug})</span>
                            <span className="mx-2 text-neutral-700">·</span>
                            workspaceId · {row.playlist.workspace.id}
                          </div>
                          <div className="mt-1 text-neutral-400">
                            Track title ·{" "}
                            <span className="text-neutral-200">{row.name.trim().length > 0 ? row.name : "—"}</span>
                            <span className="mx-2 text-neutral-700">·</span>
                            playlistItemId · <span className="font-mono text-neutral-500">{row.id}</span>
                          </div>
                          <div className="mt-2">
                            <Link
                              href={`/playlists/${row.playlist.id}/edit`}
                              className="text-[11px] font-medium text-teal-300 hover:text-teal-200 hover:underline"
                            >
                              Open playlist editor
                            </Link>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </details>
                </>
              )}
            </div>

            <div className="mt-4 border-t border-indigo-900/35 pt-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-300/95">
                Provenance
              </p>
              <dl className="mt-3 space-y-2 text-[11px] text-neutral-400">
                <div className="flex flex-wrap gap-x-2 gap-y-1">
                  <dt className="text-neutral-600">Created</dt>
                  <dd className="text-neutral-200">{formatAdminTimestamp(selected.createdAt)}</dd>
                </div>
                <div className="flex flex-wrap gap-x-2 gap-y-1">
                  <dt className="text-neutral-600">Updated</dt>
                  <dd className="text-neutral-200">{formatAdminTimestamp(selected.updatedAt)}</dd>
                </div>
                <div className="flex flex-wrap gap-x-2 gap-y-1">
                  <dt className="text-neutral-600">Added by</dt>
                  <dd className="text-neutral-200">
                    {addedByUser ? (
                      <>
                        {addedByUser.name?.trim() ? `${addedByUser.name} · ` : null}
                        <span className="font-mono text-neutral-300">{addedByUser.email}</span>
                      </>
                    ) : (
                      "Unknown"
                    )}
                  </dd>
                </div>
                <div className="flex flex-wrap gap-x-2 gap-y-1">
                  <dt className="text-neutral-600 shrink-0">Workspaces using via playlists</dt>
                  <dd className="min-w-0 text-neutral-200">
                    {workspacesUsingCatalog.length === 0 ? (
                      <span className="text-neutral-500">None (no playlist links).</span>
                    ) : (
                      <ul className="space-y-1">
                        {workspacesUsingCatalog.map((ws) => (
                          <li key={ws.id}>
                            {ws.name}{" "}
                            <span className="text-neutral-600">
                              ({ws.slug}) · <span className="font-mono text-[10px]">{ws.id}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="mt-4 rounded-md border border-amber-900/45 bg-amber-950/20 px-3 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-200/95">
                Legacy catalog link audit (read-only)
              </p>
              <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
                Possible <code className="text-neutral-600">PlaylistItem</code> rows with{" "}
                <code className="text-neutral-600">catalogId = null</code> whose stored URL matches this item&apos;s{" "}
                <code className="text-neutral-600">url</code> / <code className="text-neutral-600">canonicalUrl</code>. Not a
                backfill — informational count only.
              </p>
              <p className="mt-2 text-sm text-amber-100/95">
                Possible legacy playlist links missing catalogId ·{" "}
                <span className="tabular-nums font-semibold">{legacyPlaylistUrlGapCount}</span>
              </p>
            </div>

            <div className="mt-4 border-t border-sky-900/45 pt-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-400/90">
                Catalog audition
              </p>
              <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
                Open URL / Copy / YouTube and refresh snapshots from the toolbar <strong className="font-medium text-neutral-400">above</strong>{" "}
                before tagging when you need to hear the track or rebuild provider metadata. Nothing here routes through SyncBiz branch players or device playback.
              </p>
              <p className="mt-3 text-[10px] leading-snug text-neutral-600">
                Planned future “Audition Mode”: isolated admin-side preview only — separate audio path from business playback,
                explicit volume/output control, never routed through WebSocket / desktop / MPV / branch schedules.
              </p>
            </div>
          </div>
        ) : null}

        {selected ? (
          <CatalogSourceMetadataPanel
            catalogItemId={selected.id}
            snapshot={serializedLatestSnapshot}
            unknownCues={unknownMetadataCues}
          />
        ) : null}

        <CatalogItemTaxonomyEditor
          catalogItemId={selected?.id ?? null}
          catalogTitle={selected?.title ?? ""}
          catalogUrl={selected?.url ?? ""}
          catalogProvider={selected?.provider ?? null}
          playlistHintTexts={playlistHintTexts}
          metadataHaystackParts={metadataHaystackPartsForTaxonomy}
          nextUntaggedHref={nextUntaggedHref}
          metadataSuggestions={metadataSuggestionsFromSnapshot}
        />

        {selected ? (
          <>
            <section className="rounded-lg border border-rose-950/40 bg-neutral-950/50 p-4">
              <h3 className="text-sm font-semibold text-neutral-200">Deletion safety (audit)</h3>
              <p className="mt-2 text-xs text-neutral-500">
                <code className="text-[11px] text-neutral-600">PlaylistItem.catalogId</code> references{" "}
                <code className="text-[11px] text-neutral-600">CatalogItem.id</code>. Removing catalog rows that appear in playlists
                breaks playlist integrity unless references are rewritten or links nullified by design.
              </p>
              <p className="mt-3 text-sm text-neutral-300">
                See <strong className="font-medium text-neutral-400">Playlist usage</strong> above for live FK-linked counts and rows.
              </p>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-[11px] text-neutral-500">
                <li>
                  <strong className="font-medium text-neutral-400">Safest future behavior:</strong> never hard-delete an active{" "}
                  <code className="text-neutral-600">CatalogItem</code> that has playlist references — block deletes or cascade via explicit migration.
                </li>
                <li>
                  Prefer <strong className="text-neutral-400">archive / inactive / hidden</strong> semantics so playlist rows keep a stable FK or curated substitute id.
                </li>
                <li>
                  If deletion is allowed only when unused, enforce at API layer using counts like this audit before destructive ops.
                </li>
              </ul>
              <p className="mt-3 text-[11px] text-neutral-600">
                Stage 5.5 — audit only; no delete endpoint added here.
              </p>
            </section>

            <section className="rounded-lg border border-violet-950/40 bg-violet-950/15 p-4">
              <h3 className="text-sm font-semibold text-neutral-200">Possible duplicates (audit)</h3>
              <p className="mt-2 text-xs text-neutral-500">
                Heuristic matches — no merge or delete. Safer resolution later: canonical dedupe keyed by provider + stable media id,
                merge UI with playlist rewiring, then deprecate superseded rows.
              </p>
              {duplicateHints.length === 0 ? (
                <p className="mt-3 text-sm text-neutral-600">No other catalog rows matched these duplicate signals.</p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {duplicateHints.map((d) => (
                    <li
                      key={d.id}
                      className="rounded border border-neutral-800 bg-neutral-950/60 px-3 py-2 text-xs text-neutral-300"
                    >
                      <div className="font-medium text-neutral-100">{d.title}</div>
                      <div className="mt-1 break-all font-mono text-[11px] text-neutral-500">{d.url}</div>
                      <div className="mt-1 text-[11px] text-neutral-600">
                        <span className="text-neutral-500">Signals:</span> {d.reasons.join(" · ")}
                      </div>
                      <div className="mt-2">
                        <Link
                          href={catalogTaggingHref({ ...baseParams, catalogItemId: d.id })}
                          className="text-[11px] font-medium text-violet-300 hover:text-violet-200 hover:underline"
                        >
                          Open in tagging ({d.id.slice(0, 8)}…)
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : null}
      </div>

      <section className="rounded-md border border-neutral-800 bg-neutral-950/40">
        <div className="border-b border-neutral-800 px-4 py-2">
          <p className="text-xs font-medium text-neutral-400">
            {q.length >= 1 ? (
              <>
                Search &amp; filtered results ({results.length}
                {results.length >= LIST_LIMIT ? ` · capped at ${LIST_LIMIT}` : ""})
              </>
            ) : (
              <>
                Catalog items ({results.length}
                {results.length >= LIST_LIMIT ? ` · showing first ${LIST_LIMIT}` : ""}) — untagged first
              </>
            )}
          </p>
          <p className="mt-1 text-[11px] text-neutral-600">
            Filters: {filterMode === "all" ? "All" : filterMode === "untagged" ? "Untagged" : "Tagged"}
            {providerQ ? ` · provider contains “${providerQ}”` : ""}
            {includeArchived ? ` · including archived` : ""}
          </p>
        </div>

        {results.length === 0 ? (
          <p className="px-4 py-6 text-sm text-neutral-500">No catalog items matched.</p>
        ) : (
          <ul className="divide-y divide-neutral-800">
            {results.map((row) => {
              const tagCount = row._count.taxonomyLinks;
              const slugs = row.taxonomyLinks.map((l) => l.taxonomyTag.slug);
              const overflow = tagCount > slugs.length;
              const isCurrentSelection = catalogItemId === row.id;
              const href = catalogTaggingHref({ ...baseParams, catalogItemId: row.id });
              const rowYtHref = youtubeAuditionHrefForCatalog(row.url, row.provider, row.videoId);
              const rowDur = formatCatalogDuration(row.durationSec);
              return (
                <li key={row.id}>
                  <div
                    className={`flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start ${
                      isCurrentSelection
                        ? "border-l-[3px] border-l-sky-500 bg-sky-950/25 ring-1 ring-inset ring-sky-500/15"
                        : "border-l-[3px] border-l-transparent"
                    }`}
                  >
                    <div className="flex shrink-0 gap-3">
                      {row.thumbnail ? (
                        <div className="h-14 w-14 shrink-0 overflow-hidden rounded border border-neutral-700 bg-neutral-900">
                          {/* eslint-disable-next-line @next/next/no-img-element -- external catalog URLs; admin-only tool */}
                          <img
                            src={row.thumbnail}
                            alt=""
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        </div>
                      ) : (
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded border border-dashed border-neutral-700 bg-neutral-900/60 text-[10px] text-neutral-600">
                          No art
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium leading-snug text-neutral-100">{row.title}</p>
                        {row.archivedAt ? (
                          <span className="rounded border border-neutral-600 bg-neutral-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
                            Archived
                          </span>
                        ) : null}
                      </div>
                      <p className="break-all font-mono text-[11px] text-neutral-500">{row.url}</p>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 pt-0.5">
                        <a
                          href={row.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] font-medium text-emerald-400 hover:text-emerald-300 hover:underline"
                        >
                          Open URL
                        </a>
                        {rowYtHref ? (
                          <a
                            href={rowYtHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[11px] font-medium text-red-300/90 hover:text-red-200 hover:underline"
                          >
                            Open YouTube
                          </a>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-neutral-500">
                        <span>
                          <span className="text-neutral-600">Provider · </span>
                          {row.provider ?? "—"}
                        </span>
                        <span className="font-mono">
                          <span className="text-neutral-600">catalogItemId · </span>
                          {row.id}
                        </span>
                        <span className="tabular-nums">
                          <span className="text-neutral-600">Tags · </span>
                          {tagCount}
                        </span>
                        <span className="inline-flex items-center rounded border border-amber-900/45 bg-amber-950/35 px-1.5 py-0 font-mono text-[10px] font-semibold tabular-nums text-amber-100/95">
                          SYNC {typeof row.curationRating === "number" ? Math.min(5, Math.max(0, row.curationRating)) : 0}/5
                        </span>
                        {typeof row.manualEnergyRating === "number" &&
                        row.manualEnergyRating >= 1 &&
                        row.manualEnergyRating <= 10 ? (
                          <span className="inline-flex items-center rounded border border-violet-900/45 bg-violet-950/35 px-1.5 py-0 font-mono text-[10px] font-semibold tabular-nums text-violet-100/95">
                            E {row.manualEnergyRating}/10
                          </span>
                        ) : null}
                        {rowDur ? (
                          <span className="tabular-nums">
                            <span className="text-neutral-600">Duration · </span>
                            {rowDur}
                          </span>
                        ) : null}
                      </div>
                      {tagCount > 0 ? (
                        <div className="flex flex-wrap gap-1.5 pt-0.5">
                          {slugs.map((slug) => (
                            <span
                              key={slug}
                              className="rounded bg-neutral-800/80 px-1.5 py-0.5 font-mono text-[10px] text-neutral-300"
                            >
                              {slug}
                            </span>
                          ))}
                          {overflow ? (
                            <span className="self-center text-[10px] text-neutral-600">
                              +{tagCount - slugs.length} more
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        <p className="text-[11px] text-amber-200/80">No taxonomy tags yet.</p>
                      )}
                      {isCurrentSelection ? (
                        <p className="pt-1 text-[11px] font-medium text-sky-300">Selected — loaded in editor above</p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-start sm:pt-1">
                      <Link
                        href={href}
                        className="rounded border border-sky-800/80 bg-sky-950/40 px-3 py-2 text-xs font-medium text-sky-200 hover:bg-sky-950/70"
                      >
                        {isCurrentSelection ? "Selected" : "Select · Tag this item"}
                      </Link>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
