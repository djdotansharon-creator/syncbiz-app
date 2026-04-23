"use client";

import { useMemo, useState } from "react";
import { MobilePageHeader } from "@/components/mobile/mobile-page-header";
import { MobileLibraryCategoryTile } from "@/components/mobile/mobile-library-category-tile";
import { useMobileSources } from "@/lib/mobile-sources-context";
import { useDevicePlayer } from "@/lib/device-player-context";

/**
 * Mobile Library — category-first landing page.
 *
 * Top-level IA (the user sees ONLY category tiles here, never a mixed grid):
 *   Collections
 *     1. Ready Playlists    → /mobile/library/ready
 *     2. Playlist Tiles     → /mobile/library/tiles
 *     3. Your Playlists     → /mobile/library/yours
 *   Share
 *     4. My link            → inline action (placeholder, future endpoint)
 *     5. Guest link         → inline action (copy to clipboard)
 *
 * Category → playlist mapping mirrors `components/sources-manager.tsx`:
 *   • Ready Playlists   = playlist.libraryPlacement === "ready_external"
 *   • Playlist Tiles    = playlist.scheduleContributorBlocks[] non-empty
 *                         (the desktop daypart/tile lane)
 *   • Your Playlists    = everything else (personal bank, branch-shared,
 *                         and `origin === "source"` single URLs — all the
 *                         user-curated content that isn't Ready or Tiles)
 *
 * Radio is intentionally excluded from the mobile IA (no tile, no filter,
 * no deep-link flow). Desktop Radio remains untouched.
 */
export default function MobileLibraryPage() {
  const { sources, status, error, reload } = useMobileSources();
  const deviceCtx = useDevicePlayer();
  const guestLink = deviceCtx?.guestLink ?? null;
  const isBranchConnected = deviceCtx?.isBranchConnected ?? false;

  const { counts, covers } = useMemo(() => {
    let rReady = 0;
    let rTiles = 0;
    let rYours = 0;
    // Cover picks — first item in each bucket that has a usable cover URL.
    // We prefer the playlist-level cover (source.cover); when missing,
    // fall back to the first track inside the playlist that has one.
    let cReady: string | null = null;
    let cTiles: string | null = null;
    let cYours: string | null = null;

    const pickCover = (s: (typeof sources)[number]): string | null => {
      if (s.cover) return s.cover;
      const tracks = s.playlist?.tracks;
      if (tracks && tracks.length) {
        const t = tracks.find((t) => t.cover);
        return t?.cover ?? null;
      }
      return null;
    };

    for (const s of sources) {
      if (s.origin === "source") {
        rYours += 1;
        if (!cYours) cYours = pickCover(s);
        continue;
      }
      if (s.origin !== "playlist") continue;
      const pl = s.playlist;
      if (pl?.scheduleContributorBlocks && pl.scheduleContributorBlocks.length > 0) {
        rTiles += 1;
        if (!cTiles) cTiles = pickCover(s);
      } else if (pl?.libraryPlacement === "ready_external") {
        rReady += 1;
        if (!cReady) cReady = pickCover(s);
      } else {
        rYours += 1;
        if (!cYours) cYours = pickCover(s);
      }
    }
    return {
      counts: { ready: rReady, tiles: rTiles, yours: rYours },
      covers: { ready: cReady, tiles: cTiles, yours: cYours },
    };
  }, [sources]);

  const [myLinkNote, setMyLinkNote] = useState<string | null>(null);
  const [guestLinkNote, setGuestLinkNote] = useState<string | null>(null);

  async function handleCopyGuestLink() {
    if (!guestLink) return;
    try {
      await navigator.clipboard.writeText(guestLink);
      setGuestLinkNote("Copied");
      setTimeout(() => setGuestLinkNote(null), 2000);
    } catch {
      setGuestLinkNote("Copy failed");
      setTimeout(() => setGuestLinkNote(null), 2000);
    }
  }

  function handleMyLink() {
    // Placeholder — desktop side still has this as a placeholder button.
    setMyLinkNote("Coming soon");
    setTimeout(() => setMyLinkNote(null), 1800);
  }

  const guestDisabled = !isBranchConnected || !guestLink;
  const guestSubtitle = guestDisabled
    ? "Connect a branch session first"
    : guestLinkNote === "Copied"
    ? "Link copied to clipboard"
    : "Share a recommendation link";

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
        {status === "loading" && sources.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-500">Loading library…</div>
        ) : status === "error" ? (
          <div className="py-12 text-center text-sm text-rose-400">{error}</div>
        ) : (
          <>
            <SectionLabel>Collections</SectionLabel>

            {/* Hero tile — Your Playlists is the primary destination. */}
            <div className="mb-3">
              <MobileLibraryCategoryTile
                label="Your Playlists"
                subtitle="Your personal collection & saved URLs"
                href="/mobile/library/yours"
                gradient="from-sky-500 to-cyan-700"
                count={counts.yours}
                variant="hero"
                icon={<YoursIcon />}
                coverUrl={covers.yours}
              />
            </div>

            {/* Secondary row: Ready + Tiles. */}
            <div className="mb-7 grid grid-cols-2 gap-3">
              <MobileLibraryCategoryTile
                label="Ready Playlists"
                subtitle="Imported, ready-to-use mixes"
                href="/mobile/library/ready"
                gradient="from-emerald-500 to-teal-700"
                count={counts.ready}
                icon={<ReadyIcon />}
                coverUrl={covers.ready}
              />
              <MobileLibraryCategoryTile
                label="Playlist Tiles"
                subtitle="Composite scheduled pads"
                href="/mobile/library/tiles"
                gradient="from-amber-500 to-orange-700"
                count={counts.tiles}
                icon={<TilesIcon />}
                coverUrl={covers.tiles}
              />
            </div>

            <SectionLabel>Share</SectionLabel>

            <div className="grid grid-cols-2 gap-3">
              <MobileLibraryCategoryTile
                label="My link"
                subtitle={myLinkNote === "Coming soon" ? "Coming soon" : "Your personal branch link"}
                onClick={handleMyLink}
                gradient="from-rose-500 to-pink-700"
                statusNote={myLinkNote}
                icon={<LinkIcon />}
                ariaLabel="My link (placeholder)"
              />
              <MobileLibraryCategoryTile
                label="Guest link"
                subtitle={guestSubtitle}
                onClick={handleCopyGuestLink}
                gradient="from-violet-500 to-fuchsia-700"
                statusNote={guestLinkNote}
                icon={<GuestIcon />}
                disabled={guestDisabled}
                ariaLabel="Copy guest recommendation link"
              />
            </div>
          </>
        )}
      </div>
    </>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2.5 px-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
      {children}
    </p>
  );
}

