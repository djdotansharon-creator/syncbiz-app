"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { MobilePageHeader } from "@/components/mobile/mobile-page-header";
import { MobilePlaylistCard } from "@/components/mobile/mobile-playlist-card";
import { GuestLinkButton, guestLinkLedButtonClass } from "@/components/guest-link-button";
import { useMobileSources } from "@/lib/mobile-sources-context";
import type { UnifiedSource } from "@/lib/source-types";

/**
 * Mobile Library — music-first visual hub.
 *
 * Content classification (matches desktop `components/sources-manager.tsx`):
 *   • our        = playlist, `playlistOwnershipScope !== "branch"`, not
 *                   imported / not scheduled (owner's personal bank or
 *                   legacy rows with no ownership scope)
 *   • imported   = `playlist.libraryPlacement === "ready_external"`
 *                   (YouTube Mix imports and other "Ready Playlists")
 *   • scheduled  = playlist with `scheduleContributorBlocks[]` non-empty
 *                   (composite scheduled playlists — the desktop
 *                   "scheduled" / curated lane)
 *   • shared     = `playlist.playlistOwnershipScope === "branch"` — branch
 *                   catalog items shared with the organization
 *   • urls       = `origin === "source"` — single URLs / single tracks
 *
 * Classification priority (when a row matches multiple flags):
 *   scheduled > imported > shared > our
 *
 * Two branch-scoped action pills — "My link" and "Guest link" — sit above
 * the filters, mirroring the amber LED pair from the desktop sources rail.
 * `GuestLinkButton` auto-hides when the session is not connected.
 *
 * Radio is intentionally excluded from the mobile IA (no tile, no filter,
 * no deep-link flow). Desktop Radio remains untouched.
 */
type FilterKey = "all" | "our" | "imported" | "scheduled" | "shared" | "urls";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "our", label: "Our" },
  { key: "imported", label: "Imported" },
  { key: "scheduled", label: "Scheduled" },
  { key: "shared", label: "Shared" },
  { key: "urls", label: "URLs" },
];

const SECTIONS: { key: Exclude<FilterKey, "all">; title: string; subtitle: string }[] = [
  { key: "our", title: "Our Playlists", subtitle: "Your personal collection" },
  { key: "imported", title: "Imported", subtitle: "Ready-to-use playlists you imported" },
  { key: "scheduled", title: "Scheduled", subtitle: "Composite scheduled playlists" },
  { key: "shared", title: "Shared", subtitle: "Branch-shared playlists" },
  { key: "urls", title: "URLs", subtitle: "Single tracks & direct links" },
];

export default function MobileLibraryPage() {
  const { sources, status, error, removeSource, reload } = useMobileSources();
  const [filter, setFilter] = useState<FilterKey>("all");

  const buckets = useMemo(() => {
    const our: UnifiedSource[] = [];
    const imported: UnifiedSource[] = [];
    const scheduled: UnifiedSource[] = [];
    const shared: UnifiedSource[] = [];
    const urls: UnifiedSource[] = [];

    for (const s of sources) {
      if (s.origin === "source") {
        urls.push(s);
        continue;
      }
      if (s.origin !== "playlist") continue;
      const pl = s.playlist;
      if (pl?.scheduleContributorBlocks && pl.scheduleContributorBlocks.length > 0) {
        scheduled.push(s);
      } else if (pl?.libraryPlacement === "ready_external") {
        imported.push(s);
      } else if (pl?.playlistOwnershipScope === "branch") {
        shared.push(s);
      } else {
        our.push(s);
      }
      // Radio intentionally dropped.
    }

    return { our, imported, scheduled, shared, urls };
  }, [sources]);

  const total =
    buckets.our.length +
    buckets.imported.length +
    buckets.scheduled.length +
    buckets.shared.length +
    buckets.urls.length;

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

      <div className="px-4 pb-10 pt-3">
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
        <div className="-mx-4 mb-5 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
          <div className="py-12 text-center text-sm text-slate-500">Loading library…</div>
        ) : status === "error" ? (
          <div className="py-12 text-center text-sm text-rose-400">{error}</div>
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
  our: UnifiedSource[];
  imported: UnifiedSource[];
  scheduled: UnifiedSource[];
  shared: UnifiedSource[];
  urls: UnifiedSource[];
};

function bucketFor(buckets: Buckets, filter: FilterKey): UnifiedSource[] {
  switch (filter) {
    case "our":
      return buckets.our;
    case "imported":
      return buckets.imported;
    case "scheduled":
      return buckets.scheduled;
    case "shared":
      return buckets.shared;
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
    <div className="flex flex-col gap-8">
      {SECTIONS.map((s) => (
        <Section
          key={s.key}
          title={s.title}
          subtitle={s.subtitle}
          items={buckets[s.key]}
          removeSource={removeSource}
        />
      ))}
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
      {/* Premium section header: title + count chip + subtitle. Slightly larger
          than the prior MobileSectionHeader so sections read as the primary
          navigational element on the page. */}
      <div className="mb-3.5 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-[17px] font-semibold tracking-tight text-slate-50">
              {title}
            </h2>
            <span className="shrink-0 rounded-full bg-slate-800/80 px-2 py-0.5 text-[10px] font-semibold text-slate-300 ring-1 ring-slate-700/60">
              {items.length}
            </span>
          </div>
          <p className="mt-0.5 truncate text-[11px] text-slate-400">{subtitle}</p>
        </div>
      </div>
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
      <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 px-4 py-10 text-center text-sm text-slate-400">
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
    <div className="grid grid-cols-2 gap-4">
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
