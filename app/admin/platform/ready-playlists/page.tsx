/**
 * Ready playlists — SUPER_ADMIN view of the curated / shared / published playlists
 * that can be shared with customers. Read-only MVP (list + genre chip); the
 * publish/unpublish scope toggle is a deliberate follow-up because flipping
 * publicationScope is a public-content, state-changing action that must be a
 * confirm-gated SUPER_ADMIN POST.
 *
 * ZERO schema change — reuses existing Playlist.publicationScope / isShared /
 * primaryGenre (all already indexed).
 */

import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "SyncBiz Admin · Ready playlists",
  robots: { index: false, follow: false },
};

// Scopes that make a playlist "ready to share" (excludes PRIVATE / FORK_REMIX drafts).
const SHAREABLE_SCOPES = ["OFFICIAL_SYNCBIZ", "TEMPLATE", "COMMUNITY_PUBLISHED", "LINK_SHARED"] as const;

const SCOPE_LABEL: Record<string, string> = {
  OFFICIAL_SYNCBIZ: "Official SyncBiz",
  TEMPLATE: "Templates",
  COMMUNITY_PUBLISHED: "Community published",
  LINK_SHARED: "Link shared",
};

const SCOPE_ORDER = ["OFFICIAL_SYNCBIZ", "TEMPLATE", "COMMUNITY_PUBLISHED", "LINK_SHARED", "OTHER"];

export default async function ReadyPlaylistsPage() {
  await requireSuperAdmin();

  const playlists = await prisma.playlist.findMany({
    where: {
      OR: [{ publicationScope: { in: [...SHAREABLE_SCOPES] } }, { isShared: true }],
    },
    select: {
      id: true,
      name: true,
      primaryGenre: true,
      publicationScope: true,
      isShared: true,
      updatedAt: true,
      _count: { select: { items: true } },
    },
    orderBy: [{ publicationScope: "asc" }, { updatedAt: "desc" }],
    take: 500,
  });

  // Group by scope (isShared-only rows fall under their scope, e.g. LINK_SHARED or OTHER).
  const groups = new Map<string, typeof playlists>();
  for (const p of playlists) {
    const key = SCOPE_LABEL[p.publicationScope] ? p.publicationScope : "OTHER";
    const arr = groups.get(key) ?? [];
    arr.push(p);
    groups.set(key, arr);
  }
  const orderedKeys = SCOPE_ORDER.filter((k) => groups.has(k));

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-wide text-neutral-500">
          <Link href="/admin/platform" className="text-sky-400 hover:underline">
            Platform
          </Link>
          <span className="text-neutral-600"> · </span>
          Ready playlists
        </p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold text-neutral-50">Ready playlists</h1>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin/platform/catalog-by-genre"
              className="rounded border border-neutral-700 bg-neutral-900 px-2.5 py-1 text-[12px] font-medium text-neutral-200 hover:bg-neutral-800"
            >
              Catalog by genre
            </Link>
            <Link
              href="/admin/platform/catalog-tagging"
              className="rounded border border-neutral-700 bg-neutral-900 px-2.5 py-1 text-[12px] font-medium text-neutral-200 hover:bg-neutral-800"
            >
              Tagging workbench
            </Link>
          </div>
        </div>
        <p className="mt-2 max-w-2xl text-sm text-neutral-400">
          Curated, shared and published playlists ({playlists.length}) — the ones ready to share
          with customers. Read-only for now; publish/unpublish controls come next.
        </p>
      </div>

      {playlists.length === 0 ? (
        <div className="rounded-md border border-neutral-800 bg-neutral-900/50 p-6 text-sm text-neutral-400">
          No shared or published playlists yet. Publish a playlist (Official / Template / Community)
          or share one to see it here.
        </div>
      ) : (
        orderedKeys.map((key) => {
          const rows = groups.get(key)!;
          return (
            <section key={key}>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                {SCOPE_LABEL[key] ?? "Other shared"} ({rows.length})
              </p>
              <div className="overflow-hidden rounded-md border border-neutral-800">
                <ul className="divide-y divide-neutral-800">
                  {rows.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-neutral-900/40">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-neutral-100">{p.name}</p>
                        <p className="text-[11px] text-neutral-500">
                          <span className="tabular-nums">{p._count.items}</span> track
                          {p._count.items === 1 ? "" : "s"}
                          {p.isShared ? <span className="text-emerald-400/80"> · shared</span> : null}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {p.primaryGenre?.trim() ? (
                          <span className="rounded border border-neutral-700 bg-neutral-800/70 px-2 py-0.5 text-[11px] text-neutral-300">
                            {p.primaryGenre}
                          </span>
                        ) : null}
                        <Link
                          href={`/playlists/${p.id}/edit`}
                          className="rounded border border-sky-800/80 bg-sky-950/40 px-2.5 py-1 text-[11px] font-medium text-sky-200 hover:bg-sky-950/70"
                        >
                          Open
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