/* ── Tile icons ──
   Uniform 1.7 stroke weight; shared rotation is applied by the tile
   wrapper itself (rotate-[20deg]). */

function YoursIcon() {
  return (
    <svg className="h-14 w-14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="4.5" width="10.5" height="14" rx="1.6" />
      <path d="M12 9.2h5M12 12h3.5" />
      <path d="M9 6.6 A 5.4 5.4 0 0 0 9 17.4" />
      <path d="M9 9.3 A 2.7 2.7 0 0 0 9 14.7" />
      <circle cx="9" cy="12" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ReadyIcon() {
  // Stacked discs / ready-to-use mixes.
  return (
    <svg className="h-14 w-14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="6.5" />
      <circle cx="12" cy="12" r="2.2" />
      <circle cx="12" cy="12" r="0.9" fill="currentColor" stroke="none" />
      <path d="M4 7.5 A 7 7 0 0 0 4 16.5" strokeOpacity="1" />
      <path d="M20 7.5 A 7 7 0 0 1 20 16.5" strokeOpacity="1" />
    </svg>
  );
}

function TilesIcon() {
  // 2x2 tile grid — matches the desktop daypart pad language.
  return (
    <svg className="h-14 w-14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.4" />
      <rect x="13" y="3.5" width="7.5" height="7.5" rx="1.4" />
      <rect x="3.5" y="13" width="7.5" height="7.5" rx="1.4" />
      <rect x="13" y="13" width="7.5" height="7.5" rx="1.4" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg className="h-14 w-14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
      <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
    </svg>
  );
}

function GuestIcon() {
  // Two figures — the "share with a guest" metaphor from the desktop rail.
  return (
    <svg className="h-14 w-14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
