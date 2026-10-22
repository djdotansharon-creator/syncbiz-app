"use client";

/**
 * Floating main menu, opened from the gear icon in the app header.
 * Monday-style dropdown: anchored to the trigger, closes on Escape
 * and on click outside. Pure presentational — caller controls open state,
 * supplies the navigation items, and may pass per-item "Pin to top"
 * affordances (Phase 2). Library/Radio are intentionally not included
 * in this menu (see app-shell): they are permanently pinned to the top bar.
 */

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";

export type MainMenuItem = {
  key: string;
  href: string;
  label: string;
  icon: ReactElement;
  isActive: boolean;
  /** Phase 2: present only if the item can be pinned to the top bar. */
  isPinned?: boolean;
  onTogglePin?: () => void;
};

export type MainMenuPopoverProps = {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  items: MainMenuItem[];
  /** Localized heading + a11y label, e.g. "Main menu" / "תפריט ראשי". */
  title: string;
  pinLabel?: string;
  /** Direction hint (mirrors header `dir`) so the panel hugs the correct edge. */
  dir?: "ltr" | "rtl";
  /** Optional action area rendered below the items (e.g. Log out). */
  footer?: ReactElement | null;
  /** Optional row rendered right under the title, above the items (e.g. the display-mode picker). */
  lead?: ReactElement | null;
  /** The trigger's glyph (the gear): drawn again INSIDE the open panel's top-right corner, where it
   *  spins open/closed and closes the menu (owner, 2026-10-15). The real trigger hides meanwhile. */
  anchorGlyph?: ReactElement | null;
  closeLabel?: string;
};

