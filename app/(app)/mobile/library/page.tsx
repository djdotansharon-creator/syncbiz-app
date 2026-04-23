"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { MobilePageHeader } from "@/components/mobile/mobile-page-header";
import { MobileSectionHeader } from "@/components/mobile/mobile-section-header";
import { MobilePlaylistCard } from "@/components/mobile/mobile-playlist-card";
import { GuestLinkButton, guestLinkLedButtonClass } from "@/components/guest-link-button";
import { useMobileSources } from "@/lib/mobile-sources-context";
import type { UnifiedSource } from "@/lib/source-types";

/**
 * Mobile Library — the single hub for every collection or URL the branch
 * owns, laid out as big 2-col cover tiles (inspired by the user's image-3
 * reference) with a filter-pill bar at the top (image-2 reference).
 *
 * Content classification (matches desktop sources-manager rails):
 *   • Our Playlists    = playlist, not ready_external, not composite-scheduled
 *   • Imported         = playlist with `libraryPlacement === "ready_external"`
 *                        (YouTube Mix imports and other "Ready Playlists")
 *   • Curated          = playlist that carries `scheduleContributorBlocks`
 *                        (composite scheduled playlist — the desktop
 *                        "scheduled/curated" lane)
 *   • URLs             = `origin === "source"` single-URL tracks
 *
 * Two branch-scoped actions — "My link" and "Guest link" — live on top of
 * the list, mirroring the amber LED pills from the desktop sources rail.
 * `GuestLinkButton` auto-hides when the session is not connected.
 *
 * Radio is intentionally excluded from the mobile IA (no tile, no filter,
 * no deep-link flow). Desktop Radio remains untouched.
 */
type FilterKey = "all" | "playlists" | "imported" | "curated" | "urls";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "playlists", label: "Playlists" },
  { key: "imported", label: "Imported" },
  { key: "curated", label: "Curated" },
  { key: "urls", label: "URLs" },
];

