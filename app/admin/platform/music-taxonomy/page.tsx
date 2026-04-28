/**
 * Stage 3 — Music Taxonomy Dictionary (platform vocabulary).
 *
 * SUPER_ADMIN tooling only — `/admin/platform/music-taxonomy`.
 */

import Link from "next/link";
import MusicTaxonomyTagsPanel, {
  type MusicTaxonomyTagDTO,
} from "@/components/admin/music-taxonomy-tags-panel";
import {
  filterMusicTaxonomyTags,
  loadAllMusicTaxonomyTags,
  parseMusicTaxonomyCategory,
  parseMusicTaxonomyStatus,
  type MusicTaxonomyTagWithLinks,
} from "@/lib/music-taxonomy-admin";
import { requireSuperAdmin } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "SyncBiz Admin · Music taxonomy",
  robots: { index: false, follow: false },
};

function toDTO(row: MusicTaxonomyTagWithLinks): MusicTaxonomyTagDTO {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export default async function MusicTaxonomyAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; status?: string; q?: string }>;
}) {
  await requireSuperAdmin();

  const sp = await searchParams;
  const category =
    typeof sp.category === "string"
      ? parseMusicTaxonomyCategory(sp.category) ?? undefined
      : undefined;
  const status =
    typeof sp.status === "string"
      ? parseMusicTaxonomyStatus(sp.status) ?? undefined
      : undefined;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";

  const all = await loadAllMusicTaxonomyTags();
  const displayed = filterMusicTaxonomyTags(all, {
    category,
    status,
    q: q || undefined,
  });

  const catalog = all.map(toDTO);
  const rows = displayed.map(toDTO);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-baseline sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-neutral-500">
            <Link href="/admin/platform" className="text-sky-400 hover:underline">
              Platform
            </Link>
            <span className="text-neutral-600"> · </span>
            Music taxonomy
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-neutral-50">Music taxonomy dictionary</h1>
          <p className="mt-2 max-w-2xl text-sm text-neutral-400">
            Controlled vocabulary for SyncBiz music intelligence (Stage 3). Tenant-facing tagging UIs ship in later stages.
          </p>
        </div>
      </div>

      <form
        action="/admin/platform/music-taxonomy"
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-md border border-neutral-800 bg-neutral-900/40 p-4"
      >
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          Category
          <select
            name="category"
            defaultValue={category ?? ""}
            className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100"
          >
            <option value="">All</option>
            <option value="PLAYBACK_CONTEXT">PLAYBACK_CONTEXT</option>
            <option value="VIBE_ENERGY">VIBE_ENERGY</option>
            <option value="MAIN_SOUND_GENRE">MAIN_SOUND_GENRE</option>
            <option value="STYLE_TAGS">STYLE_TAGS</option>
            <option value="ISRAELI_SPECIALS">ISRAELI_SPECIALS</option>
            <option value="TECHNICAL_TAGS">TECHNICAL_TAGS</option>
            <option value="BUSINESS_FIT">BUSINESS_FIT</option>
            <option value="DAYPART_FIT">DAYPART_FIT</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          Status
          <select
            name="status"
            defaultValue={status ?? ""}
            className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100"
          >
            <option value="">All</option>
            <option value="ACTIVE">ACTIVE</option>
            <option value="DEPRECATED">DEPRECATED</option>
            <option value="HIDDEN">HIDDEN</option>
            <option value="MERGED">MERGED</option>
          </select>
        </label>

        <label className="flex min-w-[200px] flex-col gap-1 text-xs text-neutral-500">
          Search (slug / EN / HE / aliases)
          <input
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Search…"
            className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100"
          />
        </label>

        <button
          type="submit"
          className="rounded bg-neutral-100 px-3 py-2 text-xs font-semibold text-neutral-950 hover:bg-white"
        >
          Apply filters
        </button>

        {(category ?? status ?? q) ? (
          <Link
            href="/admin/platform/music-taxonomy"
            className="text-xs text-sky-400 hover:underline"
          >
            Clear filters
          </Link>
        ) : null}
      </form>

      <MusicTaxonomyTagsPanel catalogTags={catalog} displayedTags={rows} />
    </div>
  );
}
