"use client";

/**
 * AlbumWorkspacePanel — an album from the search shelf opened as a screen of its own in the CENTER MONITOR (owner 2026-10-22): the album's cover square and name,
 * "N songs" under the name, then every song in the album's order — numbered 1, 2, 3 …, each in its own soft rectangle with its cover, its name and its details
 * (artist · length) under it. A click on a song plays it; the big bare play plays the whole album. The songs come from /api/album-tracks (iTunes, by the album's
 * collection id); what actually plays is found on YouTube the same way the search does it. Styles: `.sb-alb*` in globals.css.
 */

import { useCallback, useEffect, useState, type ReactElement } from "react";
import { useLocale } from "@/lib/locale-context";
import { usePlayback } from "@/lib/playback-provider";
import { useDevicePlayer } from "@/lib/device-player-context";
import { getYouTubeVideoId } from "@/lib/playlist-utils";
import { unifiedFoundationHints, type UnifiedSource } from "@/lib/source-types";
import type { CenterModuleAlbum } from "@/lib/center-module-context";

type AlbumTrack = { n: number; id: string; name: string; artist: string; durationSec: number | null; cover: string | null; explicit: boolean; genre: string | null };

const HE = {
  songs: (n: number) => (n === 1 ? "שיר אחד" : `${n} שירים`),
  close: "סגור",
  playAlbum: "נגן את האלבום",
  empty: "לא נמצאו שירים לאלבום הזה",
  noVersion: (name: string) => `לא נמצאה גרסה לניגון של “${name}”`,
};
const EN = {
  songs: (n: number) => (n === 1 ? "1 song" : `${n} songs`),
  close: "Close",
  playAlbum: "Play album",
  empty: "No songs found for this album",
  noVersion: (name: string) => `No playable version of “${name}” found`,
};

