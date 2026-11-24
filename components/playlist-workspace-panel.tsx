"use client";

/**
 * PlaylistWorkspacePanel — an OPENED playlist shown in the album look (owner 2026-11-22: "every playlist should open like our albums — 1, 2, 3 …").
 * The cover square, the name, "N songs", the big bare play (the whole playlist), then every song in the playlist's order: a big thin number, its cover, its name and its
 * details (genre · length). A click on a song plays it from there. At the end of each row a horizontal ⋯ (owner 2026-11-22) opens the small glass menu the library cards use
 * (same classes, same pop in / pop out): Play · Add to playlist · Remove / delete (the same "remove from this playlist only / delete entirely" dialog the classic card asks).
 * It draws what the library already holds in memory — nothing is fetched here, so the screen can be shown the moment it is chosen (the library preloads the covers first,
 * see `preloadPlaylistCovers`) — and it touches no playback code: every action goes through the callbacks the library hands in, the same ones the classic view uses.
 * The classic view stays one click away ("Classic view") and is remembered. Styles: the album's own `.sb-alb*` in globals.css (+ `.sb-alb-classic`, `.sb-alb-more`, `data-active`).
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { useLocale } from "@/lib/locale-context";
import { LIBRARY_CARD_FALLBACK_GENRE, type UnifiedSource } from "@/lib/source-types";
import { LibraryItemContextDeleteModal } from "@/components/library-item-context-delete-modal";
import type { LibraryItemDeleteContext } from "@/components/source-card-unified";

const HE = {
  songs: (n: number) => (n === 0 ? "אין שירים" : n === 1 ? "שיר אחד" : `${n} שירים`),
  by: "נוצר על ידי",
  back: "חזרה לפלייליסטים",
  playAll: "נגן את הפלייליסט",
  classic: "תצוגה קלאסית",
  classicTitle: "חזרה לתצוגה הקודמת - כרטיסים עם כל הפעולות",
  empty: "אין עדיין שירים בפלייליסט הזה",
  more: "פעולות",
  play: "השמע",
  add: "הוסף לפלייליסט…",
  remove: "הסר / מחק…",
};
const EN = {
  songs: (n: number) => (n === 0 ? "No songs" : n === 1 ? "1 song" : `${n} songs`),
  by: "created by",
  back: "Back to playlists",
  playAll: "Play playlist",
  classic: "Classic view",
  classicTitle: "Back to the previous view - cards with every action",
  empty: "No songs in this playlist yet",
  more: "More",
  play: "Play",
  add: "Add to playlist…",
  remove: "Remove / delete…",
};

const MENU_W = 196;
const MENU_H = 14 + 36 * 3 + 9;

type SongMenu = { item: UnifiedSource; top: number; left: number; origin: "top left" | "top right" };

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
  createdBy,
  items,
  activeId,
  onBack,
  onPlayAll,
  onPlayItem,
  onClassicView,
  onAddToPlaylist,
  deleteContextFor,
  canDeleteFromLibrary,
  onDeleteFromLibrary,
}: {
  title: string;
  cover: string | null;
  /** who made the playlist (display name) — a small "created by" line under the name; none when it was not recorded */
  createdBy?: string | null;
  items: UnifiedSource[];
  /** the song that is playing now (highlighted), if it is one of these */
  activeId: string | null;
  onBack: () => void;
  onPlayAll: () => void;
  onPlayItem: (item: UnifiedSource) => void;
  onClassicView: () => void;
  /** the library's own "add to playlist" for a song (opens its picker, or adds straight to a playlist being built) */
  onAddToPlaylist: (item: UnifiedSource) => void;
  /** what removing this song means here (the classic card's own rule) */
  deleteContextFor: (item: UnifiedSource) => LibraryItemDeleteContext;
  canDeleteFromLibrary: (item: UnifiedSource) => boolean;
  onDeleteFromLibrary: (item: UnifiedSource) => void | Promise<void>;
}): ReactElement {
  const { locale } = useLocale();
  const he = locale === "he";
  const t = he ? HE : EN;

  const [menu, setMenu] = useState<SongMenu | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuOpenedAtRef = useRef(0);
  const [delFor, setDelFor] = useState<UnifiedSource | null>(null);
  const [deleting, setDeleting] = useState(false);
  const delOpenRef = useRef(false);
  useEffect(() => {
    delOpenRef.current = delFor !== null;
  }, [delFor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || delOpenRef.current) return;
      if (document.querySelector('[role="dialog"]')) return; // a dialog (add to playlist, delete …) is open: Esc is for IT, not for leaving this screen
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  // the menu: nothing is blocked while it is open — a press outside closes it and goes through, a scroll closes it, Esc closes ONLY the menu (not the screen)
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setMenuOpen(false);
    };
    const onPress = (e: PointerEvent) => {
      const tg = e.target as Element | null;
      if (menuRef.current?.contains(tg) || tg?.closest?.(".sb-alb-more")) return; // a ⋯ button decides for itself (toggle / switch to its own song)
      setMenuOpen(false);
    };
    // a scroll closes the menu — except the one the browser reports a moment AFTER the press that opened it (a ⋯ at the edge of the list is scrolled into view first)
    const onScroll = () => {
      if (performance.now() - menuOpenedAtRef.current < 300) return;
      setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPress, true);
    window.addEventListener("wheel", onScroll, { passive: true, capture: true });
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPress, true);
      window.removeEventListener("wheel", onScroll, { capture: true } as EventListenerOptions);
      window.removeEventListener("scroll", onScroll, { capture: true } as EventListenerOptions);
    };
  }, [menuOpen]);

  const openMenu = useCallback(
    (item: UnifiedSource, btn: HTMLElement) => {
      if (menuOpen && menu?.item.id === item.id) {
        setMenuOpen(false);
        return;
      }
      const r = btn.getBoundingClientRect();
      // it opens BESIDE the button (never covers it): Hebrew prefers the left side, English the right; the other one when there is no room; kept inside the viewport
      const fitsRight = r.right + 8 + MENU_W <= window.innerWidth - 8;
      const fitsLeft = r.left - 8 - MENU_W >= 8;
      const toRight = he ? !fitsLeft && fitsRight : fitsRight || !fitsLeft;
      setMenu({
        item,
        top: Math.max(8, Math.min(r.top - 6, window.innerHeight - MENU_H - 8)),
        left: toRight ? Math.min(r.right + 8, Math.max(8, window.innerWidth - 8 - MENU_W)) : Math.max(8, r.left - 8 - MENU_W),
        origin: toRight ? "top left" : "top right",
      });
      menuOpenedAtRef.current = performance.now();
      setMenuOpen(true);
    },
    [he, menu, menuOpen],
  );

  const delCtx = delFor ? deleteContextFor(delFor) : null;

  return (
    <div dir={he ? "rtl" : "ltr"} className="sb-alb sb-alb-pl min-h-0 w-full flex-1">
      <header className="sb-alb-head">
        <span className="sb-alb-cover">
          {cover ? <img src={cover} alt="" draggable={false} /> : <span className="sb-alb-initial">{title.charAt(0)}</span>}
        </span>
        <div className="sb-alb-titles">
          <h2 title={title}>{title}</h2>
          {createdBy ? (
            <p className="sb-alb-by">
              {t.by} <b>{createdBy}</b>
            </p>
          ) : null}
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
            const isOpen = menuOpen && menu?.item.id === it.id;
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
                <button
                  type="button"
                  className={`sb-alb-more${isOpen ? " is-open" : ""}`}
                  aria-haspopup="menu"
                  aria-expanded={isOpen}
                  aria-label={`${t.more}: ${it.title}`}
                  title={t.more}
                  onClick={(e) => openMenu(it, e.currentTarget)}
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <circle cx="5" cy="12" r="1.8" />
                    <circle cx="12" cy="12" r="1.8" />
                    <circle cx="19" cy="12" r="1.8" />
                  </svg>
                </button>
              </li>
            );
          })}
        </ol>
      )}
      {menu
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              dir={he ? "rtl" : "ltr"}
              style={{ top: menu.top, left: menu.left, width: MENU_W, transformOrigin: menu.origin }}
              onClick={(e) => e.stopPropagation()}
              onAnimationEnd={(e) => {
                if (!menuOpen && e.target === e.currentTarget && e.animationName === "sb-pop-out") setMenu(null);
              }}
              className={`sb-card-menu ${menuOpen ? "sb-anim-pop" : "sb-anim-pop-out pointer-events-none"} fixed z-[9975]`}
            >
              <button
                type="button"
                role="menuitem"
                className="sb-card-menu-item"
                onClick={() => {
                  setMenuOpen(false);
                  onPlayItem(menu.item);
                }}
              >
                <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden>
                  <path d="M8.5 5.5v13l10.5-6.5L8.5 5.5z" />
                </svg>
                <span>{t.play}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="sb-card-menu-item"
                onClick={() => {
                  setMenuOpen(false);
                  onAddToPlaylist(menu.item);
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 5v14M5 12h14" />
                </svg>
                <span>{t.add}</span>
              </button>
              <div className="sb-card-menu-sep" aria-hidden />
              <button
                type="button"
                role="menuitem"
                className="sb-card-menu-item sb-card-menu-item--danger"
                onClick={() => {
                  setMenuOpen(false);
                  setDelFor(menu.item);
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  <line x1="10" y1="11" x2="10" y2="17" />
                  <line x1="14" y1="11" x2="14" y2="17" />
                </svg>
                <span>{t.remove}</span>
              </button>
            </div>,
            document.body,
          )
        : null}
      {delFor && delCtx ? (
        <LibraryItemContextDeleteModal
          isOpen
          onClose={() => setDelFor(null)}
          variant={delCtx.kind === "in_playlist" ? "in_playlist" : "all_library"}
          onRemoveFromPlaylist={delCtx.kind === "in_playlist" ? delCtx.onRemoveFromPlaylist : undefined}
          onDeleteFromLibrary={async () => {
            setDeleting(true);
            try {
              await onDeleteFromLibrary(delFor);
            } finally {
              setDeleting(false);
            }
          }}
          loading={deleting}
          showDeleteFromLibrary={canDeleteFromLibrary(delFor)}
        />
      ) : null}
    </div>
  );
}
