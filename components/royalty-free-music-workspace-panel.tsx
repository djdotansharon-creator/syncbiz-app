"use client";

/**
 * Royalty-Free Music — center-monitor Sales Catalog (POC), Beatport-inspired information architecture
 * in the SyncBiz design language (dark, dense, catalog-first — not a marketing landing, not a file
 * browser).
 *
 *   Header        → title + dynamic horizontal Genre navigation (All | <genre> | …).
 *   All (home)    → grid of Genre Pack cards + a prominent Complete Music Bank bundle band.
 *   Genre detail  → artwork header + a single "Listen to Samples" action + dense sample list.
 *
 * Genres are DYNAMIC (from the generated catalog descriptor; no hardcoded list). Samples play through
 * the EXISTING chain: ephemeral local playlist → RAW playSource → AudioPlayer → PlaybackOrchestrator →
 * MPV. Local paths are desktop-only and never routed over WS.
 *
 * Concerns kept separate: Catalog metadata (what's shown) · Preview cache (playable bytes, NOT offline)
 * · Offline manifest (Keep-Offline, unrelated) · pricing (lib/music-bank/pricing.ts). Commerce CTAs are
 * disabled "Coming soon" until a payment layer exists.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePlayback } from "@/lib/playback-provider";
import { EPHEMERAL_LOCAL_PLAYLIST_PREFIX } from "@/lib/local-playlist-artwork";
import { formatDuration } from "@/lib/format-utils";
import type { Playlist, PlaylistTrack } from "@/lib/playlist-types";
import type { UnifiedSource } from "@/lib/source-types";
import { POC_MUSIC_BANK_CATALOG } from "@/lib/music-bank/poc-catalog";
import type { MusicBankGenrePack, MusicBankSampleTrack } from "@/lib/music-bank/catalog-types";
import { GENRE_PRICE_LABEL, CHOICE3_PRICE_LABEL, FULL_BANK_PRICE_LABEL, CHOICE3_PACK_COUNT } from "@/lib/music-bank/pricing";
import { GenrePackArt } from "@/components/music-bank/genre-pack-art";
import { subscribeMediaSession, hasMediaSessionToken } from "@/lib/media/media-session";
import { useDevicePlayer } from "@/lib/device-player-context";

type PreviewPathMap = Map<string, string>;
type ActiveView = "all" | string; // "all" or a genre id
type PlaybackMode = "stream" | "local"; // Stage A: "stream" = token-free /api/media/<id> via SyncBiz; "local" = preview-cache path

function totalDuration(tracks: MusicBankSampleTrack[]): number | null {
  const known = tracks.filter((t) => typeof t.durationSeconds === "number");
  if (known.length === 0) return null;
  return known.reduce((sum, t) => sum + (t.durationSeconds ?? 0), 0);
}

function PlayIcon({ className }: { className?: string }) {
  return <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>;
}

export function RoyaltyFreeMusicWorkspacePanel({ onClose }: { onClose: () => void }) {
  const { playSource } = usePlayback(); // RAW playSource — used ONLY for local-preview mode (desktop-local).
  const dp = useDevicePlayer(); // routed play + device role for Stream mode (CONTROL→MASTER).
  const deviceMode = dp?.deviceMode;
  const playSourceOrSend = dp?.playSourceOrSend ?? playSource;
  const [previewPaths, setPreviewPaths] = useState<PreviewPathMap>(() => new Map());
  const [bridgeChecked, setBridgeChecked] = useState(false);
  const [view, setView] = useState<ActiveView>("all");
  const [nowPlaying, setNowPlaying] = useState<{ genreId: string; trackId: string | null } | null>(null);
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>("stream");
  // Streaming readiness: the MASTER holds the media token (via <MasterMediaSession/>). A CONTROL never
  // holds a token — it just routes the token-free source to the MASTER, which plays with ITS token.
  const [hasMasterToken, setHasMasterToken] = useState(false);
  useEffect(() => {
    setHasMasterToken(hasMediaSessionToken());
    return subscribeMediaSession(() => setHasMasterToken(hasMediaSessionToken()));
  }, []);
  const streamReady = deviceMode === "CONTROL" ? true : hasMasterToken;

  const catalog = POC_MUSIC_BANK_CATALOG;
  const genres = catalog.genres;
  const selectedGenre = useMemo(() => (view === "all" ? null : genres.find((g) => g.id === view) ?? null), [genres, view]);

  // Ownership is entitlement-driven. The billing/entitlement backend is Coming Soon, so this resolves to
  // NONE today; the presentation is STATE-READY for none / partial / full and a real entitlement source
  // drops in here with no redesign. A dev-only ?rfm_owned=full|partial preview reviews the states now.
  const [ownedGenreIds, setOwnedGenreIds] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("rfm_owned");
    if (p === "full") setOwnedGenreIds(new Set(genres.map((g) => g.id)));
    else if (p === "partial") setOwnedGenreIds(new Set(genres.slice(0, 3).map((g) => g.id)));
    else setOwnedGenreIds(new Set());
  }, [genres]);
  const ownedCount = ownedGenreIds.size;
  const totalPacks = genres.length;
  const ownershipState: "none" | "partial" | "full" = ownedCount === 0 ? "none" : ownedCount >= totalPacks ? "full" : "partial";
  // Plans are on-demand (a quiet header action + popover), not an always-on strip.
  const [showPlans, setShowPlans] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const desktop = (
      window as unknown as {
        syncbizDesktop?: { getMusicBankPreviewPaths?: () => Promise<{ available: boolean; tracks?: { id: string; url: string }[]; reason?: string }> };
      }
    ).syncbizDesktop;
    if (!desktop || typeof desktop.getMusicBankPreviewPaths !== "function") {
      setBridgeChecked(true);
      return;
    }
    void desktop
      .getMusicBankPreviewPaths()
      .then((res) => {
        if (cancelled) return;
        const map: PreviewPathMap = new Map();
        if (res?.available && Array.isArray(res.tracks)) {
          for (const t of res.tracks) if (t?.id && t?.url) map.set(t.id, t.url);
        }
        setPreviewPaths(map);
        setBridgeChecked(true);
      })
      .catch(() => {
        if (!cancelled) setBridgeChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const isDesktop = useMemo(
    () => typeof window !== "undefined" && !!(window as unknown as { syncbizDesktop?: unknown }).syncbizDesktop,
    [],
  );

  /** True if a given track can play in the current mode. */
  const trackPlayable = useCallback(
    (id: string) => (playbackMode === "stream" ? streamReady : previewPaths.has(id)),
    [playbackMode, streamReady, previewPaths],
  );

  const buildSource = useCallback(
    (genre: MusicBankGenrePack, tracks: MusicBankSampleTrack[]): { source: UnifiedSource; playable: MusicBankSampleTrack[] } | null => {
      let plTracks: PlaylistTrack[];
      let playable: MusicBankSampleTrack[];
      if (playbackMode === "stream") {
        // Token-free SyncBiz media URL. getPlayUrl appends ?mt=<session token> on the MASTER at play
        // time — the token is NEVER stored here, so it never travels over WS / reaches CONTROL.
        if (!streamReady) return null;
        const base = typeof window !== "undefined" ? window.location.origin : "";
        playable = tracks;
        plTracks = playable.map((t) => ({
          id: t.id,
          name: t.title,
          type: "stream-url" as const,
          url: `${base}/api/media/${encodeURIComponent(t.id)}`,
        }));
      } else {
        // POC local preview cache (kept for A/B comparison): absolute local path → file:// on desktop.
        playable = tracks.filter((t) => previewPaths.has(t.id));
        plTracks = playable.map((t) => ({
          id: t.id,
          name: t.title,
          type: "local" as const,
          url: previewPaths.get(t.id)!,
        }));
      }
      if (plTracks.length === 0) return null;
      const first = plTracks[0].url;
      const ptype = playbackMode === "stream" ? "stream-url" : "local";
      const playlist: Playlist = {
        id: `${EPHEMERAL_LOCAL_PLAYLIST_PREFIX}musicbank-${genre.id}-${playbackMode}`,
        name: `${genre.name} — Samples`,
        genre: genre.name,
        type: ptype,
        url: first,
        thumbnail: "",
        createdAt: new Date().toISOString(),
        tracks: plTracks,
        order: plTracks.map((t) => t.id),
      };
      const source: UnifiedSource = { id: playlist.id, title: playlist.name, genre: genre.name, cover: null, type: ptype, url: first, origin: "playlist", playlist };
      return { source, playable };
    },
    [playbackMode, streamReady, previewPaths],
  );

  // Stream mode routes over WS (CONTROL→MASTER) with a token-free URL; Local mode is raw desktop-local.
  const playFn = playbackMode === "stream" ? playSourceOrSend : playSource;

  const playGenreSamples = useCallback(
    (genre: MusicBankGenrePack) => {
      const built = buildSource(genre, genre.tracks);
      if (!built) return;
      playFn(built.source, 0);
      setNowPlaying({ genreId: genre.id, trackId: built.playable[0]?.id ?? null });
    },
    [buildSource, playFn],
  );

  const playTrack = useCallback(
    (genre: MusicBankGenrePack, track: MusicBankSampleTrack) => {
      const built = buildSource(genre, genre.tracks);
      if (!built) return;
      const idx = built.playable.findIndex((t) => t.id === track.id);
      playFn(built.source, idx >= 0 ? idx : 0);
      setNowPlaying({ genreId: genre.id, trackId: track.id });
    },
    [buildSource, playFn],
  );

  const notPlayableHint =
    playbackMode === "stream"
      ? streamReady
        ? null
        : "Preparing streaming…"
      : bridgeChecked && !isDesktop
        ? "Open this catalog in the SyncBiz desktop player to preview the local samples."
        : bridgeChecked && isDesktop && previewPaths.size === 0
          ? "No samples cached on this device yet — run the catalog sync."
          : null;

  const totalSamples = catalog.totalTracks;

  return (
    <div className="sb-anim-rise flex max-h-[min(85vh,760px)] w-full min-h-0 flex-col overflow-hidden text-[#f5f5f7]">
      {/* Header — minimal: title + a quiet Plans/ownership action + transport toggle + close. Pricing is
          on-demand (popover), never an always-on strip → the music starts higher on the screen. */}
      <header className="relative flex items-center justify-between gap-3 px-5 pb-2 pt-3.5">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <h2 className="text-[15px] font-semibold tracking-tight text-white">Royalty-Free Music</h2>
          <span className="hidden truncate text-[11px] text-[#6b6b70] md:inline">{totalPacks} packs</span>
        </div>
        <div className="flex items-center gap-1.5">
          {ownershipState === "full" ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.05] px-2.5 py-1 text-[11px] font-medium text-[#c7c7cc]">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#7db8ff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 13l4 4L19 7" /></svg>
              {totalPacks}/{totalPacks} unlocked
            </span>
          ) : (
            <button type="button" onClick={() => setShowPlans((v) => !v)} title="Music Bank plans" aria-expanded={showPlans} className="inline-flex items-center gap-1 rounded-full bg-white/[0.05] px-2.5 py-1 text-[11px] font-medium text-[#c7c7cc] transition hover:bg-white/[0.09] hover:text-[#f5f5f7]">
              {ownershipState === "partial" ? `${ownedCount}/${totalPacks} unlocked` : "Plans"}
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`transition-transform ${showPlans ? "rotate-180" : ""}`}><path d="M6 9l6 6 6-6" /></svg>
            </button>
          )}
          {/* Stream/Local A/B (dev) — quiet segmented control, no hard frame. */}
          <div className="inline-flex overflow-hidden rounded-full bg-white/[0.045] p-0.5 text-[11px]">
            {(["stream", "local"] as PlaybackMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setPlaybackMode(m)}
                className={`rounded-full px-2.5 py-0.5 font-medium transition ${playbackMode === m ? "bg-[#0a84ff] text-white" : "text-[#9a9a9f] hover:text-[#f5f5f7]"}`}
                title={m === "stream" ? "SyncBiz HTTPS media streaming" : "Local preview cache (POC)"}
              >
                {m === "stream" ? "Stream" : "Local"}
              </button>
            ))}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" title="Close" className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[#8a8a8f] transition hover:bg-white/[0.06] hover:text-[#f5f5f7]">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        {/* Plans popover — on-demand, anchored to the header; a full-screen invisible backdrop closes it. */}
        {showPlans && ownershipState !== "full" ? (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowPlans(false)} aria-hidden="true" />
            <div className="absolute right-5 top-[calc(100%-4px)] z-50 w-64 overflow-hidden rounded-xl bg-[#15151a] shadow-[0_18px_50px_-16px_rgba(0,0,0,0.8)] ring-1 ring-inset ring-white/[0.08]">
              <p className="px-3.5 pb-1 pt-3 text-[10px] font-medium uppercase tracking-[0.14em] text-[#77777c]">Your Music Bank</p>
              {ownershipState === "partial" ? <p className="px-3.5 pb-1 text-[11px] text-[#9a9a9f]">{ownedCount}/{totalPacks} unlocked — complete the bank:</p> : null}
              <PlanRow label="1 Genre Pack" price={GENRE_PRICE_LABEL} />
              <PlanRow label={`Choose ${CHOICE3_PACK_COUNT} Genre Packs`} price={CHOICE3_PRICE_LABEL} />
              <PlanRow label="Full Music Bank" price={FULL_BANK_PRICE_LABEL} best />
              <p className="px-3.5 pb-3 pt-1.5 text-[10px] text-[#6b6b70]">Payments &amp; entitlements coming soon.</p>
            </div>
          </>
        ) : null}
      </header>

      {/* Genre navigation — quiet pills, separated by space, not a frame. */}
      <nav className="flex shrink-0 items-center gap-1.5 overflow-x-auto px-5 pb-2.5 pt-0.5 [scrollbar-width:thin]">
        <GenreNavPill label="All" active={view === "all"} onClick={() => setView("all")} />
        {genres.map((g) => (
          <GenreNavPill key={g.id} label={g.name} active={view === g.id} onClick={() => setView(g.id)} />
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {selectedGenre ? (
          <GenreDetail
            genre={selectedGenre}
            trackPlayable={trackPlayable}
            nowPlaying={nowPlaying}
            owned={ownedGenreIds.has(selectedGenre.id)}
            onPlaySamples={() => playGenreSamples(selectedGenre)}
            onPlayTrack={(t) => playTrack(selectedGenre, t)}
            onBack={() => setView("all")}
            notPlayableHint={notPlayableHint}
          />
        ) : (
          <CatalogHome genres={genres} totalSamples={totalSamples} ownedGenreIds={ownedGenreIds} ownershipState={ownershipState} onOpen={(id) => setView(id)} notPlayableHint={notPlayableHint} />
        )}
      </div>
    </div>
  );
}

function GenreNavPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition ${
        active ? "bg-[#0a84ff] text-white" : "text-[#9a9a9f] hover:bg-white/[0.05] hover:text-[#f5f5f7]"
      }`}
    >
      {label}
    </button>
  );
}

/** A single plan row inside the on-demand Plans popover — calm, flat; accent only as a subtle tint. */
function PlanRow({ label, price, best }: { label: string; price: string; best?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 px-3.5 py-2 ${best ? "bg-[#0a84ff]/[0.08]" : ""}`}>
      <span className="flex items-center gap-1.5 text-[13px] text-[#e2e8f0]">
        {label}
        {best ? <span className="text-[9px] font-bold uppercase tracking-wider text-[#7db8ff]">Best</span> : null}
      </span>
      <span className="flex items-center gap-2">
        <span className="text-[13px] font-semibold tabular-nums text-white">{price}</span>
        <button type="button" disabled title="Coming soon" className="cursor-not-allowed rounded-md px-2 py-0.5 text-[10px] font-semibold text-[#8a8a8f] ring-1 ring-inset ring-white/[0.1]">Unlock</button>
      </span>
    </div>
  );
}

