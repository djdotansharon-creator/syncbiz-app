"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocale } from "@/lib/locale-context";
import { LOCALES } from "@/lib/locales";

type AiMode = "similar" | "refine" | "expand";

async function postAiBuild(body: Record<string, unknown>): Promise<{ title: string; count: number; shortfall?: string | null }> {
  const res = await fetch("/api/playlists/ai-build", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err =
      typeof data.error === "string" && data.error.trim()
        ? data.error.trim()
        : `Request failed (${res.status})`;
    throw new Error(err);
  }
  return {
    title: String(data.title ?? ""),
    count: typeof data.count === "number" ? data.count : Number(data.count) || 0,
    shortfall: data.shortfallExplanation != null ? String(data.shortfallExplanation) : null,
  };
}

/**
 * Inline ⋯ AI actions on SyncBiz playlist shell tiles (similar / refine / expand / send-to-playlist).
 */
export function PlaylistAiShellMenu({
  playlistId,
  playlistName,
  branchId = "default",
  onSendToPlaylist,
  editHref,
  onDeletePress,
  onOpenChange,
}: {
  playlistId: string;
  /** The ⋯ menu opened/closed — the card keeps its hover look while it is open (the menu is a portal). */
  onOpenChange?: (open: boolean) => void;
  playlistName?: string;
  branchId?: string;
  /** Opens the playlist-picker to send this playlist's tracks into another playlist. */
  onSendToPlaylist?: () => void;
  /** Cards merge Edit into THIS menu so there is exactly ONE ⋯ per card. */
  editHref?: string | null;
  /** Cards merge Delete into THIS menu so there is exactly ONE ⋯ per card. */
  onDeletePress?: () => void;
}) {
  const [busy, setBusy] = useState<AiMode | null>(null);
  const [refineOpen, setRefineOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [refineDraft, setRefineDraft] = useState("");

  useEffect(() => { setMounted(true); }, []);

  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const menuPanelRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpenState] = useState(false);
  const setMenuOpen = (next: boolean) => {
    setMenuOpenState(next);
    onOpenChange?.(next);
  };
  // the menu opens on the side the interface reads toward: LEFT of the ⋯ in Hebrew / Arabic, RIGHT in English (the other side when there is no room)
  const { locale } = useLocale();
  const rtl = !!LOCALES.find((l) => l.code === locale)?.rtl;
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; origin?: string } | null>(null);
  /* Exit presence: menu/modal stay mounted while the exit animation plays
     (render-phase state adjustment — allowed; effects-only lint rule unaffected). */
  const [menuPresent, setMenuPresent] = useState(false);
  if (menuOpen && !menuPresent) setMenuPresent(true);
  const [refinePresent, setRefinePresent] = useState(false);
  if (refineOpen && !refinePresent) setRefinePresent(true);
  useEffect(() => {
    if (!menuOpen) return;
    // 2026-10-16 (owner): nothing is blocked while the menu is open — no overlay. A press anywhere outside the
    // menu closes it AND goes through; any scroll/wheel simply closes it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    const onPress = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (menuPanelRef.current?.contains(t) || menuBtnRef.current?.contains(t)) return;
      setMenuOpen(false);
    };
    const onScroll = () => setMenuOpen(false);
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
  }, [menuOpen]);

  useEffect(() => {
    if (!refineOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setRefineOpen(false); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [refineOpen]);
  const [toast, setToast] = useState<string | null>(null);

  const fireLibraryUpdated = () => {
    if (typeof window !== "undefined") window.dispatchEvent(new Event("library-updated"));
  };

  const run = useCallback(
    async (mode: AiMode, refinementPrompt?: string) => {
      setBusy(mode);
      setToast(null);
      try {
        const body: Record<string, unknown> = {
          mode,
          seedPlaylistId: playlistId,
          branchId: branchId || "default",
          count: 50,
        };
        if (mode === "refine" && refinementPrompt?.trim()) {
          body.refinementPrompt = refinementPrompt.trim();
        }
        const r = await postAiBuild(body);
        const extras = r.shortfall ? ` (${r.shortfall.slice(0, 120)})` : "";
        setToast(`Created: ${r.title} · ${r.count} tracks${extras}`);
        fireLibraryUpdated();
      } catch (e) {
        setToast(e instanceof Error ? e.message : "AI build failed");
      } finally {
        setBusy(null);
      }
    },
    [playlistId, branchId],
  );

  return (
    <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
      {/* Controlled trigger + PORTALED dropdown — cards clip overflow, so the
          menu must render on document.body to float above everything. */}
      <button
        type="button"
        ref={menuBtnRef}
        onClick={() => {
          if (menuOpen) {
            setMenuOpen(false);
            return;
          }
          const r = menuBtnRef.current?.getBoundingClientRect();
          if (r) {
            // Beside the button (right; left at the viewport's edge), top-aligned, kept inside the viewport —
            // it never covers the button, even on the first rows.
            const MENU_W = 204;
            const estH = 300;
            const fitsRight = r.right + 8 + MENU_W <= window.innerWidth - 8;
            const fitsLeft = r.left - 8 - MENU_W >= 8;
            const toRight = rtl ? !fitsLeft && fitsRight : fitsRight || !fitsLeft;
            setMenuPos({
              top: Math.max(8, Math.min(r.top - 6, window.innerHeight - estH - 8)),
              left: toRight ? Math.min(r.right + 8, Math.max(8, window.innerWidth - 8 - MENU_W)) : Math.max(8, r.left - 8 - MENU_W),
              origin: toRight ? "top left" : "top right",
            });
          }
          setMenuOpen(true);
        }}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={`AI playlist tools${playlistName ? ` for ${playlistName}` : ""}`}
        className={`sb-card-dots list-none cursor-pointer rounded-full p-0.5 text-[color:var(--lib-text-secondary)] transition-colors hover:bg-white/[0.12] hover:text-white${menuOpen ? " is-open" : ""}`}
      >
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold">
          ⋯
        </span>
      </button>
      {mounted && menuPresent && menuPos
        ? createPortal(
        <div
          ref={menuPanelRef}
          role="menu"
          style={{ top: menuPos.top, left: menuPos.left, transformOrigin: menuPos.origin }}
          onClick={(e) => e.stopPropagation()}
          onAnimationEnd={(e) => {
            if (!menuOpen && e.target === e.currentTarget && e.animationName === "sb-pop-out") {
              setMenuPresent(false);
            }
          }}
          className={`sb-card-menu sb-card-menu--list ${menuOpen ? "sb-anim-pop" : "sb-anim-pop-out pointer-events-none"} fixed z-[9975] min-w-[11rem] overflow-hidden rounded-xl border border-white/[0.1] bg-[#141418] py-1 text-[11px] shadow-[0_12px_32px_rgba(0,0,0,0.55)]`}
        >
          <button
            type="button"
            disabled={busy != null}
            className="block w-full px-3 py-1.5 text-start text-slate-100 hover:bg-slate-800/90 disabled:opacity-45"
            onClick={() => {
              setMenuOpen(false);
              void run("similar");
            }}
          >
            {busy === "similar" ? "…" : "Create similar"}
          </button>
          <button
            type="button"
            disabled={busy != null}
            className="block w-full px-3 py-1.5 text-start text-slate-100 hover:bg-slate-800/90 disabled:opacity-45"
            onClick={() => {
              setMenuOpen(false);
              setRefineDraft("");
              setRefineOpen(true);
            }}
          >
            Improve with AI
          </button>
          <button
            type="button"
            disabled={busy != null}
            className="block w-full px-3 py-1.5 text-start text-slate-100 hover:bg-slate-800/90 disabled:opacity-45"
            onClick={() => {
              setMenuOpen(false);
              void run("expand");
            }}
          >
            {busy === "expand" ? "…" : "Expand to 50 tracks"}
          </button>
          {onSendToPlaylist && (
            <>
              <div className="my-1 border-t border-white/[0.08]" />
              <button
                type="button"
                disabled={busy != null}
                className="block w-full px-3 py-1.5 text-start text-slate-100 hover:bg-white/[0.07] disabled:opacity-45"
                onClick={() => {
                  setMenuOpen(false);
                  onSendToPlaylist();
                }}
              >
                Send to playlist
              </button>
            </>
          )}
          {(editHref || onDeletePress) && (
            <>
              <div className="my-1 border-t border-white/[0.08]" />
              {editHref ? (
                <a
                  href={editHref}
                  role="menuitem"
                  className="block w-full px-3 py-1.5 text-start text-slate-100 hover:bg-white/[0.07]"
                >
                  Edit playlist
                </a>
              ) : null}
              {onDeletePress ? (
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full px-3 py-1.5 text-start text-[#ff6961] hover:bg-[#ff453a]/10 hover:text-[#ff453a]"
                  onClick={() => {
                    setMenuOpen(false);
                    onDeletePress();
                  }}
                >
                  Delete
                </button>
              ) : null}
            </>
          )}
        </div>,
        document.body)
        : null}

      {/* Centered modal — no backdrop darkening */}
      {mounted && refinePresent
        ? createPortal(
            <div
              className="fixed inset-0 z-[9990] flex items-center justify-center"
              style={{ pointerEvents: "none" }}
            >
              <div
                className={`${refineOpen ? "sb-anim-modal pointer-events-auto" : "sb-anim-modal-out"} mx-4 w-full max-w-md rounded-xl border border-slate-600 bg-slate-950 p-4 text-slate-100 shadow-[0_0_0_1px_rgba(100,116,139,0.25),0_32px_64px_rgba(0,0,0,0.7)]`}
                onClick={(e) => e.stopPropagation()}
                onAnimationEnd={(e) => {
                  if (!refineOpen && e.target === e.currentTarget && e.animationName === "sb-modal-dismiss") {
                    setRefinePresent(false);
                  }
                }}
              >
                <p className="text-sm font-semibold text-white">Improve with AI</p>
                <p className="mt-1 text-[11px] text-slate-400">Adds a refined copy — the original playlist is unchanged.</p>
                <textarea
                  value={refineDraft}
                  onChange={(e) => setRefineDraft(e.target.value)}
                  rows={3}
                  autoFocus
                  placeholder={'e.g. "תחדד אותו יותר רגוע ועדכני"'}
                  className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-900/90 px-2 py-1.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/60"
                />
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
                    onClick={() => setRefineOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={busy != null || !refineDraft.trim()}
                    className="rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-40"
                    onClick={() => {
                      const rp = refineDraft.trim();
                      if (!rp) return;
                      setRefineOpen(false);
                      void run("refine", rp);
                    }}
                  >
                    Build
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {toast ? (
        <p className="absolute left-1/2 top-full z-20 mt-1 w-max max-w-[14rem] -translate-x-1/2 rounded bg-slate-900/98 px-2 py-1 text-[9px] text-cyan-100 shadow-md">
          {toast}
        </p>
      ) : null}
    </div>
  );
}
