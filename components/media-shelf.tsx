"use client";

/**
 * MediaShelf — a row of small square cards (cover · name · "N songs") that scrolls sideways, eight visible, with an arrow for the
 * rest; hover shows a bare white play and a ⋯ with every option (owner 2026-10-18: albums and playlists in the search).
 * Also `useAlbumShelf` (all of a singer's albums, newest first, from /api/album-search). Styles: `.sb-shelf*` in globals.css.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTr } from "@/lib/i18n/use-tr";

export type ShelfItem = { id: string; title: string; subtitle: string; cover: string | null };
export type ShelfMenuEntry = { label: string; onClick: () => void };

export type ShelfAlbum = { id: string; name: string; artist: string; cover: string | null; tracks: number; year: number | null; url: string };

const albumCache = new Map<string, { artist: string | null; mode: string; albums: ShelfAlbum[] }>();
const EMPTY: { artist: string | null; mode: string; albums: ShelfAlbum[] } = { artist: null, mode: "none", albums: [] };

/** Every album of the singer (or the albums with that name) for the search term — asked once per term. */
export function useAlbumShelf(term: string | null): { artist: string | null; mode: string; albums: ShelfAlbum[] } {
  const [, bump] = useState(0);
  const key = term ? term.trim().toLowerCase() : "";
  useEffect(() => {
    if (!key || key.length < 2 || albumCache.has(key)) return;
    let off = false;
    fetch(`/api/album-search?q=${encodeURIComponent(key)}`)
      .then((r) => r.json())
      .then((j: { artist?: string | null; mode?: string; albums?: ShelfAlbum[] }) => {
        albumCache.set(key, { artist: j?.artist ?? null, mode: j?.mode ?? "none", albums: Array.isArray(j?.albums) ? j.albums : [] });
        if (!off) bump((n) => n + 1);
      })
      .catch(() => {
        albumCache.set(key, EMPTY);
      });
    return () => {
      off = true;
    };
  }, [key]);
  return key ? (albumCache.get(key) ?? EMPTY) : EMPTY;
}

