"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { HydrationSafeImage } from "@/components/ui/hydration-safe-image";
import { MobilePageHeader } from "@/components/mobile/mobile-page-header";
import { MobileTypeBadge } from "@/components/mobile/mobile-type-badge";
import { useMobileSources } from "@/lib/mobile-sources-context";
import { useDevicePlayer } from "@/lib/device-player-context";
import { usePlayback } from "@/lib/playback-provider";
import { getPlaylistTracks } from "@/lib/playlist-types";
import type { PlaylistTrack } from "@/lib/playlist-types";
import type { UnifiedSource, SourceProviderType } from "@/lib/source-types";

/**
 * Mobile Library — playlist detail.
 *
 * This is the URL-level view: a single playlist's hero card at top,
 * followed by a vertical list of its tracks. Layout is intentionally
 * row-based (not a grid) so the user instantly reads this as a
 * different level of the IA than the category card grid above.
 *
 * Play routing reuses `DevicePlayerContext.playSourceOrSend` — the same
 * single source-of-truth that the mini-player and the list-row rely on,
 * so Controller / Player modes behave identically.
 *
 *   • "Play all" → plays the playlist UnifiedSource as-is.
 *   • Row tap   → synthesizes a single-URL UnifiedSource from the track
 *                 and plays that one URL only.
 *
 * The synthesized row-source carries the parent playlist id in the
 * UnifiedSource.id so active-row highlighting and "currentSource" checks
 * stay disambiguated across playlists.
 */
