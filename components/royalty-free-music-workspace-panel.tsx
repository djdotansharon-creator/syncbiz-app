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
/** stage D (owner 2026-11-11): a private bank's Offline switch — on/off, disk the bank needs, may this person change it. */
type OfflineInfo = { enabled: boolean; bytes: number; canToggle: boolean };
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
  // the dev Stream / Local A/B toggle left the screen (owner 2026-11-11) — "stream" is the mode; Local stays in code only
  const [playbackMode] = useState<PlaybackMode>("stream");
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
  // owner 2026-11-10: PRIVATE banks (e.g. All Day Mix) come from the server, only the ones this business was opened to.
  const [privatePacks, setPrivatePacks] = useState<MusicBankGenrePack[]>([]);
  // 2026-11-11 (owner, stage D): the per-bank OFFLINE switch — on: the business's stations keep the songs encrypted on disk.
  const [privateOffline, setPrivateOffline] = useState<Record<string, OfflineInfo>>({});
  const [offlineBusy, setOfflineBusy] = useState<string | null>(null);
  const [offlineError, setOfflineError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/music-bank/private-banks", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { banks?: MusicBankGenrePack[]; offline?: Record<string, OfflineInfo> } | null) => {
        if (!cancelled && Array.isArray(j?.banks)) setPrivatePacks(j.banks);
        if (!cancelled && j?.offline && typeof j.offline === "object") setPrivateOffline(j.offline);
      })
      .catch(() => {
        /* offline / signed out — the public catalog still shows */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const setOffline = useCallback(async (bankId: string, offline: boolean) => {
    setOfflineBusy(bankId);
    setOfflineError(null);
    try {
      const r = await fetch("/api/music-bank/offline", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bankId, offline }),
      });
      const j = (await r.json().catch(() => ({}))) as { offline?: boolean; error?: string };
      if (!r.ok) {
        setOfflineError(j.error ?? "The change was not saved.");
        return;
      }
      setPrivateOffline((m) => ({ ...m, [bankId]: { ...(m[bankId] ?? { bytes: 0, canToggle: true }), enabled: j.offline === true } }));
    } catch {
      setOfflineError("The change was not saved.");
    } finally {
      setOfflineBusy(null);
    }
  }, []);
  const allPacks = useMemo(() => [...privatePacks, ...genres], [privatePacks, genres]);
  const selectedGenre = useMemo(() => (view === "all" ? null : allPacks.find((g) => g.id === view) ?? null), [allPacks, view]);
  const selectedIsPrivate = selectedGenre != null && privatePacks.some((p) => p.id === selectedGenre.id);

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

  /* 2026-11-10 (owner): drawn straight on the library page in Ori's language — no panel box, quiet actions, section titles,
     picture tiles; colours from app/center-panels.css (`sb-cp`) so the dark / transparent / white looks all apply. */
  return (
    <div className="sb-cp sb-anim-rise flex max-h-[min(85vh,760px)] w-full min-h-0 flex-col gap-4 px-1 pb-1">
      {/* Header — like a playlist page: title + quiet meta, quiet actions on the end side */}
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 pt-1">
        <div className="min-w-0">
          <h2 className="sb-cp-title">Royalty-Free Music</h2>
          <p className="sb-cp-meta mt-1">{genres.length} Genre Packs · {totalSamples} samples</p>
        </div>
        <div className="flex items-center gap-1">
          {/* 2026-11-11 (owner): the dev "Stream / Local" A/B toggle is gone from the screen — music streams, and a bank kept on
              this computer is switched per bank with OFFLINE on its own page. (The Local preview-cache mode stays in code, unused.) */}
          <button type="button" onClick={onClose} aria-label="Close" className="sb-cp-icon-btn ms-1">
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Genre navigation — the library's chips row: plain words */}
      <nav className="flex shrink-0 items-center gap-5 overflow-x-auto [scrollbar-width:none]">
        <GenreNavPill label="All" active={view === "all"} onClick={() => setView("all")} />
        {privatePacks.map((g) => (
          <GenreNavPill key={g.id} label={g.name} active={view === g.id} onClick={() => setView(g.id)} />
        ))}
        {genres.map((g) => (
          <GenreNavPill key={g.id} label={g.name} active={view === g.id} onClick={() => setView(g.id)} />
        ))}
      </nav>

      {/* key = the view: a pack (or All) always opens at its top, not where the previous view was scrolled to */}
      <div key={view} className="min-h-0 flex-1 overflow-y-auto pe-1">
        {selectedGenre ? (
          <GenreDetail
            genre={selectedGenre}
            isPrivate={selectedIsPrivate}
            offline={selectedIsPrivate ? privateOffline[selectedGenre.id] ?? null : null}
            offlineBusy={offlineBusy === selectedGenre.id}
            offlineError={selectedIsPrivate ? offlineError : null}
            onToggleOffline={(next) => void setOffline(selectedGenre.id, next)}
            trackPlayable={trackPlayable}
            nowPlaying={nowPlaying}
            onPlaySamples={() => playGenreSamples(selectedGenre)}
            onPlayTrack={(t) => playTrack(selectedGenre, t)}
            onBack={() => setView("all")}
            notPlayableHint={notPlayableHint}
          />
        ) : (
          <CatalogHome genres={genres} privatePacks={privatePacks} totalSamples={totalSamples} onOpen={(id) => setView(id)} notPlayableHint={notPlayableHint} />
        )}
      </div>
    </div>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function GenreNavPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={`sb-cp-tab${active ? " is-on" : ""}`}>
      {label}
    </button>
  );
}