function Menu({ anchor, entries, onClose }: { anchor: DOMRect; entries: ShelfMenuEntry[]; onClose: () => void }) {
  useEffect(() => {
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  const left = Math.min(anchor.right - 200, window.innerWidth - 216);
  return createPortal(
    <div className="sb-shelf-menu" style={{ left: Math.max(8, left), top: anchor.bottom + 6 }} onMouseDown={(e) => e.stopPropagation()} role="menu">
      {entries.map((e) => (
        <button
          key={e.label}
          type="button"
          role="menuitem"
          onClick={() => {
            e.onClick();
            onClose();
          }}
        >
          {e.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}

export function MediaShelf({
  title,
  items,
  busyId,
  onPlay,
  menu,
  cascade,
  songsWord = "songs",
  onOpen,
}: {
  title: string;
  items: Array<ShelfItem & { tracks?: number }>;
  busyId?: string | null;
  onPlay: (id: string) => void;
  menu: (id: string) => ShelfMenuEntry[];
  cascade: () => React.CSSProperties;
  songsWord?: string;
  /** when given, a click on the cover OPENS the item (a screen of its own) instead of playing it; the ⋯ menu still carries Play */
  onOpen?: (id: string) => void;
}) {
  const tr = useTr();
  const scroller = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ left: false, right: false });
  const [open, setOpen] = useState<{ id: string; rect: DOMRect } | null>(null);
  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    // PHYSICAL sides: can the cards still move to the left / to the right? (in right-to-left `scrollLeft` runs from 0 at the start, on the RIGHT, down to −max —
    // owner 2026-10-22: in Hebrew the "more" arrow stood on the right, where there is nothing more, and did nothing)
    const max = el.scrollWidth - el.clientWidth;
    const rtl = getComputedStyle(el).direction === "rtl";
    const next = rtl ? { left: max + el.scrollLeft > 4, right: el.scrollLeft < -4 } : { left: el.scrollLeft > 4, right: el.scrollLeft < max - 4 };
    setEdge((prev) => (prev.left === next.left && prev.right === next.right ? prev : next));
  }, []);
  useLayoutEffect(() => {
    measure();
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, items.length]);
  // Arrow paging (owner 2026-10-18: "not smooth, not fast enough"): the scroll position JUMPS to the target at once and the cards
  // slide the same distance back to rest with a CSS transform transition — compositor-driven, so it stays smooth even when the page
  // is busy (the old rAF scrollLeft loop ran on the main thread). Quick start, calm tail, ~600ms. A second press mid-slide continues
  // from where the cards visually are. Wheel / trackpad / touch scrolling stay native.
  const track = useRef<HTMLDivElement>(null);
  const slideDone = useRef(0);
  useEffect(() => () => window.clearTimeout(slideDone.current), []);
  const page = (dir: 1 | -1) => {
    const el = scroller.current;
    const tr = track.current;
    if (!el || !tr) return;
    const card = el.querySelector<HTMLElement>(".sb-shelf-card");
    const unit = (card?.offsetWidth ?? 120) + 10;
    const perPage = Math.max(1, Math.floor((el.clientWidth - 24) / unit) - 1);
    const from = el.scrollLeft;
    const rtl = getComputedStyle(el).direction === "rtl";
    const max = el.scrollWidth - el.clientWidth;
    const want = Math.min(rtl ? 0 : max, Math.max(rtl ? -max : 0, from + dir * perPage * unit));
    if (Math.abs(want - from) < 2) return;
    // where the cards visually are right now (a slide may still be running)
    const m41 = new DOMMatrixReadOnly(getComputedStyle(tr).transform === "none" ? undefined : getComputedStyle(tr).transform).m41;
    el.scrollLeft = want;
    const moved = el.scrollLeft - from; // what the browser really scrolled (clamped / rounded)
    if (Math.abs(moved) < 1) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    window.clearTimeout(slideDone.current);
    tr.style.transition = "none";
    tr.style.transform = `translate3d(${m41 + moved}px,0,0)`; // the cards stay exactly where they were …
    void tr.offsetWidth; // … commit that frame
    const dur = Math.round(Math.min(760, 480 + Math.abs(moved) * 0.12));
    tr.style.transition = `transform ${dur}ms cubic-bezier(0.4, 0, 0.1, 1)`;
    tr.style.transform = "translate3d(0,0,0)"; // … then glide to rest
    slideDone.current = window.setTimeout(() => {
      tr.style.transition = "";
      tr.style.transform = "";
    }, dur + 60);
  };
  if (items.length === 0) return null;
  return (
    <section className="sb-shelf sb-cascade" style={cascade()} data-open={onOpen ? "1" : undefined}>
      <div className="sb-shelf-head">
        <p>{title}</p>
        <span className="sb-shelf-count">{items.length}</span>
      </div>
      <div className="sb-shelf-wrap">
        <div ref={scroller} className="sb-shelf-scroll" onScroll={measure}>
          <div ref={track} className="sb-shelf-track">
          {items.map((it) => (
            <div key={it.id} className={`sb-shelf-card${busyId === it.id ? " is-busy" : ""}`}>
              <div className="sb-shelf-cover">
                {it.cover ? <img src={it.cover} alt="" loading="lazy" draggable={false} /> : <span className="sb-shelf-initial">{it.title.charAt(0)}</span>}
                <button type="button" className="sb-shelf-hit" onClick={() => (onOpen ?? onPlay)(it.id)} aria-label={onOpen ? it.title : tr("Play {title}", { title: it.title })} />
                <span className="sb-shelf-play" aria-hidden>
                  <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2.6" strokeLinejoin="round"><path d="M8.5 5.5v13l10.5-6.5L8.5 5.5z" /></svg>
                </span>
                <span className="sb-shelf-spin" aria-hidden />
                <button
                  type="button"
                  className="sb-shelf-more"
                  aria-label={`Options for ${it.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpen({ id: it.id, rect: e.currentTarget.getBoundingClientRect() });
                  }}
                >
                  <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden><circle cx="3.5" cy="8" r="1.3" /><circle cx="8" cy="8" r="1.3" /><circle cx="12.5" cy="8" r="1.3" /></svg>
                </button>
              </div>
              <p className="sb-shelf-title" title={it.title}>{it.title}</p>
              <p className="sb-shelf-sub">{it.tracks ? `${it.tracks} ${songsWord}` : ""}{it.tracks && it.subtitle ? " · " : ""}{it.subtitle}</p>
            </div>
          ))}
          <span className="sb-shelf-end" aria-hidden />
          </div>
        </div>
        {edge.left ? (
          <button type="button" className="sb-shelf-arrow sb-shelf-arrow--left" onClick={() => page(-1)} aria-label={tr("Previous")}>
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10 3.5 5.5 8 10 12.5" /></svg>
          </button>
        ) : null}
        {edge.right ? (
          <button type="button" className="sb-shelf-arrow sb-shelf-arrow--right" onClick={() => page(1)} aria-label={tr("More")}>
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3.5 10.5 8 6 12.5" /></svg>
          </button>
        ) : null}
      </div>
      {open ? <Menu anchor={open.rect} entries={menu(open.id)} onClose={() => setOpen(null)} /> : null}
    </section>
  );
}
