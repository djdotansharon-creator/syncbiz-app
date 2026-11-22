"use client";

/**
 * PlaylistWorkspacePanel — an OPENED playlist shown in the album look (owner 2026-11-22: "every playlist should open like our albums — 1, 2, 3 …").
 * The cover square, the name, "N songs", the big bare play (the whole playlist), then every song in the playlist's order: a big thin number, its cover, its name and its
 * details (genre · length). A click on a song plays it from there. It draws what the library already holds in memory — nothing is fetched here, so the screen can
 * be shown the moment it is chosen (the library preloads the covers first, see `preloadPlaylistCovers`) — and it touches no playback code: playing goes through the
 * same callbacks the classic view uses. The classic view (cards / rows with every per-song action) stays one click away ("Classic view") and is remembered.
 * Styles: the album's own `.sb-alb*` in globals.css (+ `.sb-alb-classic`, `data-active`).
 */

import { useEffect, type CSSProperties, type ReactElement } from "react";
import { useLocale } from "@/lib/locale-context";
import { LIBRARY_CARD_FALLBACK_GENRE, type UnifiedSource } from "@/lib/source-types";

const HE = {
  songs: (n: number) => (n === 0 ? "אין שירים" : n === 1 ? "שיר אחד" : `${n} שירים`),
  back: "חזרה לפלייליסטים",
  playAll: "נגן את הפלייליסט",
  classic: "תצוגה קלאסית",
  classicTitle: "חזרה לתצוגה הקודמת - כרטיסים עם כל הפעולות",
  empty: "אין עדיין שירים בפלייליסט הזה",
};
const EN = {
  songs: (n: number) => (n === 0 ? "No songs" : n === 1 ? "1 song" : `${n} songs`),
  back: "Back to playlists",
  playAll: "Play playlist",
  classic: "Classic view",
  classicTitle: "Back to the previous view - cards with every action",
  empty: "No songs in this playlist yet",
};

function mmss(sec: number | undefined): string {
  if (!sec || sec < 1) return "";
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function genreOf(s: UnifiedSource): string {
  const g = (s.genre ?? "").trim();
  return g && g !== LIBRARY_CARD_FALLBACK_GENRE ? g : "";
}

/**
 * Warm the browser's picture cache for what the screen shows FIRST (the header cover + the top rows), so the screen swaps in with its pictures already there —
 * "load before the effect, then switch" (owner 2026-11-22). Never waits longer than `maxMs`; a picture that fails or is slow just loads in place as it always did.
 */
export function preloadPlaylistCovers(urls: Array<string | null | undefined>, maxMs = 300): Promise<void> {
  const list = [...new Set(urls.filter((u): u is string => typeof u === "string" && /^(https?:)?\/\//.test(u)))].slice(0, 12);
  if (list.length === 0 || typeof Image === "undefined") return Promise.resolve();
  return new Promise<void>((resolve) => {
    let left = list.length;
    const timer = setTimeout(resolve, maxMs);
    const one = () => {
      left -= 1;
      if (left <= 0) {
        clearTimeout(timer);
        resolve();
      }
    };
    for (const u of list) {
      const im = new Image();
      im.onload = one;
      im.onerror = one;
      im.src = u;
    }
  });
}

export function PlaylistWorkspacePanel({
  title,
  cover,
  items,
  activeId,
  onBack,
  onPlayAll,
  onPlayItem,
  onClassicView,
}: {
  title: string;
  cover: string | null;
  items: UnifiedSource[];
  /** the song that is playing now (highlighted), if it is one of these */
  activeId: string | null;
  onBack: () => void;
  onPlayAll: () => void;
  onPlayItem: (item: UnifiedSource) => void;
  onClassicView: () => void;
}): ReactElement {
  const { locale } = useLocale();
  const he = locale === "he";
  const t = he ? HE : EN;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  return (
    <div dir={he ? "rtl" : "ltr"} className="sb-alb sb-alb-pl min-h-0 w-full flex-1">
      <header className="sb-alb-head">
        <span className="sb-alb-cover">
          {cover ? <img src={cover} alt="" draggable={false} /> : <span className="sb-alb-initial">{title.charAt(0)}</span>}
        </span>
        <div className="sb-alb-titles">
          <h2 title={title}>{title}</h2>
          <p className="sb-alb-count">{t.songs(items.length)}</p>
          <button type="button" className="sb-alb-classic" onClick={onClassicView} title={t.classicTitle}>
            {t.classic}
          </button>
        </div>
        {items.length > 0 ? (
          <button type="button" className="sb-alb-play" onClick={onPlayAll} aria-label={t.playAll} title={t.playAll}>
            <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" aria-hidden>
              <path d="M8.5 5.5v13l10.5-6.5L8.5 5.5z" />
            </svg>
          </button>
        ) : null}
        <button type="button" className="sb-wz-x" onClick={onBack} aria-label={t.back} title={t.back}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
            <path d="M7 7l10 10M17 7L7 17" />
          </svg>
        </button>
      </header>
      {items.length === 0 ? (
        <p className="sb-alb-empty">{t.empty}</p>
      ) : (
        <ol className="sb-alb-list">
          {items.map((it, i) => {
            const meta = [genreOf(it), mmss(it.leafDurationSeconds)].filter(Boolean).join(" · ");
            return (
              <li key={it.id} style={{ ["--d" as string]: `${Math.min(i, 14) * 38}ms` } as CSSProperties}>
                <button type="button" className="sb-alb-row" data-active={activeId === it.id ? "1" : undefined} onClick={() => onPlayItem(it)} title={it.title}>
                  <span className="sb-alb-n">
                    <b>{i + 1}</b>
                  </span>
                  <span className="sb-alb-art">
                    {it.cover ? <img src={it.cover} alt="" loading="lazy" draggable={false} /> : <span className="sb-alb-initial">{it.title.charAt(0)}</span>}
                    <svg className="sb-alb-art-play" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" aria-hidden>
                      <path d="M8.5 5.5v13l10.5-6.5L8.5 5.5z" />
                    </svg>
                  </span>
                  <span className="sb-alb-info">
                    <span className="sb-alb-name">{it.title}</span>
                    {meta ? <span className="sb-alb-meta">{meta}</span> : null}
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
