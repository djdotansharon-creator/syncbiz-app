"use client";

/**
 * VxSelect (VONO design language, owner 2026-10-13) — a dark, frameless replacement for the native <select>, whose
 * Windows popup renders white. UI ONLY: the caller keeps the exact same values + onChange logic.
 *
 * Accessibility = the WAI-ARIA "select-only combobox" pattern: a button (role=combobox, aria-expanded, aria-controls,
 * aria-activedescendant) + a role=listbox popup with role=option items (aria-selected). Keyboard: ↓/↑/Enter/Space/
 * Alt+↓ open; ↓/↑/Home/End/PageUp/PageDown move; Enter/Space choose; Escape closes; Tab chooses-and-leaves (native
 * behaviour); typing letters jumps to a matching option. The popup is portalled + position:fixed so scrolling panels
 * never clip it; it closes on outside scroll / resize. No shadow / glow / gradient, minimal radius.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

export type VxOption<V extends string = string> = { value: V; label: string };

export function VxSelect<V extends string = string>({
  value,
  options,
  onChange,
  label,
  labelledBy,
  placeholder,
  className = "",
  size = "md",
  disabled,
}: {
  value: V;
  options: readonly VxOption<V>[];
  onChange: (value: V) => void;
  /** accessible name when there is no visible label element (prefer `labelledBy` when there is one) */
  label?: string;
  labelledBy?: string;
  /** shown (muted) when `value` matches no option, e.g. "" = "Choose…" */
  placeholder?: string;
  className?: string;
  /** md = 44px (management fields) · sm = 40px (the Studio settings row) */
  size?: "sm" | "md";
  disabled?: boolean;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState<{ left: number; right: number; top: number; width: number; maxH: number; up: boolean; rtl: boolean } | null>(null);
  const typed = useRef({ text: "", at: 0 });

  const selectedIdx = options.findIndex((o) => o.value === value);
  const current = selectedIdx >= 0 ? options[selectedIdx] : null;

  const place = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const b = el.getBoundingClientRect();
    const rtl = getComputedStyle(el).direction === "rtl";
    const below = window.innerHeight - b.bottom - 8;
    const above = b.top - 8;
    const up = below < 180 && above > below;
    const GAP = 6; // the menu floats a little away from the field (Apple-style)
    setPos({ left: b.left, right: window.innerWidth - b.right, rtl, top: up ? b.top - GAP : b.bottom + GAP, width: b.width, maxH: Math.max(120, Math.min(320, (up ? above : below) - GAP)), up });
  }, []);

  const openList = useCallback((at?: number) => {
    if (disabled || options.length === 0) return;
    place();
    setActive(at ?? (selectedIdx >= 0 ? selectedIdx : 0));
    setOpen(true);
  }, [disabled, options.length, place, selectedIdx]);

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) btnRef.current?.focus();
  }, []);

  const choose = useCallback((i: number, refocus = true) => {
    const o = options[i];
    if (o && o.value !== value) onChange(o.value);
    close(refocus);
  }, [close, onChange, options, value]);

  // keep the active option visible
  useLayoutEffect(() => {
    if (!open || active < 0) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  // outside click / outside scroll / resize → close (the popup is fixed-positioned)
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || listRef.current?.contains(t)) return;
      close(false);
    };
    const onScroll = (e: Event) => { if (!listRef.current?.contains(e.target as Node)) close(false); };
    const onResize = () => close(false);
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, close]);

  const typeahead = (ch: string) => {
    const now = Date.now();
    const t = typed.current;
    t.text = now - t.at > 700 ? ch : t.text + ch;
    t.at = now;
    const q = t.text.toLowerCase();
    const from = open ? active : selectedIdx;
    for (let k = 1; k <= options.length; k++) {
      const i = (Math.max(from, 0) + (t.text.length > 1 ? k - 1 : k)) % options.length;
      if (options[i].label.toLowerCase().startsWith(q)) return i;
    }
    return -1;
  };

  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const last = options.length - 1;
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") { e.preventDefault(); openList(); return; }
      if (e.key === "Home") { e.preventDefault(); openList(0); return; }
      if (e.key === "End") { e.preventDefault(); openList(last); return; }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { const i = typeahead(e.key); if (i >= 0) openList(i); }
      return;
    }
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); if (e.altKey) choose(active); else setActive((a) => Math.min(last, a + 1)); return;
      case "ArrowUp": e.preventDefault(); if (e.altKey) choose(active); else setActive((a) => Math.max(0, a - 1)); return;
      case "Home": e.preventDefault(); setActive(0); return;
      case "End": e.preventDefault(); setActive(last); return;
      case "PageDown": e.preventDefault(); setActive((a) => Math.min(last, a + 10)); return;
      case "PageUp": e.preventDefault(); setActive((a) => Math.max(0, a - 10)); return;
      case "Enter": case " ": e.preventDefault(); choose(active); return;
      case "Escape": e.preventDefault(); close(true); return;
      case "Tab": choose(active, false); return;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { const i = typeahead(e.key); if (i >= 0) setActive(i); }
    }
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && active >= 0 ? `${id}-o${active}` : undefined}
        aria-label={labelledBy ? undefined : label}
        aria-labelledby={labelledBy}
        disabled={disabled}
        onClick={() => (open ? close(true) : openList())}
        onKeyDown={onKey}
        className={`vx-select vx-select--${size} ${open ? "is-open" : ""} ${className}`}
      >
        <span className={`vx-select-value ${current ? "" : "is-placeholder"}`}>{current ? current.label : placeholder ?? ""}</span>
        <svg className="vx-select-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && pos && typeof document !== "undefined"
        ? createPortal(
            <ul
              ref={listRef}
              id={listId}
              role="listbox"
              aria-labelledby={labelledBy}
              aria-label={labelledBy ? undefined : label}
              tabIndex={-1}
              className="vx-select-list"
              dir={pos.rtl ? "rtl" : "ltr"}
              style={{
                // RTL: the list grows from the button's right edge
                ...(pos.rtl ? { right: pos.right } : { left: pos.left }),
                width: Math.max(pos.width, 160),
                maxHeight: pos.maxH,
                ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }),
              }}
              // never steal focus from the combobox button
              onMouseDown={(e) => e.preventDefault()}
            >
              {options.map((o, i) => (
                <li
                  key={o.value === "" ? "__empty" : o.value}
                  id={`${id}-o${i}`}
                  data-i={i}
                  role="option"
                  aria-selected={o.value === value}
                  className={`vx-select-option ${i === active ? "is-active" : ""} ${o.value === value ? "is-selected" : ""}`}
                  onMouseMove={() => { if (i !== active) setActive(i); }}
                  onClick={() => choose(i)}
                >
                  <svg className="vx-select-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6 9 17l-5-5" /></svg>
                  <span className="min-w-0 truncate">{o.label}</span>
                </li>
              ))}
            </ul>,
            document.body,
          )
        : null}
    </>
  );
}
