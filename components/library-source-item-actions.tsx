"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ActionButtonShare } from "@/components/ui/action-buttons";
import { useLocale, useTranslations } from "@/lib/locale-context";
import { LOCALES } from "@/lib/locales";
import type { UnifiedSource } from "@/lib/source-types";
import { useTr } from "@/lib/i18n/use-tr";

/** Primary play — solid white circle, dark glyph (deck language). BIG on purpose:
    the operator asked for controls a first-grader could hit with confidence. */
const CARD_PLAY_BTN =
  "inline-flex shrink-0 items-center justify-center rounded-full bg-[#f5f5f7] text-[#111114] shadow-[0_2px_12px_-2px_rgba(0,0,0,0.65)] transition-transform duration-150 hover:scale-105 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:pointer-events-none disabled:opacity-40";

/** Edit + Delete live in this quiet ⋯ menu — the bar keeps only play/+/share.
 *  2026-10-16 (owner): a small glass list with icon + label (edit · remove · get the desktop app) that opens
 *  from the ⋯ button and closes back into it; `onOpenChange` lets the card hold its hover look while the menu
 *  (a portal outside the card) is open. */
function CardMoreMenu({
  editHref,
  editLabel,
  onDeletePress,
  showDelete,
  deleteLabel,
  menuLabel,
  onOpenChange,
}: {
  editHref: string | null;
  editLabel: string;
  onDeletePress: () => void;
  showDelete: boolean;
  deleteLabel: string;
  menuLabel: string;
  onOpenChange?: (open: boolean) => void;
}) {
  const tr = useTr();
  // the menu follows the interface direction (owner 2026-10-21: in Hebrew it still opened left-to-right): icons + text mirrored, and it opens to the LEFT of the ⋯ in Hebrew
  const { locale } = useLocale();
  const rtl = !!LOCALES.find((l) => l.code === locale)?.rtl;
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const [open, setOpenState] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; origin: "top left" | "top right" } | null>(null);
  useEffect(() => {
    setMounted(true);
  }, []);
  const [present, setPresent] = useState(false);
  if (open && !present) setPresent(true);
  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
  };
  useEffect(() => {
    if (!open) return;
    // 2026-10-16 (owner): nothing is blocked while the menu is open — no overlay. A press anywhere outside
    // the menu closes it AND goes through; any scroll/wheel simply closes it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPress = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onScroll = () => setOpen(false);
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPress, true);
    window.addEventListener("wheel", onScroll, { passive: true, capture: true });
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPress, true);
      window.removeEventListener("wheel", onScroll, { capture: true } as EventListenerOptions);
      window.removeEventListener("scroll", onScroll, { capture: true } as EventListenerOptions);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  if (!editHref && !showDelete) return null;
  const MENU_W = 184;
  return (
    <>
      <button
        type="button"
        ref={btnRef}
        onClick={() => {
          if (open) {
            setOpen(false);
            return;
          }
          const r = btnRef.current?.getBoundingClientRect();
          if (r) {
            // The menu opens BESIDE the button (to its right; to its left at the viewport's edge), top-aligned
            // with it and kept inside the viewport — so it never covers the button, even on the first rows.
            const estH = 14 + 36 * ((editHref ? 1 : 0) + 1 + (showDelete ? 1 : 0)) + (showDelete ? 9 : 0);
            const fitsRight = r.right + 8 + MENU_W <= window.innerWidth - 8;
            const fitsLeft = r.left - 8 - MENU_W >= 8;
            const toRight = rtl ? !fitsLeft && fitsRight : fitsRight || !fitsLeft; // Hebrew prefers the left side, English the right; the other when there is no room
            setPos({
              top: Math.max(8, Math.min(r.top - 6, window.innerHeight - estH - 8)),
              left: toRight ? Math.min(r.right + 8, Math.max(8, window.innerWidth - 8 - MENU_W)) : Math.max(8, r.left - 8 - MENU_W),
              origin: toRight ? "top left" : "top right",
            });
          }
          setOpen(true);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={menuLabel}
        title={menuLabel}
        className={`sb-card-dots inline-flex shrink-0 items-center justify-center rounded-full text-[#d1d1d6] transition-colors duration-150 hover:bg-white/[0.14] hover:text-white${open ? " is-open" : ""}`}
      >
        <svg className="h-4.5 w-4.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>
      {mounted && present && pos
        ? createPortal(
              <div
                ref={panelRef}
                role="menu"
                dir={rtl ? "rtl" : "ltr"}
                style={{ top: pos.top, left: pos.left, width: MENU_W, transformOrigin: pos.origin }}
                onClick={(e) => e.stopPropagation()}
                onAnimationEnd={(e) => {
                  if (!open && e.target === e.currentTarget && e.animationName === "sb-pop-out") setPresent(false);
                }}
                className={`sb-card-menu ${open ? "sb-anim-pop" : "sb-anim-pop-out pointer-events-none"} fixed z-[9975]`}
              >
                {editHref ? (
                  <a href={editHref} role="menuitem" className="sb-card-menu-item">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                    <span>{editLabel}</span>
                  </a>
                ) : null}
                <a href="/settings#desktop" role="menuitem" className="sb-card-menu-item">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  <span>{tr("Get Desktop app")}</span>
                </a>
                {showDelete ? (
                  <>
                    <div className="sb-card-menu-sep" aria-hidden />
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setOpen(false);
                        onDeletePress();
                      }}
                      className="sb-card-menu-item sb-card-menu-item--danger"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        <line x1="10" y1="11" x2="10" y2="17" />
                        <line x1="14" y1="11" x2="14" y2="17" />
                      </svg>
                      <span>{deleteLabel}</span>
                    </button>
                  </>
                ) : null}
              </div>,
            document.body,
          )
        : null}
    </>
  );
}

