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
import { GENRE_PRICE_LABEL, FULL_BANK_PRICE_LABEL } from "@/lib/music-bank/pricing";

type PreviewPathMap = Map<string, string>;
type ActiveView = "all" | string; // "all" or a genre id

function totalDuration(tracks: MusicBankSampleTrack[]): number | null {
  const known = tracks.filter((t) => typeof t.durationSeconds === "number");
  if (known.length === 0) return null;
  return known.reduce((sum, t) => sum + (t.durationSeconds ?? 0), 0);
}

function PlayIcon({ className }: { className?: string }) {
  return <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>;
}

export function RoyaltyFreeMusicWorkspacePanel({ onClose }: { onClose: () => void }) {
  const { playSource } = usePlayback(); // RAW playSource — desktop-local, never routed over WS.
  const [previewPaths, setPreviewPaths] = useState<PreviewPathMap>(() => new Map());
  const [bridgeChecked, setBridgeChecked] = useState(false);
  const [view, setView] = useState<ActiveView>("all");
  const [nowPlaying, setNowPlaying] = useState<{ genreId: string; trackId: string | null } | null>(null);

  const catalog = POC_MUSIC_BANK_CATALOG;
  const genres = catalog.genres;
  const selectedGenre = useMemo(() => (view === "all" ? null : genres.find((g) => g.id === view) ?? null), [genres, view]);

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

  const buildSource = useCallback(
    (genre: MusicBankGenrePack, tracks: MusicBankSampleTrack[]): { source: UnifiedSource; playable: MusicBankSampleTrack[] } | null => {
      const playable = tracks.filter((t) => previewPaths.has(t.id));
      if (playable.length === 0) return null;
      const plTracks: PlaylistTrack[] = playable.map((t) => ({
        id: t.id,
        name: t.title,
        type: "local" as const,
        url: previewPaths.get(t.id)!, // absolute local path → mpv-input-normalize → file:// on desktop
      }));
      const first = plTracks[0].url;
      const playlist: Playlist = {
        id: `${EPHEMERAL_LOCAL_PLAYLIST_PREFIX}musicbank-${genre.id}-samples`,
        name: `${genre.name} — Samples`,
        genre: genre.name,
        type: "local",
        url: first,
        thumbnail: "",
        createdAt: new Date().toISOString(),
        tracks: plTracks,
        order: plTracks.map((t) => t.id),
      };
      const source: UnifiedSource = { id: playlist.id, title: playlist.name, genre: genre.name, cover: null, type: "local", url: first, origin: "playlist", playlist };
      return { source, playable };
    },
    [previewPaths],
  );

  const playGenreSamples = useCallback(
    (genre: MusicBankGenrePack) => {
      const built = buildSource(genre, genre.tracks);
      if (!built) return;
      playSource(built.source, 0);
      setNowPlaying({ genreId: genre.id, trackId: built.playable[0]?.id ?? null });
    },
    [buildSource, playSource],
  );

  const playTrack = useCallback(
    (genre: MusicBankGenrePack, track: MusicBankSampleTrack) => {
      const built = buildSource(genre, genre.tracks);
      if (!built) return;
      const idx = built.playable.findIndex((t) => t.id === track.id);
      playSource(built.source, idx >= 0 ? idx : 0);
      setNowPlaying({ genreId: genre.id, trackId: track.id });
    },
    [buildSource, playSource],
  );

  const notPlayableHint =
    bridgeChecked && !isDesktop
      ? "Open this catalog in the SyncBiz desktop player to preview the samples."
      : bridgeChecked && isDesktop && previewPaths.size === 0
        ? "No samples cached on this device yet — run the catalog sync."
        : null;

  const totalSamples = catalog.totalTracks;

  return (
    <div className="sb-anim-rise flex max-h-[min(85vh,760px)] w-full min-h-0 flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0c0c0f] text-[#f5f5f7]">
      {/* Header */}
      <header className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-[#0a84ff]/15 text-[#7db8ff]"><PlayIcon className="h-3 w-3" /></span>
          <h2 className="text-sm font-semibold tracking-tight">Royalty-Free Music</h2>
          <span className="hidden text-xs text-[#6b6b70] sm:inline">· {genres.length} genres · {totalSamples} samples</span>
        </div>
        <button type="button" onClick={onClose} className="rounded-md border border-white/[0.08] px-2.5 py-1 text-xs text-[#a1a1a6] transition hover:border-white/20 hover:text-[#f5f5f7]">Close</button>
      </header>

      {/* Genre navigation — dynamic, horizontal scroll */}
      <nav className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-white/[0.06] px-4 py-2 [scrollbar-width:thin]">
        <GenreNavPill label="All" active={view === "all"} onClick={() => setView("all")} />
        {genres.map((g) => (
          <GenreNavPill key={g.id} label={g.name} active={view === g.id} onClick={() => setView(g.id)} />
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {selectedGenre ? (
          <GenreDetail
            genre={selectedGenre}
            previewPaths={previewPaths}
            nowPlaying={nowPlaying}
            onPlaySamples={() => playGenreSamples(selectedGenre)}
            onPlayTrack={(t) => playTrack(selectedGenre, t)}
            onBack={() => setView("all")}
            notPlayableHint={notPlayableHint}
          />
        ) : (
          <CatalogHome genres={genres} totalSamples={totalSamples} onOpen={(id) => setView(id)} notPlayableHint={notPlayableHint} />
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
        active ? "bg-[#0a84ff] text-white" : "border border-white/[0.08] text-[#a1a1a6] hover:border-white/20 hover:text-[#f5f5f7]"
      }`}
    >
      {label}
    </button>
  );
}

function CatalogHome({
  genres,
  totalSamples,
  onOpen,
  notPlayableHint,
}: {
  genres: MusicBankGenrePack[];
  totalSamples: number;
  onOpen: (id: string) => void;
  notPlayableHint: string | null;
}) {
  return (
    <>
      <div className="grid grid-cols-1 gap-3 px-4 py-4 sm:grid-cols-2 lg:grid-cols-3">
        {genres.map((genre) => {
          const total = totalDuration(genre.tracks);
          return (
            <div key={genre.id} className="group flex flex-col overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.015] transition hover:border-white/20">
              <button type="button" onClick={() => onOpen(genre.id)} className="relative flex aspect-[16/10] items-end p-3.5 text-left" style={{ backgroundImage: `linear-gradient(140deg, ${genre.gradient[0]} 0%, ${genre.gradient[1]} 100%)` }}>
                <div className="absolute inset-0 bg-black/15 transition group-hover:bg-black/5" />
                <div className="relative">
                  <h3 className="text-lg font-semibold leading-tight tracking-tight text-white drop-shadow">{genre.name}</h3>
                  <p className="mt-0.5 text-[11px] font-medium text-white/80">
                    {genre.tracks.length} samples{total != null ? ` · ${formatDuration(total)}` : ""}
                  </p>
                </div>
                <span className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/30 text-white opacity-0 backdrop-blur-sm transition group-hover:opacity-100"><PlayIcon className="h-3.5 w-3.5" /></span>
              </button>
              <div className="flex items-center justify-between gap-2 px-3.5 py-2.5">
                <button type="button" onClick={() => onOpen(genre.id)} className="text-xs font-medium text-[#0a84ff] transition hover:text-[#7db8ff]">Listen to samples →</button>
                <span className="flex items-center gap-2">
                  <span className="text-sm font-semibold tabular-nums text-[#f5f5f7]">{GENRE_PRICE_LABEL}</span>
                  <button type="button" disabled title="Coming soon" className="cursor-not-allowed rounded-md border border-white/[0.1] px-2.5 py-1 text-[11px] font-semibold text-[#6b6b70]">Unlock</button>
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Complete Music Bank — the headline deal */}
      <section className="mx-4 mb-5 overflow-hidden rounded-xl border border-[#0a84ff]/30 bg-gradient-to-br from-[#0a84ff]/[0.10] to-[#7a2f8c]/[0.10] px-5 py-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[#7db8ff]">Best value</p>
            <h3 className="mt-1 text-lg font-semibold tracking-tight text-[#f5f5f7]">Complete Music Bank</h3>
            <p className="mt-1 text-sm text-[#a1a1a6]">All {genres.length} genre packs · {totalSamples} samples · one bundle.</p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="text-2xl font-bold tabular-nums text-[#f5f5f7]">{FULL_BANK_PRICE_LABEL}</span>
            <button type="button" disabled title="Coming soon" className="cursor-not-allowed rounded-lg border border-[#0a84ff]/40 bg-[#0a84ff]/20 px-4 py-2 text-sm font-semibold text-[#7db8ff]">Unlock Full Music Bank</button>
          </div>
        </div>
        <p className="mt-3 border-t border-white/[0.06] pt-3 text-[11px] text-[#8a8a8f]">
          {genres.length} packs at {GENRE_PRICE_LABEL} each — the full bank is {FULL_BANK_PRICE_LABEL}. Payments &amp; entitlements coming soon; samples preview from the local cache and are not marked Offline Ready.
        </p>
      </section>

      {notPlayableHint ? <p className="px-5 pb-5 text-[11px] text-[#6b6b70]">{notPlayableHint}</p> : null}
    </>
  );
}

function GenreDetail({
  genre,
  previewPaths,
  nowPlaying,
  onPlaySamples,
  onPlayTrack,
  onBack,
  notPlayableHint,
}: {
  genre: MusicBankGenrePack;
  previewPaths: PreviewPathMap;
  nowPlaying: { genreId: string; trackId: string | null } | null;
  onPlaySamples: () => void;
  onPlayTrack: (t: MusicBankSampleTrack) => void;
  onBack: () => void;
  notPlayableHint: string | null;
}) {
  const total = totalDuration(genre.tracks);
  const genrePlayable = genre.tracks.some((t) => previewPaths.has(t.id));
  return (
    <>
      {/* Genre header */}
      <section className="relative overflow-hidden px-5 py-5" style={{ backgroundImage: `linear-gradient(140deg, ${genre.gradient[0]} 0%, ${genre.gradient[1]} 100%)` }}>
        <div className="absolute inset-0 bg-black/25" />
        <div className="relative">
          <button type="button" onClick={onBack} className="mb-3 inline-flex items-center gap-1 rounded-md border border-white/25 px-2.5 py-1 text-xs text-white/90 transition hover:bg-white/10">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
            All genres
          </button>
          <h1 className="text-2xl font-semibold leading-tight tracking-tight text-white drop-shadow">{genre.name}</h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-white/85">{genre.description}</p>
          <p className="mt-1.5 text-[11px] font-medium text-white/75">{genre.tracks.length} samples{total != null ? ` · ${formatDuration(total)}` : ""}</p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {/* Single CTA — plays the genre's FULL sample set through the existing playlist queue. */}
            <button type="button" disabled={!genrePlayable} onClick={onPlaySamples} className="inline-flex items-center gap-1.5 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-[#101014] transition hover:bg-white/90 disabled:cursor-not-allowed disabled:bg-white/30 disabled:text-white/60">
              <PlayIcon className="h-3.5 w-3.5" />
              Listen to Samples
            </button>
            <span className="ms-auto flex items-center gap-2">
              <span className="text-lg font-bold tabular-nums text-white">{GENRE_PRICE_LABEL}</span>
              <button type="button" disabled title="Coming soon" className="cursor-not-allowed rounded-lg border border-white/30 px-3 py-1.5 text-xs font-semibold text-white/70">Unlock Genre</button>
            </span>
          </div>
        </div>
      </section>

      {notPlayableHint ? <p className="px-5 pt-3 text-[11px] text-[#6b6b70]">{notPlayableHint}</p> : null}

      {/* Dense track list */}
      <ul className="px-2 py-2">
        {genre.tracks.map((track, i) => {
          const trackPlayable = previewPaths.has(track.id);
          const active = nowPlaying?.genreId === genre.id && nowPlaying?.trackId === track.id;
          return (
            <li key={track.id} className={`group flex items-center gap-3 rounded-md px-2.5 py-1.5 transition ${active ? "bg-[#0a84ff]/12" : "hover:bg-white/[0.03]"}`}>
              <span className={`w-5 shrink-0 text-right text-[11px] tabular-nums ${active ? "text-[#7db8ff]" : "text-[#5a5a5f]"}`}>{i + 1}</span>
              <button
                type="button"
                disabled={!trackPlayable}
                onClick={() => onPlayTrack(track)}
                className="relative inline-flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded text-white transition disabled:cursor-not-allowed"
                style={{ backgroundImage: `linear-gradient(140deg, ${genre.gradient[0]} 0%, ${genre.gradient[1]} 100%)` }}
                aria-label={`Play ${track.title}`}
              >
                <span className={`absolute inset-0 transition ${trackPlayable ? "bg-black/30 group-hover:bg-black/10" : "bg-black/55"}`} />
                <PlayIcon className={`relative h-3.5 w-3.5 ${trackPlayable ? "" : "opacity-40"}`} />
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
