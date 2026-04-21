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
};

export function MainMenuPopover({
  open,
  onClose,
  anchorRef,
  items,
  title,
  pinLabel,
  dir = "ltr",
}: MainMenuPopoverProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  // The parent app header uses overflow:hidden to contain its glow/blur
  // layers. If we position the panel as `absolute` inside that header, rows
  // below the header bottom get clipped (Settings / Access / Architecture).
  // Render the panel in a portal with `position: fixed` and compute the
  // coordinates from the trigger's bounding rect so it can overflow freely.
  const [coords, setCoords] = useState<{ top: number; right: number; left: number } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const el = anchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setCoords({
        top: rect.bottom + 8,
        right: Math.max(8, window.innerWidth - rect.right),
        left: Math.max(8, rect.left),
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

  if (!open || !mounted || !coords) return null;

  // RTL: hug the viewport's left side (matching header's logical "end" edge).
  // LTR: hug the right side under the trigger cluster.
  const panelStyle: React.CSSProperties =
    dir === "rtl"
      ? { position: "fixed", top: coords.top, left: coords.left }
      : { position: "fixed", top: coords.top, right: coords.right };

  const node = (
    <div
      ref={panelRef}
      role="menu"
      aria-label={title}
      dir={dir}
      style={panelStyle}
      className="main-menu-popover z-[100] w-72 overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-950/95 shadow-[0_24px_60px_rgba(0,0,0,0.55),0_0_0_1px_rgba(148,163,184,0.08)_inset] backdrop-blur-xl"
    >
      <header className="border-b border-slate-800/70 px-4 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400/80">
          {title}
        </p>
      </header>
      <ul className="max-h-[min(75vh,640px)] overflow-y-auto py-1.5">
        {items.map((item) => (
          <li key={item.key}>
            <div
              className={`main-menu-row group flex items-center gap-2 px-2 py-1 ${
                item.isActive ? "main-menu-row-active" : ""
              }`}
            >
              <Link
                href={item.href}
                onClick={onClose}
                className={`flex flex-1 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition ${
                  item.isActive
                    ? "bg-sky-500/15 text-sky-100"
                    : "text-slate-300 hover:bg-slate-800/70 hover:text-slate-100"
                }`}
              >
                <span
                  aria-hidden
                  className={`inline-flex h-5 w-5 items-center justify-center text-slate-400 ${
                    item.isActive ? "text-sky-300" : "group-hover:text-slate-200"
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
      <style jsx>{`
        .main-menu-pin-toggle {
          position: relative;
          display: inline-flex;
          align-items: center;
          width: 28px;
          height: 16px;
          margin-inline-end: 6px;
          border-radius: 999px;
          border: 1px solid rgba(100, 116, 139, 0.45);
          background: rgba(15, 23, 42, 0.9);
          transition:
            background 150ms ease,
            border-color 150ms ease,
            box-shadow 150ms ease;
          cursor: pointer;
          flex-shrink: 0;
        }
        .main-menu-pin-toggle:focus-visible {
          outline: none;
          box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.45);
        }
        .main-menu-pin-on {
          background: rgba(56, 189, 248, 0.28);
          border-color: rgba(56, 189, 248, 0.65);
          box-shadow: 0 0 10px rgba(56, 189, 248, 0.35);
        }
        .main-menu-pin-off:hover {
          border-color: rgba(148, 163, 184, 0.7);
        }
        :global(.main-menu-pin-knob) {
          position: absolute;
          top: 1px;
          inset-inline-start: 1px;
          width: 12px;
          height: 12px;
          border-radius: 999px;
          background: rgba(226, 232, 240, 0.9);
          transition: transform 150ms ease;
        }
        .main-menu-pin-on :global(.main-menu-pin-knob) {
          transform: translateX(12px);
          background: #e0f2fe;
          box-shadow: 0 0 6px rgba(56, 189, 248, 0.55);
        }
        [dir="rtl"] .main-menu-pin-on :global(.main-menu-pin-knob) {
          transform: translateX(-12px);
        }
      `}</style>
    </div>
  );

  return createPortal(node, document.body);
}
