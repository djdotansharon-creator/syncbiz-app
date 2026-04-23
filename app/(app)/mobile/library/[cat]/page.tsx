"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useParams, notFound } from "next/navigation";
import { MobilePageHeader } from "@/components/mobile/mobile-page-header";
import { MobilePlaylistCard } from "@/components/mobile/mobile-playlist-card";
import { useMobileSources } from "@/lib/mobile-sources-context";
import type { UnifiedSource } from "@/lib/source-types";

/**
 * Mobile Library — category view.
 *
 * Entered from /mobile/library via one of the three category tiles.
 * Shows a single 2-col grid of playlist cards for the chosen category.
 *
 * Valid categories (must match the landing page's hrefs):
 *   ready | tiles | yours
 *
 * Any other value 404s via `notFound()`.
 */
type Category = "ready" | "tiles" | "yours";

const CATEGORY_META: Record<Category, { title: string; subtitle: string }> = {
  ready: { title: "Ready Playlists", subtitle: "Imported, ready-to-use mixes" },
  tiles: { title: "Playlist Tiles", subtitle: "Composite scheduled pads" },
  yours: { title: "Your Playlists", subtitle: "Your personal collection & saved URLs" },
};

export default function MobileLibraryCategoryPage() {
  const params = useParams<{ cat: string }>();
  const catParam = params?.cat;
  const cat: Category | null =
    catParam === "ready" || catParam === "tiles" || catParam === "yours" ? catParam : null;

  if (!cat) {
    notFound();
  }

  const { sources, status, error, removeSource } = useMobileSources();

  const items = useMemo<UnifiedSource[]>(() => {
    const out: UnifiedSource[] = [];
    for (const s of sources) {
      if (s.origin === "source") {
        if (cat === "yours") out.push(s);
        continue;
      }
      if (s.origin !== "playlist") continue;
      const pl = s.playlist;
      const hasTileBlocks = !!(pl?.scheduleContributorBlocks && pl.scheduleContributorBlocks.length > 0);
      const isReady = pl?.libraryPlacement === "ready_external";
      if (cat === "tiles" && hasTileBlocks) out.push(s);
      else if (cat === "ready" && isReady && !hasTileBlocks) out.push(s);
      else if (cat === "yours" && !hasTileBlocks && !isReady) out.push(s);
    }
    return out;
  }, [sources, cat]);

  const meta = CATEGORY_META[cat];

  return (
    <>
      <MobilePageHeader
        title={meta.title}
        showModePill
        actions={
          <Link
            href="/mobile/library"
            aria-label="Back to Library"
            className="flex h-9 w-9 items-center justify-center rounded-full text-slate-300 hover:text-slate-100"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="m15 18-6-6 6-6" />
            </svg>
          </Link>
        }
      />

      <div className="px-4 pb-10 pt-3">
        <div className="mb-4 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-[17px] font-semibold tracking-tight text-slate-50">
                {meta.title}
              </h2>
              <span className="shrink-0 rounded-full bg-slate-800/80 px-2 py-0.5 text-[10px] font-semibold text-slate-300 ring-1 ring-slate-700/60">
                {items.length}
              </span>
            </div>
            <p className="mt-0.5 truncate text-[11px] text-slate-400">{meta.subtitle}</p>
          </div>
        </div>

        {status === "loading" && items.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-500">Loading…</div>
        ) : status === "error" ? (
          <div className="py-12 text-center text-sm text-rose-400">{error}</div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 px-4 py-10 text-center text-sm text-slate-400">
            <p className="mb-1 text-base font-semibold text-slate-200">Nothing here yet</p>
            <p>This category has no items.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {items.map((source) => (
              <MobilePlaylistCard
                key={source.id}
                source={source}
                onRemove={removeSource}
                editReturnTo={`/mobile/library/${cat}`}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
