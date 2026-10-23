"use client";

import { useRef, useState } from "react";

/**
 * CONTROL ROOM — the map's TITLE is also its region selector (owner 2026-10-19): the place on screen ("All Israel" / a region) sits top-left of the map; resting on it
 * (or clicking it) opens the list of every region with its branch count — pick one and the title ROLLS: the old name slides up and away, the new one rises from below.
 * A small ✕ next to a focused region goes straight back to the whole country.
 */
export type RegionOption = { id: string | null; label: string; count: number };

export function RegionTitle({ options, value, onPick, hint }: { options: RegionOption[]; value: string | null; onPick: (id: string | null) => void; hint?: string }) {
  const label = options.find((o) => o.id === value)?.label ?? options[0]?.label ?? "";
  // the rolling title: remember the previous label while the new one rises (previous-render pattern — no effect)
  const [last, setLast] = useState(label);
  const [prev, setPrev] = useState<string | null>(null);
  if (label !== last) {
    setPrev(last);
    setLast(label);
  }
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openNow = () => { if (timer.current) clearTimeout(timer.current); setOpen(true); };
  const closeSoon = () => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(false), 160); };
  const focused = value !== null;
  return (
    <div className="cr-region" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false); }}>
      <div className="flex items-center gap-1.5">
        {/* only the TITLE opens the list (rest on it / click it) — the ✕ beside it never does */}
        <button type="button" className="cr-region-btn" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((v) => !v)} onPointerEnter={openNow} onPointerLeave={closeSoon} onFocus={openNow} title={hint}>
          <span className="cr-roll" aria-live="polite">
            {prev !== null ? <span key={`out-${prev}-${label}`} className="cr-roll-out" aria-hidden>{prev}</span> : null}
            <span key={`in-${label}`} className={prev !== null ? "cr-roll-in" : undefined}>{label}</span>
          </span>
        </button>
        {focused ? (
          <button type="button" className="cr-region-x" onPointerEnter={() => { if (timer.current) clearTimeout(timer.current); setOpen(false); }} onClick={() => { onPick(null); setOpen(false); }} aria-label="×" title="×">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        ) : null}
      </div>
      <div className={`cr-region-menu ${open ? "is-open" : ""}`} role="listbox" aria-hidden={!open} onPointerEnter={openNow} onPointerLeave={closeSoon}>
        <div className="cr-region-menu-in">
          {options.map((o) => (
            <button key={o.id ?? "all"} type="button" role="option" aria-selected={o.id === value} tabIndex={open ? 0 : -1} className={`cr-region-opt ${o.id === value ? "is-on" : ""}`} onClick={() => { onPick(o.id); setOpen(false); }}>
              <span dir="auto">{o.label}</span>
              <span className="tabular-nums">{o.count}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