/** Not-yet-in-library: compact amber deck chip (distinct from share/edit white chrome). */
const LIBRARY_DECK_ADD_TO_LIBRARY_BTN =
  "inline-flex h-7 w-7 shrink-0 items-center justify-center select-none rounded-lg border-2 border-amber-500/55 bg-slate-900/95 text-amber-100 shadow-[0_0_0_1px_rgba(245,158,11,0.18),0_0_16px_rgba(245,158,11,0.12)] transition-all duration-200 hover:border-amber-400/80 hover:shadow-[0_0_0_2px_rgba(251,191,36,0.28),0_0_22px_rgba(245,158,11,0.16)] hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-amber-400/45 focus:ring-offset-2 focus:ring-offset-slate-950 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40 disabled:hover:scale-100";

const LIBRARY_DECK_IN_LIBRARY_BTN =
  "inline-flex h-7 w-7 shrink-0 items-center justify-center select-none rounded-lg border-2 border-emerald-500/50 bg-slate-900/95 text-emerald-100 shadow-[0_0_0_1px_rgba(16,185,129,0.18),0_0_16px_rgba(16,185,129,0.14)] transition-all duration-200 hover:border-emerald-400/75 hover:shadow-[0_0_0_2px_rgba(52,211,153,0.28),0_0_22px_rgba(16,185,129,0.18)] hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-emerald-400/45 focus:ring-offset-2 focus:ring-offset-slate-950";

/** Leaf bar: Add to playlist (+) — deck chrome aligned with share row, distinct from legacy amber “add to library”. */
const LIBRARY_DECK_ADD_TO_PLAYLIST_BTN =
  "inline-flex h-7 w-7 shrink-0 items-center justify-center select-none rounded-lg border-2 border-slate-500/55 bg-slate-900/95 text-slate-100 shadow-[0_0_0_1px_rgba(148,163,184,0.2),0_0_14px_rgba(34,211,238,0.08)] transition-all duration-200 hover:border-cyan-400/55 hover:text-cyan-100 hover:shadow-[0_0_0_2px_rgba(34,211,238,0.2),0_0_18px_rgba(34,211,238,0.12)] hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-cyan-400/40 focus:ring-offset-2 focus:ring-offset-slate-950 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40";

export function editHrefForLibrarySource(source: UnifiedSource): string | null {
  if (source.origin === "playlist" && source.playlist) return `/playlists/${source.playlist.id}/edit`;
  if (source.origin === "radio" && source.radio) return `/radio/${source.radio.id}/edit`;
  if (source.origin === "source" && source.source) return `/sources/${source.source.id}/edit`;
  return null;
}

/** Leaf rows: expanded playlist track → parent playlist edit; else same as persisted entity resolution. */
export function editHrefForLibraryLeaf(source: UnifiedSource): string | null {
  if (source.id.includes(":track:") && source.playlist?.id) {
    return `/playlists/${source.playlist.id}/edit`;
  }
  return editHrefForLibrarySource(source);
}

type Props = {
  source: UnifiedSource;
  onPlay: () => void;
  isActive: boolean;
  onStop: () => void;
  onPause: () => void;
  libraryDeckChrome?: boolean;
  onShareOpen: () => void;
  onDeletePress?: () => void;
  /** Tighter icon sizes for list rows and compact grid cards */
  compact?: boolean;
  /** When false, reserves space so Play / Edit / Share stay aligned */
  showLibraryDelete?: boolean;
  /**
   * Leaf-only: Play → Edit → + (add to playlist) → Share → Delete (no add-to-library chip).
   * Non-leaf library cards (shells) use `default`.
   */
  actionLayout?: "default" | "leaf";
  /** Required when `actionLayout` is `leaf`. Opens add-to-playlist destination UI. */
  onAddToPlaylistPress?: () => void;
  /** @deprecated Leaf bar uses `onAddToPlaylistPress` instead. */
  onAddToLibrary?: () => void | Promise<void>;
  /** @deprecated Leaf bar does not show in-library chip. */
  inLibrary?: boolean;
  /** Visual-only: disable Play (e.g. local desktop-only items in browser). */
  playDisabled?: boolean;
  playDisabledTitle?: string;
  /** False when the card already carries another ⋯ menu (e.g. AI slot) — ONE ⋯ per card. */
  showMoreMenu?: boolean;
  /** The ⋯ menu opened/closed — the card keeps its hover look while it is open (the menu is a portal). */
  onMoreMenuOpenChange?: (open: boolean) => void;
};