export default function MobileLibraryPage() {
  const { sources, status, error, removeSource, reload } = useMobileSources();
  const [filter, setFilter] = useState<FilterKey>("all");

  const buckets = useMemo(() => {
    const playlists: UnifiedSource[] = [];
    const imported: UnifiedSource[] = [];
    const curated: UnifiedSource[] = [];
    const urls: UnifiedSource[] = [];

    for (const s of sources) {
      if (s.origin === "playlist") {
        const pl = s.playlist;
        if (pl?.libraryPlacement === "ready_external") {
          imported.push(s);
        } else if (pl?.scheduleContributorBlocks && pl.scheduleContributorBlocks.length > 0) {
          curated.push(s);
        } else {
          playlists.push(s);
        }
      } else if (s.origin === "source") {
        urls.push(s);
      }
      // Radio intentionally dropped.
    }

    return { playlists, imported, curated, urls };
  }, [sources]);

  const total =
    buckets.playlists.length + buckets.imported.length + buckets.curated.length + buckets.urls.length;

  return (
    <>
      <MobilePageHeader
        title="Your Library"
        showModePill
        actions={
          <button
            type="button"
            onClick={reload}
            aria-label="Refresh"
            className="flex h-9 w-9 items-center justify-center rounded-full text-slate-300 hover:text-slate-100"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M3 12a9 9 0 0 1 15-6.7L21 8" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M21 3v5h-5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M21 12a9 9 0 0 1-15 6.7L3 16" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M3 21v-5h5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        }
      />

      <div className="px-4 pb-8 pt-3">
        {/* Branch-action row — My link + Guest link (mirrors desktop rail). */}
        <div className="mb-4 flex flex-wrap gap-2">
          <button
            type="button"
            className={guestLinkLedButtonClass}
            aria-label="My link (placeholder)"
            title="My link"
          >
            <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
              <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
            </svg>
            <span>My link</span>
          </button>
          <GuestLinkButton />
        </div>

        {/* Filter pills — horizontal scroll so extra filters don't break layout on narrow phones. */}
        <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {FILTERS.map((f) => {
            const isActive = filter === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${
                  isActive
                    ? "border-cyan-400/70 bg-cyan-500/15 text-cyan-100 shadow-[0_0_0_1px_rgba(34,211,238,0.35),0_0_18px_-6px_rgba(34,211,238,0.5)]"
                    : "border-slate-700/70 bg-slate-900/60 text-slate-300 hover:border-slate-500/70 hover:text-slate-100"
                }`}
                aria-pressed={isActive}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        {status === "loading" && total === 0 ? (
          <div className="py-10 text-center text-sm text-slate-500">Loading library…</div>
        ) : status === "error" ? (
          <div className="py-10 text-center text-sm text-rose-400">{error}</div>
        ) : total === 0 ? (
          <EmptyState />
        ) : filter === "all" ? (
          <AllView buckets={buckets} removeSource={removeSource} />
        ) : (
          <FilteredView
            items={bucketFor(buckets, filter)}
            removeSource={removeSource}
          />
        )}
      </div>
    </>
  );
}

type Buckets = {
  playlists: UnifiedSource[];
  imported: UnifiedSource[];
  curated: UnifiedSource[];
  urls: UnifiedSource[];
};

function bucketFor(buckets: Buckets, filter: FilterKey): UnifiedSource[] {
  switch (filter) {
    case "playlists":
      return buckets.playlists;
    case "imported":
      return buckets.imported;
    case "curated":
      return buckets.curated;
    case "urls":
      return buckets.urls;
    default:
      return [];
  }
}

function AllView({
  buckets,
  removeSource,
}: {
  buckets: Buckets;
  removeSource: (id: string, origin?: UnifiedSource["origin"]) => void;
}) {
  return (
    <div className="flex flex-col gap-7">
      <Section
        title="Your Playlists"
        subtitle={`${buckets.playlists.length} playlist${buckets.playlists.length === 1 ? "" : "s"}`}
        items={buckets.playlists}
        removeSource={removeSource}
      />
      <Section
        title="Imported"
        subtitle="Ready-to-use playlists you imported"
        items={buckets.imported}
        removeSource={removeSource}
      />
      <Section
        title="Curated"
        subtitle="Composite scheduled playlists"
        items={buckets.curated}
        removeSource={removeSource}
      />
      <Section
        title="URLs"
        subtitle="Single tracks & direct links"
        items={buckets.urls}
        removeSource={removeSource}
      />
    </div>
  );
}

function Section({
  title,
  subtitle,
  items,
  removeSource,
}: {
  title: string;
  subtitle: string;
  items: UnifiedSource[];
  removeSource: (id: string, origin?: UnifiedSource["origin"]) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section>
      <MobileSectionHeader title={title} subtitle={subtitle} />
      <Grid items={items} removeSource={removeSource} />
    </section>
  );
}

function FilteredView({
  items,
  removeSource,
}: {
  items: UnifiedSource[];
  removeSource: (id: string, origin?: UnifiedSource["origin"]) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 px-4 py-8 text-center text-sm text-slate-400">
        Nothing here yet.
      </div>
    );
  }
  return <Grid items={items} removeSource={removeSource} />;
}

function Grid({
  items,
  removeSource,
}: {
  items: UnifiedSource[];
  removeSource: (id: string, origin?: UnifiedSource["origin"]) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3.5">
      {items.map((source) => (
        <MobilePlaylistCard
          key={source.id}
          source={source}
          onRemove={removeSource}
          editReturnTo="/mobile/library"
        />
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 px-4 py-10 text-center text-sm text-slate-400">
      <p className="mb-1 text-base font-semibold text-slate-200">Your library is empty</p>
      <p className="mb-4">Add your first playlist or URL from Search.</p>
      <Link
        href="/mobile/search"
        className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/70 bg-cyan-500/15 px-4 py-2 text-sm font-semibold text-cyan-100 shadow-[0_0_0_1px_rgba(34,211,238,0.35),0_0_18px_-6px_rgba(34,211,238,0.5)] transition hover:border-cyan-300"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" strokeLinecap="round" />
        </svg>
        Open Search
      </Link>
    </div>
  );
}
