"use client";

/**
 * Royalty-Free Music — center-monitor Sales Catalog (POC).
 *
 * Two levels inside the same center slot:
 *   Landing  → a responsive grid of Genre Pack cards (dynamic count).
 *   Detail   → one genre's artwork + full sample list + Play.
 *
 * Genres are DYNAMIC: whatever the catalog descriptor holds (generated from the real Drive subfolders).
 * No hardcoded genre list here. Samples play through the EXISTING chain:
 *   ephemeral local playlist → RAW playSource → AudioPlayer → PlaybackOrchestrator → MPV.
 *
 * Separation of concerns (do not collapse):
 *   - Catalog metadata  → what is shown (this file's import).
 *   - Preview cache     → lets samples be HEARD (absolute paths from the desktop bridge). NOT offline.
 *   - Offline manifest  → whether a FULL playlist is Keep-Offline / OFFLINE READY (unrelated here).
 *
 * Local sample paths are desktop-only and travel via RAW playSource (never routed over WS), matching
 * the proven Stage 2b offline flow and the WS local-path guardrail.
 *
 * Commerce (price / Unlock Genre / Unlock Full Bank) and Keep Offline are PLACEHOLDERS only.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePlayback } from "@/lib/playback-provider";
import { EPHEMERAL_LOCAL_PLAYLIST_PREFIX } from "@/lib/local-playlist-artwork";
import { formatDuration } from "@/lib/format-utils";
import type { Playlist, PlaylistTrack } from "@/lib/playlist-types";
import type { UnifiedSource } from "@/lib/source-types";
import { POC_MUSIC_BANK_CATALOG } from "@/lib/music-bank/poc-catalog";
import type { MusicBankGenrePack, MusicBankSampleTrack } from "@/lib/music-bank/catalog-types";

const DEMO_TARGET_SECONDS = 15 * 60;
const DEMO_FALLBACK_TRACK_COUNT = 4;

type PreviewPathMap = Map<string, string>;

function totalDuration(tracks: MusicBankSampleTrack[]): number | null {
  const known = tracks.filter((t) => typeof t.durationSeconds === "number");
  if (known.length === 0) return null;
  return known.reduce((sum, t) => sum + (t.durationSeconds ?? 0), 0);
}

function pickDemoTracks(tracks: MusicBankSampleTrack[]): MusicBankSampleTrack[] {
  const haveDurations = tracks.some((t) => typeof t.durationSeconds === "number");
  if (!haveDurations) return tracks.slice(0, DEMO_FALLBACK_TRACK_COUNT);
  const out: MusicBankSampleTrack[] = [];
  let acc = 0;
  for (const t of tracks) {
    out.push(t);
    acc += t.durationSeconds ?? 0;
    if (acc >= DEMO_TARGET_SECONDS) break;
  }
  return out;
}

function PlayIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
  );
}

export function RoyaltyFreeMusicWorkspacePanel({ onClose }: { onClose: () => void }) {
  const { playSource } = usePlayback(); // RAW playSource — desktop-local, never routed over WS.
  const [previewPaths, setPreviewPaths] = useState<PreviewPathMap>(() => new Map());
  const [bridgeChecked, setBridgeChecked] = useState(false);
  const [selectedGenreId, setSelectedGenreId] = useState<string | null>(null);
  const [nowPlaying, setNowPlaying] = useState<{ genreId: string; trackId: string | null } | null>(null);

  const catalog = POC_MUSIC_BANK_CATALOG;
  const genres = catalog.genres;
  const selectedGenre = useMemo(
    () => genres.find((g) => g.id === selectedGenreId) ?? null,
    [genres, selectedGenreId],
  );

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
    (genre: MusicBankGenrePack, tracks: MusicBankSampleTrack[], suffix: string): { source: UnifiedSource; playable: MusicBankSampleTrack[] } | null => {
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
        id: `${EPHEMERAL_LOCAL_PLAYLIST_PREFIX}musicbank-${genre.id}-${suffix}`,
        name: `${genre.name} — ${suffix === "demo" ? "15-Min Demo" : "Samples"}`,
        genre: genre.name,
        type: "local",
        url: first,
        thumbnail: "",
        createdAt: new Date().toISOString(),
        tracks: plTracks,
        order: plTracks.map((t) => t.id),
      };
      const source: UnifiedSource = {
        id: playlist.id,
        title: playlist.name,
        genre: genre.name,
        cover: null,
        type: "local",
        url: first,
        origin: "playlist",
        playlist,
      };
      return { source, playable };
    },
    [previewPaths],
  );

  const playGenreSamples = useCallback(
    (genre: MusicBankGenrePack) => {
      const built = buildSource(genre, genre.tracks, "samples");
      if (!built) return;
      playSource(built.source, 0);
      setNowPlaying({ genreId: genre.id, trackId: built.playable[0]?.id ?? null });
    },
    [buildSource, playSource],
  );

  const playGenreDemo = useCallback(
    (genre: MusicBankGenrePack) => {
      const built = buildSource(genre, pickDemoTracks(genre.tracks), "demo");
      if (!built) return;
      playSource(built.source, 0);
      setNowPlaying({ genreId: genre.id, trackId: built.playable[0]?.id ?? null });
    },
    [buildSource, playSource],
  );

  const playTrack = useCallback(
    (genre: MusicBankGenrePack, track: MusicBankSampleTrack) => {
      const built = buildSource(genre, genre.tracks, "samples");
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

  return (
    <div className="sb-anim-rise flex max-h-[min(85vh,760px)] w-full min-h-0 flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#101014] text-[#f5f5f7]">
      {/* Header */}
      <header className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-3.5">
        <div className="flex min-w-0 items-center gap-2.5">
          {selectedGenre ? (
            <button
              type="button"
              onClick={() => setSelectedGenreId(null)}
              className="inline-flex items-center gap-1 rounded-md border border-white/[0.1] px-2.5 py-1 text-xs text-[#c7c7cc] transition hover:border-white/25 hover:text-[#f5f5f7]"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
              Back
            </button>
          ) : (
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-[#0a84ff]/15 text-[#7db8ff]">
              <PlayIcon className="h-3 w-3" />
            </span>
          )}
          <h2 className="truncate text-sm font-semibold tracking-tight">
            {selectedGenre ? selectedGenre.name : "Royalty-Free Music"}
          </h2>
          {!selectedGenre ? (
            <span className="hidden rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-[#8a8a8f] sm:inline">
              {genres.length} {genres.length === 1 ? "genre" : "genres"}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-white/[0.08] px-2.5 py-1 text-xs text-[#a1a1a6] transition hover:border-white/20 hover:text-[#f5f5f7]"
        >
          Close
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {selectedGenre ? (
          <GenreDetail
            genre={selectedGenre}
            previewPaths={previewPaths}
            nowPlaying={nowPlaying}
            onPlaySamples={() => playGenreSamples(selectedGenre)}
            onPlayDemo={() => playGenreDemo(selectedGenre)}
            onPlayTrack={(t) => playTrack(selectedGenre, t)}
            notPlayableHint={notPlayableHint}
          />
        ) : (
          <Landing
            genres={genres}
            previewPaths={previewPaths}
            onOpen={(id) => setSelectedGenreId(id)}
            notPlayableHint={notPlayableHint}
          />
        )}
      </div>
    </div>
  );
}

function Landing({
  genres,
  previewPaths,
  onOpen,
  notPlayableHint,
}: {
  genres: MusicBankGenrePack[];
  previewPaths: PreviewPathMap;
  onOpen: (id: string) => void;
  notPlayableHint: string | null;
}) {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-white/[0.06] px-6 py-7">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{ backgroundImage: "radial-gradient(120% 100% at 0% 0%, #17324a 0%, transparent 55%), radial-gradient(120% 120% at 100% 0%, #3a2140 0%, transparent 55%)" }}
        />
        <div className="relative max-w-2xl">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#0a84ff]">Music for business</p>
          <h1 className="mt-2 text-2xl font-semibold leading-tight tracking-tight text-[#f5f5f7]">
            Professionally curated music, ready for your space
          </h1>
          <p className="mt-2.5 text-sm leading-relaxed text-[#a1a1a6]">
            Browse the collection by style. Open a pack to preview its samples, then keep the full
            genre playing across your locations.
          </p>
        </div>
      </section>

      {/* Genre grid — dynamic count, responsive */}
      <div className="grid grid-cols-1 gap-4 px-5 py-5 sm:grid-cols-2 lg:grid-cols-3">
        {genres.map((genre) => {
          const total = totalDuration(genre.tracks);
          return (
            <button
              key={genre.id}
              type="button"
              onClick={() => onOpen(genre.id)}
              className="group flex flex-col overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.015] text-left transition hover:border-white/20 hover:bg-white/[0.04]"
            >
              <div
                className="relative flex aspect-[16/9] items-end p-4"
                style={{ backgroundImage: `linear-gradient(140deg, ${genre.gradient[0]} 0%, ${genre.gradient[1]} 100%)` }}
              >
                <div className="absolute inset-0 bg-black/10 transition group-hover:bg-black/0" />
                <div className="relative">
                  <h3 className="text-lg font-semibold leading-tight tracking-tight text-white drop-shadow">{genre.name}</h3>
                  <p className="mt-0.5 text-[11px] font-medium text-white/80">
                    {genre.tracks.length} {genre.tracks.length === 1 ? "sample" : "samples"}
                    {total != null ? ` · ${formatDuration(total)}` : ""}
                  </p>
                </div>
                <span className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/25 text-white opacity-0 backdrop-blur-sm transition group-hover:opacity-100">
                  <PlayIcon className="h-3.5 w-3.5" />
                </span>
              </div>
              <div className="flex flex-1 flex-col gap-2 p-4">
                <p className="line-clamp-2 text-sm leading-relaxed text-[#c7c7cc]">{genre.description}</p>
                <div className="mt-auto flex items-center justify-between pt-1">
                  <span className="text-xs font-medium text-[#0a84ff] transition group-hover:text-[#7db8ff]">Listen to demo →</span>
                  <span className="text-xs font-medium text-[#8a8a8f]">{genre.priceLabel ?? "Price — TBD"}</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <FullBankBand />
      {notPlayableHint ? <p className="px-6 pb-6 text-[11px] text-[#6b6b70]">{notPlayableHint}</p> : null}
    </>
  );
}

function GenreDetail({
  genre,
  previewPaths,
  nowPlaying,
  onPlaySamples,
  onPlayDemo,
  onPlayTrack,
  notPlayableHint,
}: {
  genre: MusicBankGenrePack;
  previewPaths: PreviewPathMap;
  nowPlaying: { genreId: string; trackId: string | null } | null;
  onPlaySamples: () => void;
  onPlayDemo: () => void;
  onPlayTrack: (t: MusicBankSampleTrack) => void;
  notPlayableHint: string | null;
}) {
  const total = totalDuration(genre.tracks);
  const genrePlayable = genre.tracks.some((t) => previewPaths.has(t.id));
  return (
    <>
      {/* Genre header */}
      <section
        className="relative overflow-hidden px-6 py-7"
        style={{ backgroundImage: `linear-gradient(140deg, ${genre.gradient[0]} 0%, ${genre.gradient[1]} 100%)` }}
      >
        <div className="absolute inset-0 bg-black/20" />
        <div className="relative max-w-2xl">
          <h1 className="text-2xl font-semibold leading-tight tracking-tight text-white drop-shadow">{genre.name}</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-white/85">{genre.description}</p>
          <p className="mt-2 text-[11px] font-medium text-white/75">
            {genre.tracks.length} {genre.tracks.length === 1 ? "sample" : "samples"}
            {total != null ? ` · ${formatDuration(total)}` : ""}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!genrePlayable}
              onClick={onPlaySamples}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3.5 py-1.5 text-xs font-semibold text-[#101014] transition hover:bg-white/90 disabled:cursor-not-allowed disabled:bg-white/30 disabled:text-white/60"
            >
              <PlayIcon className="h-3 w-3" />
              Play Samples
            </button>
            <button
              type="button"
              disabled={!genrePlayable}
              onClick={onPlayDemo}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/40 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:border-white/20 disabled:text-white/50"
            >
              Play 15-Min Demo
            </button>
            <span className="ms-auto flex items-center gap-2">
              <span className="text-xs font-medium text-white/80">{genre.priceLabel ?? "Price — TBD"}</span>
              <button type="button" disabled title="Coming soon" className="cursor-not-allowed rounded-lg border border-white/25 px-3 py-1.5 text-xs font-semibold text-white/60">
                Unlock Genre
              </button>
            </span>
          </div>
        </div>
      </section>

      {notPlayableHint ? <p className="px-6 pt-3 text-[11px] text-[#6b6b70]">{notPlayableHint}</p> : null}

      {/* Track list — every sample */}
      <ul className="px-2 py-3">
        {genre.tracks.map((track, i) => {
          const trackPlayable = previewPaths.has(track.id);
          const active = nowPlaying?.genreId === genre.id && nowPlaying?.trackId === track.id;
          return (
            <li
              key={track.id}
              className={`group flex items-center gap-3 rounded-lg px-3 py-2 transition ${active ? "bg-[#0a84ff]/10" : "hover:bg-white/[0.03]"}`}
            >
              <span className={`w-6 shrink-0 text-right text-xs tabular-nums ${active ? "text-[#7db8ff]" : "text-[#6b6b70]"}`}>{i + 1}</span>
              <button
                type="button"
                disabled={!trackPlayable}
                onClick={() => onPlayTrack(track)}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/[0.12] text-[#e5e5ea] transition hover:border-[#0a84ff] hover:text-[#7db8ff] disabled:cursor-not-allowed disabled:border-white/[0.05] disabled:text-[#5a5a5f]"
                aria-label={`Play ${track.title}`}
              >
                <PlayIcon className="h-3 w-3" />
              </button>
              <span className={`min-w-0 flex-1 truncate text-sm ${active ? "text-[#f5f5f7]" : "text-[#d1d1d6]"}`}>{track.title}</span>
              <span className="shrink-0 text-xs tabular-nums text-[#8a8a8f]">
                {typeof track.durationSeconds === "number" ? formatDuration(track.durationSeconds) : "—"}
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function FullBankBand() {
  return (
    <section className="mx-5 mb-6 overflow-hidden rounded-xl border border-[#0a84ff]/25 bg-[#0a84ff]/[0.06] px-5 py-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-semibold tracking-tight text-[#f5f5f7]">Complete Music Bank</h3>
          <p className="mt-1 text-sm text-[#a1a1a6]">All genres, one collection — with a special full-bank price.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-[#8a8a8f]">Special price — TBD</span>
          <button type="button" disabled title="Coming soon" className="cursor-not-allowed rounded-lg border border-[#0a84ff]/40 bg-[#0a84ff]/15 px-4 py-2 text-sm font-semibold text-[#7db8ff]">
            Unlock Full Bank
          </button>
        </div>
      </div>
      <p className="mt-3 border-t border-white/[0.06] pt-3 text-[11px] text-[#8a8a8f]">
        Keep Offline will apply to full playlists after unlock — samples here stream from the preview
        cache and are not marked Offline Ready. Payments &amp; entitlements are coming soon.
      </p>
    </section>
  );
}