export function MainMenuPopover({
  open,
  onClose,
  anchorRef,
  items,
  title,
  pinLabel,
  dir = "ltr",
  footer,
  lead,
  anchorGlyph,
  closeLabel,
}: MainMenuPopoverProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  // The parent app header uses overflow:hidden to contain its glow/blur
  // layers. If we position the panel as `absolute` inside that header, rows
  // below the header bottom get clipped (Settings / Access / Architecture).
  // Render the panel in a portal with `position: fixed` and compute the
  // coordinates from the trigger's bounding rect so it can overflow freely.
  const [coords, setCoords] = useState<{ top: number; right: number; left: number; side: "left" | "right"; gear: { top: number; left: number; width: number; height: number } } | null>(null);
  /* 2026-10-15 (owner: "you only made the opening nice"): when `open` flips to false the panel stays
     mounted for the reverse animation (`sb-menu-dismiss`, shrinks back into the gear) and unmounts on
     animationend. Previous-render state pattern (React Compiler: no setState inside effects). */
  const [exiting, setExiting] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) setExiting(true);
  }
  /* the panel only ever opens after a client-side click, so `document` exists whenever it renders
     (the former `mounted` flag + its setState-in-effect are gone — React Compiler lint). */

  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const el = anchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setCoords({
        /* owner, 2026-10-15: the panel rises so the gear sits in ITS top-right corner — the title line
           (6px panel padding + 8px header padding + half a 15px line ≈ 21px) centres on the gear */
        top: Math.max(4, Math.round(rect.top + rect.height / 2 - 21)),
        right: Math.max(4, window.innerWidth - rect.right - 6), /* owner: a touch to the right */
        left: Math.max(8, rect.left),
        /* 2026-10-20 (RTL): in a right-to-left interface the gear sits at the LEFT edge — the panel then opens to its right with the gear in its top-LEFT corner
           (before, it always opened leftwards from the gear and was drawn off-screen, so the Display row could not be reached) */
        side: rect.left + rect.width / 2 < window.innerWidth / 2 ? "left" : "right",
        gear: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
      });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, anchorRef]);

  /* owner, 2026-10-15: the panel opens from, and closes into, a CIRCLE the size of the gear — the morph
     scales non-uniformly to a 32×32 box, so the factors depend on the panel's real size. */
  useLayoutEffect(() => {
    const p = panelRef.current;
    if (!p) return;
    p.style.setProperty("--sb-menu-sx", (32 / Math.max(1, p.offsetWidth)).toFixed(4));
    p.style.setProperty("--sb-menu-sy", (32 / Math.max(1, p.offsetHeight)).toFixed(4));
    /* the circle must land ON the gear: translate the panel's centre to the gear's centre
       (gear centre inside the panel = 22px from its right edge, 21px from its top) */
    p.style.setProperty("--sb-menu-dx", `${((coords?.side === "left" ? 22 : p.offsetWidth - 22) - p.offsetWidth / 2).toFixed(1)}px`);
    p.style.setProperty("--sb-menu-dy", `${(21 - p.offsetHeight / 2).toFixed(1)}px`);
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    const onDocPointerDown = (e: MouseEvent) => {
      const panel = panelRef.current;
      const anchor = anchorRef.current;
      const target = e.target as Node | null;
      if (!target) return;
      if (panel && panel.contains(target)) return;
      if (anchor && anchor.contains(target)) return;
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDocPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDocPointerDown, true);
    };
  }, [open, anchorRef, onClose]);

  if ((!open && !exiting) || !coords || typeof document === "undefined") return null;
  const dismissing = !open && exiting;

  // RTL: hug the viewport's left side (matching header's logical "end" edge).
  // LTR: hug the right side under the trigger cluster.
  const panelStyle: React.CSSProperties =
    coords.side === "left"
      ? { position: "fixed", top: coords.top, left: Math.max(4, coords.gear.left - 6) }
      : { position: "fixed", top: coords.top, right: coords.right };

  const node = (
    <div
      ref={panelRef}
      role="menu"
      aria-label={title}
      dir={dir}
      data-side={coords.side}
      style={panelStyle}
      /* 2026-10-14 (owner): the menu follows the new design line — no border, soft fills, white text,
         frosted glass in transparent mode (see `.main-menu-popover` in globals.css). */
      className={`main-menu-popover ${dismissing ? "sb-menu-dismiss" : "sb-menu-emerge"} z-[100] w-72 overflow-hidden rounded-2xl p-1.5`}
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget && e.animationName === "sb-menu-dismiss") setExiting(false);
      }}
    >
      <header className="px-3 pb-1 pt-2">
        <p className="sb-menu-title">{title}</p>
      </header>
      {lead ? <div className="main-menu-lead">{lead}</div> : null}
      <ul className="main-menu-list max-h-[min(75vh,640px)] overflow-y-auto py-1">
        {items.map((item) => (
          <li key={item.key}>
            <div
              className={`main-menu-row group flex items-center gap-1 px-0.5 py-0.5 ${
                item.isActive ? "main-menu-row-active" : ""
              }`}
            >
              <Link
                href={item.href}
                onClick={onClose}
                className={`flex flex-1 items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-[13px] transition-colors ${
                  item.isActive
                    ? "bg-white/[0.10] text-[#f5f5f7]"
                    : "text-[#f5f5f7] hover:bg-white/[0.06]"
                }`}
              >
                <span
                  aria-hidden
                  className={`inline-flex h-5 w-5 items-center justify-center ${
                    item.isActive ? "text-[#f5f5f7]" : "text-[#f5f5f7]/90 group-hover:text-[#f5f5f7]"
                  }`}
                >
                  {item.icon}
                </span>
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
              </Link>
              {item.onTogglePin ? (
                <button
                  type="button"
                  role="switch"
                  aria-checked={!!item.isPinned}
                  aria-label={pinLabel ?? "Pin to top"}
                  title={pinLabel ?? "Pin to top"}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    item.onTogglePin?.();
                  }}
                  className={`main-menu-pin-toggle ${
                    item.isPinned ? "main-menu-pin-on" : "main-menu-pin-off"
                  }`}
                >
                  <span className="main-menu-pin-knob" aria-hidden />
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {footer ? <div className="main-menu-footer p-1">{footer}</div> : null}
      <style jsx>{`
        .main-menu-pin-toggle {
          position: relative;
          display: inline-flex;
          align-items: center;
          width: 28px;
          height: 16px;
          margin-inline-end: 6px;
          border-radius: 999px;
          border: 0;
          background: rgba(255, 255, 255, 0.16);
          transition:
            background 200ms ease,
            box-shadow 200ms ease;
          cursor: pointer;
          flex-shrink: 0;
        }
        .main-menu-pin-toggle:focus-visible {
          outline: none;
          box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.25);
        }
        .main-menu-pin-on {
          background: rgba(255, 255, 255, 0.9);
        }
        .main-menu-pin-off:hover {
          background: rgba(255, 255, 255, 0.26);
        }
        :global(.main-menu-pin-knob) {
          position: absolute;
          top: 2px;
          inset-inline-start: 2px;
          width: 12px;
          height: 12px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.92);
          transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1), background 200ms ease;
        }
        .main-menu-pin-on :global(.main-menu-pin-knob) {
          transform: translateX(12px);
          background: #1c1c1e;
        }
        [dir="rtl"] .main-menu-pin-on :global(.main-menu-pin-knob) {
          transform: translateX(-12px);
        }
      `}</style>
    </div>
  );

  const gearClone = anchorGlyph ? (
    <button
      type="button"
      aria-label={closeLabel ?? "Close menu"}
      title={closeLabel ?? "Close menu"}
      onClick={onClose}
      className={`main-menu-gear-clone ${dismissing ? "is-closing" : "is-open"}`}
      style={{ position: "fixed", top: coords.gear.top, left: coords.gear.left, width: coords.gear.width, height: coords.gear.height }}
    >
      {anchorGlyph}
    </button>
  ) : null;
  return createPortal(
    <>
      {node}
      {gearClone}
    </>,
    document.body,
  );
}
