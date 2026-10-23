"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { CrDensity } from "@/lib/use-cr-density";
import type { Mgmt } from "@/lib/i18n/management";

/**
 * Control Room — "List size": ONE quiet icon (a big square with a small one beside it) that opens a three-line menu: Large · Medium · Small
 * (owner 2026-10-20: no "how many per row" text — just the three words). Behind the words: 2 / 3 / 5 branches per row. Styles: `.cr-density*` in globals.css.
 */

export function DensityMenu({ L, value, onChange }: { L: Mgmt; value: CrDensity; onChange: (d: CrDensity) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const [moved, setMoved] = useState(false); // the bubble plays only when the choice CHANGES (not when the menu opens)
  const order: CrDensity[] = ["l", "m", "s"];
  // the menu stays open after a choice (owner 2026-10-21): it closes only on a click outside it, on Escape, or on the icon itself
  const choose = (d: CrDensity) => {
    if (d !== value) setMoved(true);
    onChange(d);
  };
  return (
    <div ref={rootRef} className="cr-density">
      <button type="button" className={`cr-density-btn ${open ? "is-on" : ""}`} aria-haspopup="menu" aria-expanded={open} aria-label={L.t("cr.density")} title={L.t("cr.density")} onClick={() => setOpen((v) => !v)}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" aria-hidden>
          <rect x="2.8" y="4.8" width="12" height="12" rx="2.6" /><rect x="17.6" y="11.6" width="4.4" height="4.4" rx="1.3" />
        </svg>
      </button>
      {open ? (
        <div className="cr-density-menu" role="menu" aria-label={L.t("cr.density")}>
          {/* the chosen-option square rides a one-row slot that slides on the compositor; the square itself re-mounts per choice so its "bubble" stretch plays every time —
              the same motion as the display-mode circle in the gear menu (.sb-mode-sel-slot / sb-mode-bubble) */}
          <span className="cr-density-slot" aria-hidden style={{ "--i": Math.max(0, order.indexOf(value)) } as CSSProperties}>
            <span key={value} className={`cr-density-pill${moved ? " is-bubble" : ""}`} />
          </span>
          {order.map((d) => (
            <button key={d} type="button" role="menuitemradio" aria-checked={value === d} className={`cr-density-opt ${value === d ? "is-on" : ""}`} onClick={() => choose(d)}>
              <span>{L.t(`cr.density.${d}` as const)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