export function LibrarySourceItemActions({
  source,
  onPlay,
  isActive: _isActive,
  onStop: _onStop,
  onPause: _onPause,
  libraryDeckChrome: _libraryDeckChrome = false,
  onShareOpen,
  onDeletePress = () => {},
  compact = false,
  showLibraryDelete = true,
  actionLayout = "default",
  onAddToPlaylistPress,
  onAddToLibrary,
  inLibrary = false,
  playDisabled = false,
  playDisabledTitle = "Desktop only",
  showMoreMenu = true,
  onMoreMenuOpenChange,
}: Props) {
  const { t } = useTranslations();
  const [adding, setAdding] = useState(false);
  const editHref = editHrefForLibrarySource(source);
  const leafEditHref = editHrefForLibraryLeaf(source);
  const leaf = actionLayout === "leaf";



  return (
    <div
      className="library-source-deck-actions mt-0 flex w-full min-w-0 flex-nowrap items-center justify-center gap-0.5"
      role="group"
      aria-label={t.sourceControlsAria}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {/* ONE white play — always. No stop/pause squares on the card while it
          plays (operator: transport lives on the deck); re-clicking the playing
          card is a provider-level noop (sameActiveSession). */}
      <button
        type="button"
        onClick={() => onPlay()}
        disabled={playDisabled}
        title={playDisabled ? playDisabledTitle : t.play}
        aria-label={playDisabled ? playDisabledTitle : t.play}
        className={`${CARD_PLAY_BTN} ${compact ? "h-9 w-9" : "h-11 w-11"}`}
      >
        <svg className={compact ? "h-4.5 w-4.5 ml-0.5" : "h-5 w-5 ml-0.5"} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M8 5v14l11-7L8 5z" />
        </svg>
      </button>
      {leaf ? (
        <>
          <button
            type="button"
            onClick={() => onAddToPlaylistPress?.()}
            className={LIBRARY_DECK_ADD_TO_PLAYLIST_BTN}
            title={t.addToPlaylist}
            aria-label={t.addToPlaylist}
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" aria-hidden>
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </>
      ) : (
        <>
          {inLibrary ? (
            <span className={LIBRARY_DECK_IN_LIBRARY_BTN} title={t.inLibrary} aria-label={t.inLibrary}>
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </span>
          ) : onAddToLibrary ? (
            <button
              type="button"
              disabled={adding}
              onPointerDownCapture={() => {
                if (process.env.NODE_ENV !== "production") {
                  console.log("[SYNC_AUDIT] Add-to-library pointerdown CAPTURE", { listCompact: compact });
                }
              }}
              onMouseDownCapture={() => {
                if (process.env.NODE_ENV !== "production") {
                  console.log("[SYNC_AUDIT] Add-to-library mousedown CAPTURE", { listCompact: compact });
                }
              }}
              onClick={() => {
                if (process.env.NODE_ENV !== "production") {
                  console.log("[SYNC_AUDIT] Add-to-library click -> handler running", { listCompact: compact });
                }
                void (async () => {
                  setAdding(true);
                  try {
                    await onAddToLibrary();
                  } finally {
                    setAdding(false);
                  }
                })();
              }}
              className={LIBRARY_DECK_ADD_TO_LIBRARY_BTN}
              title={t.addToLibrary}
              aria-label={t.addToLibrary}
            >
              {adding ? (
                <span className="text-[10px] font-bold leading-none text-amber-50/90" aria-hidden>
                  …
                </span>
              ) : (
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                  <path d="M12 5v14M5 12h14" />
                </svg>
              )}
            </button>
          ) : null}
        </>
      )}
      <ActionButtonShare variant="player" onClick={onShareOpen} title={t.share} aria-label={t.share} />
      {showMoreMenu ? (
      <CardMoreMenu
        editHref={leaf ? leafEditHref : editHref}
        editLabel={
          source.id.includes(":track:") || (source.origin === "playlist" && source.playlist)
            ? t.editPlaylist
            : source.origin === "radio"
              ? t.radioEdit
              : t.edit
        }
        onDeletePress={onDeletePress}
        showDelete={showLibraryDelete}
        onOpenChange={onMoreMenuOpenChange}
        deleteLabel={t.delete}
        menuLabel={t.sourceControlsAria}
      />
      ) : null}
    </div>
  );
}