function mmss(sec: number | null): string {
  if (!sec || sec < 1) return "";
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

const toast = (message: string) => window.dispatchEvent(new CustomEvent("syncbiz:toast", { detail: { message } }));

export function AlbumWorkspacePanel({ album, onClose }: { album: CenterModuleAlbum; onClose: () => void }): ReactElement {
  const { locale } = useLocale();
  const he = locale === "he";
  const t = he ? HE : EN;
  const playback = usePlayback();
  const deviceCtx = useDevicePlayer();
  const [loaded, setLoaded] = useState<{ id: string; tracks: AlbumTrack[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const tracks = loaded && loaded.id === album.id ? loaded.tracks : null;

  useEffect(() => {
    let off = false;
    fetch(`/api/album-tracks?id=${encodeURIComponent(album.id)}`)
      .then((r) => r.json())
      .then((j: { tracks?: AlbumTrack[] }) => {
        if (!off) setLoaded({ id: album.id, tracks: Array.isArray(j?.tracks) ? j.tracks : [] });
      })
      .catch(() => {
        if (!off) setLoaded({ id: album.id, tracks: [] });
      });
    return () => {
      off = true;
    };
  }, [album.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // playSourceOrSend routes CONTROL → MASTER and falls back to this browser (same as the guests panel)
  const start = useCallback(
    (src: UnifiedSource) => {
      if (deviceCtx?.playSourceOrSend) deviceCtx.playSourceOrSend(src);
      else playback.playSource(src);
    },
    [deviceCtx, playback],
  );

  const playTrack = useCallback(
    async (tr: AlbumTrack) => {
      if (busy) return;
      setBusy(tr.id);
      try {
        const q = `${tr.artist || album.artist} ${tr.name}`.trim();
        const r = await fetch(`/api/sources/search?q=${encodeURIComponent(q)}`);
        const j = (await r.json()) as { results?: Array<{ title: string; url: string; cover?: string | null; type?: string }> };
        const hit = (j.results ?? []).find((x) => x.type === "youtube" && getYouTubeVideoId(x.url));
        const vid = hit ? getYouTubeVideoId(hit.url) : null;
        if (!hit || !vid) {
          toast(t.noVersion(tr.name));
          return;
        }
        start({
          id: `search-play-${vid}`,
          title: tr.name,
          genre: tr.genre ?? "Album",
          cover: tr.cover ?? hit.cover ?? album.cover,
          type: "youtube",
          url: hit.url,
          origin: "playlist",
          ...unifiedFoundationHints("playlist", "youtube", hit.url),
        } as UnifiedSource);
      } catch {
        toast(t.noVersion(tr.name));
      } finally {
        setBusy(null);
      }
    },
    [busy, album.artist, album.cover, start, t],
  );

  const playAlbum = useCallback(async () => {
    if (busy) return;
    setBusy("album");
    try {
      const r = await fetch(`/api/album-playlist?artist=${encodeURIComponent(album.artist)}&album=${encodeURIComponent(album.name)}&tracks=${album.tracks}`);
      const j = (await r.json()) as { playlist?: { url: string; cover: string | null } | null };
      const pl = j.playlist ?? null;
      if (!pl) {
        toast(t.noVersion(album.name));
        return;
      }
      const id = pl.url.match(/[?&]list=([^&]+)/)?.[1] ?? pl.url;
      start({
        id: `search-album-${id}`,
        title: album.name,
        genre: "Album",
        cover: album.cover ?? pl.cover,
        type: "youtube",
        url: pl.url,
        origin: "playlist",
        ...unifiedFoundationHints("playlist", "youtube", pl.url),
      } as UnifiedSource);
    } catch {
      toast(t.noVersion(album.name));
    } finally {
      setBusy(null);
    }
  }, [busy, album, start, t]);

  const count = tracks && tracks.length > 0 ? tracks.length : album.tracks;

  return (
    <div dir={he ? "rtl" : "ltr"} className="sb-alb min-h-0 w-full flex-1" data-busy={busy === "album" ? "1" : undefined}>
      <header className="sb-alb-head">
        <span className="sb-alb-cover">
          {album.cover ? <img src={album.cover} alt="" draggable={false} /> : <span className="sb-alb-initial">{album.name.charAt(0)}</span>}
        </span>
        <div className="sb-alb-titles">
          <h2 title={album.name}>{album.name}</h2>
          <p className="sb-alb-count">{t.songs(count)}</p>
        </div>
        <button type="button" className="sb-alb-play" onClick={() => void playAlbum()} aria-label={t.playAlbum} title={t.playAlbum}>
          <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" aria-hidden>
            <path d="M8.5 5.5v13l10.5-6.5L8.5 5.5z" />
          </svg>
        </button>
        <button type="button" className="sb-wz-x" onClick={onClose} aria-label={t.close} title={t.close}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
            <path d="M7 7l10 10M17 7L7 17" />
          </svg>
        </button>
      </header>
      {tracks === null ? (
        <ul className="sb-alb-list" aria-busy="true">
          {Array.from({ length: Math.min(Math.max(album.tracks, 4), 8) }, (_, i) => (
            <li key={i} className="sb-alb-skel" style={{ ["--d" as string]: `${i * 60}ms` } as React.CSSProperties} aria-hidden />
          ))}
        </ul>
      ) : tracks.length === 0 ? (
        <p className="sb-alb-empty">{t.empty}</p>
      ) : (
        <ol className="sb-alb-list">
          {tracks.map((tr, i) => {
            const meta = [tr.artist, mmss(tr.durationSec)].filter(Boolean).join(" · ");
            return (
              <li key={tr.id} style={{ ["--d" as string]: `${Math.min(i, 14) * 38}ms` } as React.CSSProperties}>
                <button type="button" className="sb-alb-row" data-busy={busy === tr.id ? "1" : undefined} onClick={() => void playTrack(tr)} title={tr.name}>
                  <span className="sb-alb-n">
                    <b>{tr.n}</b>
                  </span>
                  <span className="sb-alb-art">
                    {tr.cover ? <img src={tr.cover} alt="" loading="lazy" draggable={false} /> : <span className="sb-alb-initial">{tr.name.charAt(0)}</span>}
                    {/* owner 2026-10-28: the play icon sits ON the song's square, the number stays where it is */}
                    <svg className="sb-alb-art-play" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" aria-hidden>
                      <path d="M8.5 5.5v13l10.5-6.5L8.5 5.5z" />
                    </svg>
                  </span>
                  <span className="sb-alb-info">
                    <span className="sb-alb-name">
                      {tr.name}
                      {tr.explicit ? <i aria-label="Explicit">E</i> : null}
                    </span>
                    <span className="sb-alb-meta">{meta}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
