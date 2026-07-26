/**
 * Catalog BY GENRE — a landing GRID of genre cards for the SUPER_ADMIN catalog.
 *
 * This is NOT a second item browser: each card links straight into the EXISTING
 * paginated + genre-filtered list at /admin/platform/catalog-tagging (the drill-down
 * lives there, so there is zero duplication of row/pagination logic). The grid gives
 * an at-a-glance "how much is tagged per genre" view + a fast way to jump into a
 * genre's items, and doubles as an untagged backlog.
 *
 * Owner priority: make the catalog easy to reach + browse by genre. Read-only; ZERO
 * schema change (genre axis = existing MAIN_SOUND_GENRE taxonomy tags).
 */

import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "SyncBiz Admin · Catalog by genre",
  robots: { index: false, follow: false },
};

function taggingHref(params: { genre?: string; filter?: "tagged" | "untagged" }): string {
  const u = new URLSearchParams();
  if (params.genre) u.set("genre", params.genre);
  if (params.filter) u.set("filter", params.filter);
  const qs = u.toString();
  return qs ? `/admin/platform/catalog-tagging?${qs}` : "/admin/platform/catalog-tagging";
}

export default async function CatalogByGenrePage() {
  await requireSuperAdmin();

  const [genreTags, genreCounts, untaggedCount, totalCatalog] = await Promise.all([
    prisma.musicTaxonomyTag.findMany({
      where: { category: "MAIN_SOUND_GENRE", status: "ACTIVE" },
      select: { id: true, slug: true, labelEn: true, labelHe: true, parentId: true },
      orderBy: [{ sortOrder: "asc" }, { labelEn: "asc" }],
      take: 400,
    }),
    prisma.catalogItemTaxonomyTag.groupBy({
      by: ["taxonomyTagId"],
      where: {
        taxonomyTag: { category: "MAIN_SOUND_GENRE" },
        catalogItem: { archivedAt: null },
      },
      _count: { taxonomyTagId: true },
    }),
    prisma.catalogItem.count({ where: { archivedAt: null, taxonomyLinks: { none: {} } } }),
    prisma.catalogItem.count({ where: { archivedAt: null } }),
  ]);

  const countByTagId = new Map<string, number>(
    genreCounts.map((r) => [r.taxonomyTagId, r._count.taxonomyTagId]),
  );

  // Populated genres first (most content on top), then alphabetical by label.
  const cards = genreTags
    .map((g) => ({ ...g, count: countByTagId.get(g.id) ?? 0 }))
    .sort((a, b) => (b.count - a.count) || a.labelEn.localeCompare(b.labelEn));

  const populated = cards.filter((c) => c.count > 0);
  const empty = cards.filter((c) => c.count === 0);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-wide text-neutral-500">
          <Link href="/admin/platform" className="text-sky-400 hover:underline">
            Platform
          </Link>
          <span className="text-neutral-600"> · </span>
          Catalog by genre
        </p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold text-neutral-50">Catalog by genre</h1>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin/platform/catalog-tagging"
              className="rounded border border-neutral-700 bg-neutral-900 px-2.5 py-1 text-[12px] font-medium text-neutral-200 hover:bg-neutral-800"
            >
              Tagging workbench
            </Link>
            <Link
              href="/admin/platform/ready-playlists"
              className="rounded border border-neutral-700 bg-neutral-900 px-2.5 py-1 text-[12px] font-medium text-neutral-200 hover:bg-neutral-800"
            >
              Ready playlists
            </Link>
          </div>
        </div>
        <p className="mt-2 max-w-2xl text-sm text-neutral-400">
          {genreTags.length} genres · {totalCatalog} catalog items. Pick a genre to open its
          items in the tagging workbench (paginated + filtered).
        </p>
      </div>

      {/* Untagged work-queue card */}
      <Link
        href={taggingHref({ filter: "untagged" })}
        className="flex items-center justify-between gap-3 rounded-lg border border-amber-900/50 bg-amber-950/25 px-4 py-3 transition hover:bg-amber-950/40"
      >
        <div>
          <p className="text-sm font-medium text-amber-100">Untagged — start here</p>
          <p className="text-[11px] text-amber-200/70">Catalog items with no taxonomy tags yet.</p>
        </div>
        <span className="tabular-nums text-lg font-semibold text-amber-100">{untaggedCount}</span>
      </Link>

      {/* Populated genres */}
      <section>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
          Genres with items ({populated.length})
        </p>
        {populated.length === 0 ? (
          <p className="text-sm text-neutral-500">No genre-tagged items yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {populated.map((g) => (
              <Link
                key={g.id}
                href={taggingHref({ genre: g.slug, filter: "tagged" })}
                className="flex items-center justify-between gap-2 rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-2.5 transition hover:border-sky-800/70 hover:bg-neutral-900"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-neutral-100">
                    {g.labelEn}
                  </span>
                  {g.labelHe?.trim() ? (
                    <span className="block truncate text-[11px] text-neutral-500">{g.labelHe}</span>
                  ) : null}
                </span>
                <span className="shrink-0 rounded bg-neutral-800 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-neutral-200">
                  {g.count}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Empty genres (no items yet) — collapsed reference */}
      {empty.length > 0 ? (
        <details className="rounded-lg border border-neutral-800 bg-neutral-950/40 px-4 py-3">
          <summary className="cursor-pointer text-[12px] font-medium text-neutral-400 hover:text-neutral-200">
            Genres with no items yet ({empty.length})
          </summary>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {empty.map((g) => (
              <Link
                key={g.id}
                href={taggingHref({ genre: g.slug, filter: "tagged" })}
                className="rounded border border-neutral-800 bg-neutral-900/50 px-2 py-1 text-[11px] text-neutral-400 hover:bg-neutral-800"
              >
                {g.labelEn}
                {g.labelHe?.trim() ? ` · ${g.labelHe}` : ""}
              </Link>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