/** Cinematic per-pack hero art (thematic motif + colour grade + lighting). See genre-pack-art.tsx. */
function GenreCover({ genre }: { genre: MusicBankGenrePack }) {
  return <GenrePackArt id={genre.id} />;
}

function CatalogHome({
  genres,
  totalSamples,
  ownedGenreIds,
  ownershipState,
  onOpen,
  notPlayableHint,
}: {
  genres: MusicBankGenrePack[];
  totalSamples: number;
  ownedGenreIds: Set<string>;
  ownershipState: "none" | "partial" | "full";
  onOpen: (id: string) => void;
  notPlayableHint: string | null;
}) {
  return (
    <>
      {/* Genre Packs — the hero. 4-across on wide desktop, degrading gracefully (never forced too narrow). */}
      <div className="grid grid-cols-1 gap-3 px-5 py-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {genres.map((genre) => {
          const total = totalDuration(genre.tracks);
          const owned = ownedGenreIds.has(genre.id);
          return (
            <div key={genre.id} className="group flex flex-col overflow-hidden rounded-2xl bg-white/[0.02] ring-1 ring-inset ring-white/[0.05] transition duration-200 hover:ring-white/[0.14] hover:shadow-[0_18px_44px_-26px_rgba(0,0,0,0.9)]">
              <button type="button" onClick={() => onOpen(genre.id)} className="relative flex aspect-[16/10] items-end p-3.5 text-left">
                <GenreCover genre={genre} />
                <span className="absolute left-3 top-3 rounded-full bg-black/35 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/85 backdrop-blur-sm">Genre Pack</span>
                {owned ? (
                  <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-[#0a84ff]/85 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 13l4 4L19 7" /></svg>
                    Unlocked
                  </span>
                ) : (
                  <span className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/35 text-white opacity-0 backdrop-blur-sm transition group-hover:opacity-100"><PlayIcon className="h-3.5 w-3.5" /></span>
                )}
                <div className="relative">
                  <h3 className="text-lg font-semibold leading-tight tracking-tight text-white drop-shadow">{genre.name}</h3>
                  <p className="mt-0.5 text-[11px] font-medium text-white/85">
                    {genre.tracks.length} samples{total != null ? ` · ${formatDuration(total)}` : ""}
                  </p>
                </div>
              </button>
              <div className="flex items-center justify-between gap-2 px-3.5 py-2.5">
                <button type="button" onClick={() => onOpen(genre.id)} className="text-xs font-medium text-[#68b0ff] transition hover:text-[#9cccff]">Listen to samples →</button>
                {owned ? (
                  <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#7db8ff]">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 13l4 4L19 7" /></svg>
                    Owned
                  </span>
                ) : (
                  <span className="flex items-baseline gap-2">
                    <span className="text-sm font-semibold tabular-nums text-[#f5f5f7]">{GENRE_PRICE_LABEL}</span>
                    <button type="button" disabled title="Coming soon" className="cursor-not-allowed rounded-md px-2.5 py-1 text-[11px] font-semibold text-[#8a8a8f] ring-1 ring-inset ring-white/[0.1]">Unlock</button>
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Pricing lives in the top ownership strip, not a wall of sales boxes down here. Just a quiet footnote. */}
      {ownershipState !== "full" ? (
        <p className="px-5 pb-4 pt-1 text-[11px] text-[#77777c]">Proposed monthly pricing — payments &amp; entitlements coming soon. Samples preview now (not Offline Ready).</p>
      ) : null}

      {notPlayableHint ? <p className="px-5 pb-5 text-[11px] text-[#6b6b70]">{notPlayableHint}</p> : null}
    </>
  );
}

function GenreDetail({
  genre,
  trackPlayable,
  nowPlaying,
  owned,
  onPlaySamples,
  onPlayTrack,
  onBack,
  notPlayableHint,
}: {
  genre: MusicBankGenrePack;
  trackPlayable: (id: string) => boolean;
  nowPlaying: { genreId: string; trackId: string | null } | null;
  owned: boolean;
  onPlaySamples: () => void;
  onPlayTrack: (t: MusicBankSampleTrack) => void;
  onBack: () => void;
  notPlayableHint: string | null;
}) {
  const total = totalDuration(genre.tracks);
  const genrePlayable = genre.tracks.some((t) => trackPlayable(t.id));
  return (
    <>
      {/* Genre header */}
      <section className="relative overflow-hidden px-5 py-5">
        <GenreCover genre={genre} />
        <div className="absolute inset-0 bg-black/25" aria-hidden="true" />
        <div className="relative">
          <button type="button" onClick={onBack} className="mb-3 inline-flex items-center gap-1 rounded-md border border-white/25 px-2.5 py-1 text-xs text-white/90 transition hover:bg-white/10">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
            All genres
          </button>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/80">Genre Pack</p>
          <h1 className="mt-0.5 text-2xl font-semibold leading-tight tracking-tight text-white drop-shadow">{genre.name}</h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-white/85">{genre.description}</p>
          <p className="mt-1.5 text-[11px] font-medium text-white/75">{genre.tracks.length} samples{total != null ? ` · ${formatDuration(total)}` : ""}</p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {/* Single CTA — plays the pack's FULL sample set through the existing playlist queue. */}
            <button type="button" disabled={!genrePlayable} onClick={onPlaySamples} className="inline-flex items-center gap-1.5 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-[#101014] transition hover:bg-white/90 disabled:cursor-not-allowed disabled:bg-white/30 disabled:text-white/60">
              <PlayIcon className="h-3.5 w-3.5" />
              Listen to Samples
            </button>
            {owned ? (
              <span className="ms-auto inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white/90">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 13l4 4L19 7" /></svg>
                Owned
              </span>
            ) : (
              <span className="ms-auto flex items-center gap-2">
                <span className="text-lg font-bold tabular-nums text-white">{GENRE_PRICE_LABEL}</span>
                <button type="button" disabled title="Coming soon" className="cursor-not-allowed rounded-lg px-3 py-1.5 text-xs font-semibold text-white/85 ring-1 ring-inset ring-white/25">Unlock Genre Pack</button>
              </span>
            )}
          </div>
        </div>
      </section>

      {notPlayableHint ? <p className="px-5 pt-3 text-[11px] text-[#6b6b70]">{notPlayableHint}</p> : null}

      {/* Dense track list */}
      <ul className="px-2 py-2">
        {genre.tracks.map((track, i) => {
          const isPlayable = trackPlayable(track.id);
          const active = nowPlaying?.genreId === genre.id && nowPlaying?.trackId === track.id;
          return (
            <li key={track.id} className={`group flex items-center gap-3 rounded-md px-2.5 py-1.5 transition ${active ? "bg-[#0a84ff]/12" : "hover:bg-white/[0.03]"}`}>
              <span className={`w-5 shrink-0 text-right text-[11px] tabular-nums ${active ? "text-[#7db8ff]" : "text-[#5a5a5f]"}`}>{i + 1}</span>
              <button
                type="button"
                disabled={!isPlayable}
                onClick={() => onPlayTrack(track)}
                className="relative inline-flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded text-white transition disabled:cursor-not-allowed"
                style={{ backgroundImage: `linear-gradient(140deg, ${genre.gradient[0]} 0%, ${genre.gradient[1]} 100%)` }}
                aria-label={`Play ${track.title}`}
              >
                <span className={`absolute inset-0 transition ${isPlayable ? "bg-black/30 group-hover:bg-black/10" : "bg-black/55"}`} />
                <PlayIcon className={`relative h-3.5 w-3.5 ${isPlayable ? "" : "opacity-40"}`} />
              </button>
              <span className={`min-w-0 flex-1 truncate text-sm ${active ? "font-medium text-[#f5f5f7]" : "text-[#d1d1d6]"}`}>{track.title}</span>
              {active ? <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-[#7db8ff]">Playing</span> : null}
              <span className="shrink-0 text-xs tabular-nums text-[#8a8a8f]">{typeof track.durationSeconds === "number" ? formatDuration(track.durationSeconds) : "—"}</span>
            </li>
          );
        })}
      </ul>
    </>
  );
}