export default function MobilePlaylistDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const { sources, status, error } = useMobileSources();
  const deviceCtx = useDevicePlayer();
  const playbackCtx = usePlayback();

  const source = useMemo(
    () => sources.find((s) => s.id === id) ?? null,
    [sources, id],
  );

  const playlist = source?.playlist ?? null;
  const tracks: PlaylistTrack[] = useMemo(
    () => (playlist ? getPlaylistTracks(playlist) : []),
    [playlist],
  );

  const handlePlayAll = () => {
    if (!source) return;
    if (deviceCtx?.playSourceOrSend) {
      deviceCtx.playSourceOrSend(source);
      return;
    }
    playbackCtx.playSource(source);
  };

  const handlePlayTrack = (track: PlaylistTrack) => {
    if (!source || !playlist) return;
    const synth: UnifiedSource = {
      id: `${playlist.id}:track:${track.id}`,
      title: track.name,
      genre: source.genre || "Mixed",
      cover: track.cover || playlist.thumbnail || source.cover || null,
      type: track.type as SourceProviderType,
      url: track.url,
      origin: "source",
    };
    if (deviceCtx?.playSourceOrSend) {
      deviceCtx.playSourceOrSend(synth);
      return;
    }
    playbackCtx.playSource(synth);
  };

  const isPlayingPlaylist =
    playbackCtx.currentSource?.id === source?.id && playbackCtx.status !== "idle";

  return (
    <>
      <MobilePageHeader
        title="Playlist"
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
        {status === "loading" && !source ? (
          <div className="py-12 text-center text-sm text-slate-500">Loading…</div>
        ) : status === "error" ? (
          <div className="py-12 text-center text-sm text-rose-400">{error}</div>
        ) : !source ? (
          <NotFound />
        ) : (
          <>
            {/* Hero band — cover + title + meta + Play All.
                Clearly distinct from the grid layer above: horizontal card,
                one-line title, big primary Play All stadium button. */}
            <div className="mb-5 flex items-start gap-3.5 rounded-2xl border border-slate-800/70 bg-slate-900/50 p-3.5">
              <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-slate-800 ring-1 ring-slate-700/70 shadow-[0_6px_18px_-6px_rgba(0,0,0,0.55)]">
                {source.cover ? (
                  <HydrationSafeImage src={source.cover} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-slate-500">
                    <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M4 6h12M4 12h12M4 18h8" />
                      <circle cx="19" cy="18" r="2" fill="currentColor" stroke="none" />
                    </svg>
                  </div>
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <p className="line-clamp-2 text-[15px] font-semibold leading-snug tracking-tight text-slate-50">
                  {source.title}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <MobileTypeBadge source={source} />
                  <span className="text-[11px] text-slate-400">
                    {tracks.length} track{tracks.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="mt-auto pt-2">
                  <button
                    type="button"
                    onClick={handlePlayAll}
                    disabled={tracks.length === 0}
                    aria-label={isPlayingPlaylist ? "Pause" : "Play all"}
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-cyan-400/75 bg-slate-900/92 px-4 text-[12px] font-semibold uppercase tracking-wider text-cyan-100 shadow-[0_0_0_1px_rgba(34,211,238,0.35),0_0_22px_-4px_rgba(34,211,238,0.55)] transition hover:border-cyan-300 active:scale-95 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300/60"
                  >
                    {isPlayingPlaylist ? (
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                        <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                      </svg>
                    ) : (
                      <svg className="ml-0.5 h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    )}
                    {isPlayingPlaylist ? "Playing" : "Play all"}
                  </button>
                </div>
              </div>
            </div>

            {/* Tracks — numbered row list.
                Row structure: index · thumb · title + provider badge · play pill. */}
            {tracks.length === 0 ? (
              <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 px-4 py-10 text-center text-sm text-slate-400">
                This playlist is empty.
              </div>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {tracks.map((track, idx) => (
                  <TrackRow
                    key={track.id}
                    index={idx + 1}
                    track={track}
                    fallbackCover={playlist?.thumbnail || source.cover || null}
                    onPlay={() => handlePlayTrack(track)}
                    active={
                      playbackCtx.currentSource?.id === `${playlist?.id ?? ""}:track:${track.id}` &&
                      playbackCtx.status !== "idle"
                    }
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </>
  );
}

function TrackRow({
  index,
  track,
  fallbackCover,
  onPlay,
  active,
}: {
  index: number;
  track: PlaylistTrack;
  fallbackCover: string | null;
  onPlay: () => void;
  active: boolean;
}) {
  const cover = track.cover || fallbackCover;
  // Synthesize the minimal shape `MobileTypeBadge` needs so track rows show
  // the same provider pill (YouTube / SoundCloud / ...) the rest of mobile uses.
  const badgeSource = {
    origin: "source" as const,
    type: track.type as SourceProviderType,
    playlist: undefined,
  };
  return (
    <li
      className={`flex items-center gap-3 rounded-xl border px-3 py-2 transition-colors ${
        active
          ? "border-cyan-400/60 bg-cyan-500/10"
          : "border-slate-800/70 bg-slate-900/40 hover:bg-slate-900/65"
      }`}
    >
      <span className="w-5 shrink-0 text-center text-[11px] font-semibold text-slate-500 tabular-nums">
        {index}
      </span>
      <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-slate-800/80 ring-1 ring-slate-700/60">
        {cover ? (
          <HydrationSafeImage src={cover} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-slate-500">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p
          className={`truncate text-sm font-medium ${
            active ? "text-slate-50" : "text-slate-100"
          }`}
        >
          {track.name}
        </p>
        <div className="mt-0.5 flex items-center gap-1.5">
          <MobileTypeBadge source={badgeSource} />
        </div>
      </div>
      {/* Stadium cyan-neon pill — same language as the main player. */}
      <button
        type="button"
        onClick={onPlay}
        aria-label={active ? "Pause" : "Play"}
        className="flex h-8 w-12 shrink-0 items-center justify-center rounded-lg border border-cyan-400/70 bg-slate-900/92 text-cyan-200 shadow-[0_0_0_1px_rgba(34,211,238,0.3),0_0_16px_-4px_rgba(34,211,238,0.45)] transition hover:border-cyan-300 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300/60"
      >
        {active ? (
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
          </svg>
        ) : (
          <svg className="ml-0.5 h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>
    </li>
  );
}

function NotFound() {
  return (
    <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 px-4 py-10 text-center text-sm text-slate-400">
      <p className="mb-1 text-base font-semibold text-slate-200">Playlist not found</p>
      <p className="mb-4">This playlist may have been removed or is still syncing.</p>
      <Link
        href="/mobile/library"
        className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/70 bg-cyan-500/15 px-4 py-2 text-sm font-semibold text-cyan-100 shadow-[0_0_0_1px_rgba(34,211,238,0.35),0_0_18px_-6px_rgba(34,211,238,0.5)] transition hover:border-cyan-300"
      >
        Back to Library
      </Link>
    </div>
  );
}
