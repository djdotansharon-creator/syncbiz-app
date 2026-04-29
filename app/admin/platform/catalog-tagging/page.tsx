/**
 * Stage 4 V1 — SUPER_ADMIN manual tagging: global CatalogItem ↔ MusicTaxonomyTag links only.
 */

import Link from "next/link";
import { CatalogItemTaxonomyEditor } from "@/components/admin/catalog-item-taxonomy-editor";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "SyncBiz Admin · Catalog tagging",
  robots: { index: false, follow: false },
};

export default async function CatalogTaggingAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; catalogItemId?: string }>;
}) {
  await requireSuperAdmin();

  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const catalogItemId = typeof sp.catalogItemId === "string" ? sp.catalogItemId.trim() : "";

  let results: { id: string; title: string; url: string }[] = [];
  if (q.length >= 1) {
    results = await prisma.catalogItem.findMany({
      where: {
        OR: [
          { title: { contains: q, mode: "insensitive" } },
          { url: { contains: q, mode: "insensitive" } },
        ],
      },
      take: 40,
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, url: true },
    });
  }

  const selected =
    catalogItemId.length > 0
      ? await prisma.catalogItem.findUnique({
          where: { id: catalogItemId },
          select: {
            id: true,
            title: true,
            url: true,
            provider: true,
            thumbnail: true,
          },
        })
      : null;

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
          Stage 4 V1 — link platform dictionary tags to global catalog rows (manual SUPER_ADMIN only).
        </p>
      </div>

      <form
        action="/admin/platform/catalog-tagging"
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-md border border-neutral-800 bg-neutral-900/40 p-4"
      >
        <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-xs text-neutral-500">
          Search catalog by title or URL
          <input
            name="q"
            defaultValue={q}
            placeholder="e.g. youtube.com or track title"
            className="rounded border border-neutral-700 bg-neutral-950 px-2 py-2 text-sm text-neutral-100"
          />
        </label>
        <button
          type="submit"
          className="rounded border border-neutral-600 bg-neutral-800 px-4 py-2 text-sm font-medium text-neutral-100 hover:bg-neutral-700"
        >
          Search
        </button>
      </form>

      {catalogItemId && !selected ? (
        <p className="rounded-md border border-amber-900/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
          Catalog item not found for this id.
        </p>
      ) : null}

      {/* Editor zone directly under search — no scrolling past results first */}
      <div className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
            Tag editor
          </h2>
          <p className="mt-1 text-sm text-neutral-500">
            After you search, pick a catalog row in the results further down — tags load here right away when an item is
            selected.
          </p>
        </div>

        {selected ? (
          <div className="rounded-lg border border-sky-900/60 bg-gradient-to-b from-sky-950/30 to-neutral-950/80 p-5 ring-1 ring-sky-500/20">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-sky-400/90">
              Editing tags for this catalog item
            </p>
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
                <h3 className="text-lg font-semibold leading-snug text-neutral-50">{selected.title}</h3>
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
          </div>
        ) : null}

        <CatalogItemTaxonomyEditor catalogItemId={selected?.id ?? null} />
      </div>

      {q.length >= 1 && results.length === 0 ? (
        <p className="text-sm text-neutral-500">No catalog items matched.</p>
      ) : null}

      {results.length > 0 ? (
        <div className="rounded-md border border-neutral-800 bg-neutral-950/40">
          <p className="border-b border-neutral-800 px-4 py-2 text-xs text-neutral-500">
            Search results ({results.length}) — select a row to load it into the editor above
          </p>
          <ul className="divide-y divide-neutral-800">
            {results.map((row) => {
              const isCurrentSelection = catalogItemId === row.id;
              return (
                <li key={row.id}>
                  <Link
                    href={`/admin/platform/catalog-tagging?catalogItemId=${encodeURIComponent(row.id)}&q=${encodeURIComponent(q)}`}
                    className={`block px-4 py-3 text-sm transition-colors ${
                      isCurrentSelection
                        ? "border-l-[3px] border-l-sky-500 bg-sky-950/35 ring-1 ring-inset ring-sky-500/25 hover:bg-sky-950/45"
                        : "border-l-[3px] border-l-transparent hover:bg-neutral-900/80"
                    }`}
                  >
                    <span className="font-medium text-neutral-100">{row.title}</span>
                    <span className="mt-1 block truncate font-mono text-xs text-neutral-500">{row.url}</span>
                    {isCurrentSelection ? (
                      <span className="mt-2 inline-block rounded bg-sky-900/60 px-2 py-0.5 text-[11px] font-medium text-sky-200">
                        Selected — loaded in editor above
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