/** Cinematic per-pack hero art (thematic motif + colour grade + lighting). See genre-pack-art.tsx. */
function GenreCover({ genre }: { genre: MusicBankGenrePack }) {
  return <GenrePackArt id={genre.id} />;
}

function CatalogHome({
  genres,
  privatePacks,
  totalSamples,
  onOpen,
  notPlayableHint,
}: {
  genres: MusicBankGenrePack[];
  privatePacks: MusicBankGenrePack[];
  totalSamples: number;
  onOpen: (id: string) => void;
  notPlayableHint: string | null;
}) {
  return (
    <div className="space-y-7 pb-3">
      {/* owner 2026-11-10: PRIVATE banks — only the ones this business was opened to (none → the section is absent) */}
      {privatePacks.length > 0 ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="sb-cp-section">Private</h3>
            <span className="sb-cp-meta tabular-nums">{privatePacks.length}</span>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-x-3 gap-y-4">
            {privatePacks.map((pack) => {
              const total = totalDuration(pack.tracks);
              return (
                <div key={pack.id} className="group flex flex-col gap-2">
                  <button type="button" onClick={() => onOpen(pack.id)} className="sb-cp-tile sb-cp-hit block aspect-[16/9] w-full text-start" aria-label={`Open ${pack.name}`}>
                    <GenreCover genre={pack} />
                    <span className="sb-cp-badge">Private</span>
                    <span className="absolute end-2.5 top-2 z-[1] inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/40 opacity-0 transition group-hover:opacity-100" style={{ color: "#ffffff" }}>
                      <PlayIcon className="h-3.5 w-3.5" />
                    </span>
                    <span className="sb-cp-tile-fog block">
                      <span className="sb-cp-on-art sb-cp-clip block text-[17px] font-bold leading-tight">{pack.name}</span>
                      <span className="sb-cp-on-art-2 mt-0.5 block text-[11px] font-medium">
                        {pack.tracks.length} songs{total != null ? ` · ${formatDuration(total)}` : ""}
                      </span>
                    </span>
                  </button>
                  <div className="flex items-center justify-between gap-2 px-1">
                    <button type="button" onClick={() => onOpen(pack.id)} className="sb-cp-accent whitespace-nowrap text-xs font-semibold hover:underline">
                      Open the mix
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* Genre Packs — picture tiles like the library cards; price + Unlock under the picture, no box around them */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="sb-cp-section">Genre Packs</h3>
          <span className="sb-cp-meta tabular-nums">{genres.length}</span>
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-x-3 gap-y-4">
          {genres.map((genre) => {
            const total = totalDuration(genre.tracks);
            return (
              <div key={genre.id} className="group flex flex-col gap-2">
                <button type="button" onClick={() => onOpen(genre.id)} className="sb-cp-tile sb-cp-hit block aspect-[16/9] w-full text-start" aria-label={`Open ${genre.name}`}>
                  <GenreCover genre={genre} />
                  <span className="sb-cp-badge">Genre Pack</span>
                  <span className="absolute end-2.5 top-2 z-[1] inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/40 opacity-0 transition group-hover:opacity-100" style={{ color: "#ffffff" }}>
                    <PlayIcon className="h-3.5 w-3.5" />
                  </span>
                  <span className="sb-cp-tile-fog block">
                    <span className="sb-cp-on-art sb-cp-clip block text-[17px] font-bold leading-tight">{genre.name}</span>
                    <span className="sb-cp-on-art-2 mt-0.5 block text-[11px] font-medium">
                      {genre.tracks.length} samples{total != null ? ` · ${formatDuration(total)}` : ""}
                    </span>
                  </span>
                </button>
                <div className="flex items-center justify-between gap-2 px-1">
                  <button type="button" onClick={() => onOpen(genre.id)} className="sb-cp-accent whitespace-nowrap text-xs font-semibold hover:underline">
                    Listen to samples
                  </button>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="sb-cp-ink text-sm font-semibold tabular-nums">{GENRE_PRICE_LABEL}</span>
                    <button type="button" disabled title="Coming soon" className="sb-cp-act !px-2 !py-0.5 !text-[11px]">Unlock</button>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Subscription bundles — one soft surface each, no borders, no glow */}
      <section className="space-y-3">
        <h3 className="sb-cp-section">Bundles</h3>
        <div className="grid gap-3 sm:grid-cols-5">
          {/* CHOICE 1 — Choose 3 Genre Packs */}
          <div className="sb-cp-soft flex flex-col justify-between p-5 sm:col-span-2">
            <div>
              <p className="sb-cp-meta text-[11px] font-semibold uppercase tracking-[0.14em]">Build your bundle</p>
              <p className="sb-cp-ink mt-1 text-lg font-bold">Choose {CHOICE3_PACK_COUNT} Genre Packs</p>
              <p className="sb-cp-2 mt-1 text-sm">Any {CHOICE3_PACK_COUNT} packs — your pick.</p>
            </div>
            <div className="mt-5 flex items-center justify-between gap-3">
              <span className="sb-cp-ink text-xl font-bold tabular-nums">{CHOICE3_PRICE_LABEL}</span>
              <button type="button" disabled title="Coming soon" className="sb-cp-act">Unlock</button>
            </div>
          </div>

          {/* CHOICE 2 — Full Music Bank, best value: the same soft surface, a quiet blue word instead of a glowing frame */}
          <div className="sb-cp-soft flex flex-col justify-between p-5 sm:col-span-3">
            <div className="min-w-0">
              <p className="sb-cp-accent text-[11px] font-semibold uppercase tracking-[0.14em]">Best value · everything, one subscription</p>
              <p className="sb-cp-ink mt-1 text-xl font-bold">Full Music Bank</p>
              <p className="sb-cp-2 mt-1 text-sm">All {genres.length} Genre Packs · {totalSamples} samples.</p>
            </div>
            <div className="mt-5 flex items-center justify-between gap-3">
              <span className="sb-cp-ink text-3xl font-bold tabular-nums">{FULL_BANK_PRICE_LABEL}</span>
              <button type="button" disabled title="Coming soon" className="sb-cp-primary">Unlock Full Music Bank</button>
            </div>
          </div>
        </div>
        <p className="sb-cp-faint px-1 text-[11px]">
          Proposed monthly pricing for the demo. Payments &amp; entitlements coming soon; samples preview now and are not marked Offline Ready.
        </p>
      </section>

      {notPlayableHint ? <p className="sb-cp-faint px-1 text-[11px]">{notPlayableHint}</p> : null}
    </div>
  );
}

function GenreDetail({
  genre,
  isPrivate = false,
  offline = null,
  offlineBusy = false,
  offlineError = null,
  onToggleOffline,
  trackPlayable,
  nowPlaying,
  onPlaySamples,
  onPlayTrack,
  onBack,
  notPlayableHint,
}: {
  genre: MusicBankGenrePack;
  /** a PRIVATE bank (owner 2026-11-10): full songs, no price / unlock */
  isPrivate?: boolean;
  /** stage D: the bank's Offline switch (private banks only) */
  offline?: OfflineInfo | null;
  offlineBusy?: boolean;
  offlineError?: string | null;
  onToggleOffline?: (next: boolean) => void;
  trackPlayable: (id: string) => boolean;
  nowPlaying: { genreId: string; trackId: string | null } | null;
  onPlaySamples: () => void;
  onPlayTrack: (t: MusicBankSampleTrack) => void;
  onBack: () => void;
  notPlayableHint: string | null;
}) {
  const total = totalDuration(genre.tracks);
  const genrePlayable = genre.tracks.some((t) => trackPlayable(t.id));
  return (
    <div className="space-y-6 pb-3">
      {/* Pack header — like a playlist page: cover + title + meta + actions, no box */}
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="sb-cp-tile aspect-[16/9] w-full shrink-0 sm:w-64">
          <GenreCover genre={genre} />
        </div>
        <div className="min-w-0 flex-1">
          <button type="button" onClick={onBack} className="sb-cp-act -ms-2 mb-1">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 rtl:rotate-180" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            All genres
          </button>
          <p className="sb-cp-meta text-[11px] font-semibold uppercase tracking-[0.14em]">{isPrivate ? "Private bank" : "Genre Pack"}</p>
          <h3 className="sb-cp-title mt-0.5">{genre.name}</h3>
          <p className="sb-cp-2 mt-1 max-w-2xl text-sm leading-relaxed">{genre.description}</p>
          <p className="sb-cp-faint mt-1 text-[11px] font-medium">
            {genre.tracks.length} {isPrivate ? "songs" : "samples"}{total != null ? ` · ${formatDuration(total)}` : ""}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {/* Single CTA — plays the pack's FULL sample set through the existing playlist queue. */}
            <button type="button" disabled={!genrePlayable} onClick={onPlaySamples} className="sb-cp-primary">
              <PlayIcon className="h-3.5 w-3.5" />
              {isPrivate ? "Play the mix" : "Listen to Samples"}
            </button>
            {/* stage D (owner 2026-11-11): OFFLINE — keep this bank on the business's computers, encrypted. Owner: a switch with
                the word "Offline" that fills with VONO blue when pressed (like Spotify's download fill); no long text on screen
                (and no hover tip — components/no-native-tooltips.tsx strips every `title`, owner 2026-10-26). A person who may not
                change it (not the business owner / an admin) sees it dimmed. */}
            {isPrivate && offline ? (
              <button
                type="button"
                role="switch"
                aria-checked={offline.enabled}
                disabled={!offline.canToggle || offlineBusy}
                onClick={() => onToggleOffline?.(!offline.enabled)}
                className={`sb-cp-offline${offline.enabled ? " is-on" : ""}`}
              >
                Offline
                <span className="sb-cp-switch" aria-hidden="true"><span className="sb-cp-switch-knob" /></span>
              </button>
            ) : null}
            {isPrivate ? null : (
              <span className="ms-auto flex items-center gap-2">
                <span className="sb-cp-ink text-lg font-bold tabular-nums">{GENRE_PRICE_LABEL}</span>
                <button type="button" disabled title="Coming soon" className="sb-cp-act">Unlock Genre Pack</button>
              </span>
            )}
          </div>
        </div>
      </section>

      {notPlayableHint ? <p className="sb-cp-faint text-[11px]">{notPlayableHint}</p> : null}
      {offlineError ? <p className="sb-cp-faint text-[11px]" role="alert">{offlineError}</p> : null}

      {/* Samples — a plain list: no box, a soft fill under the row you point at or the one playing */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="sb-cp-section">{isPrivate ? "Songs" : "Samples"}</h3>
          <span className="sb-cp-meta tabular-nums">{genre.tracks.length}</span>
        </div>
        <ul>
          {genre.tracks.map((track, i) => {
            const isPlayable = trackPlayable(track.id);
            const active = nowPlaying?.genreId === genre.id && nowPlaying?.trackId === track.id;
            return (
              <li key={track.id} className={`sb-cp-row group flex items-center gap-3 px-2.5 py-1.5${active ? " is-on" : ""}`}>
                <span className={`w-5 shrink-0 text-end text-[11px] tabular-nums ${active ? "sb-cp-accent" : "sb-cp-faint"}`}>{i + 1}</span>
                <button
                  type="button"
                  disabled={!isPlayable}
                  onClick={() => onPlayTrack(track)}
                  className="relative inline-flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md transition disabled:cursor-not-allowed"
                  style={{ backgroundImage: `linear-gradient(140deg, ${genre.gradient[0]} 0%, ${genre.gradient[1]} 100%)`, color: "#ffffff" }}
                  aria-label={`Play ${track.title}`}
                >
                  <span className={`absolute inset-0 transition ${isPlayable ? "bg-black/30 group-hover:bg-black/10" : "bg-black/55"}`} />
                  <PlayIcon className={`relative h-3.5 w-3.5 ${isPlayable ? "" : "opacity-40"}`} />
                </button>
                <span className={`sb-cp-ink sb-cp-clip flex-1 text-sm${active ? " font-semibold" : ""}`}>{track.title}</span>
                {active ? <span className="sb-cp-accent shrink-0 text-[10px] font-bold uppercase tracking-wide">Playing</span> : null}
                <span className="sb-cp-faint shrink-0 text-xs tabular-nums">
                  {typeof track.durationSeconds === "number" ? formatDuration(track.durationSeconds) : "—"}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
