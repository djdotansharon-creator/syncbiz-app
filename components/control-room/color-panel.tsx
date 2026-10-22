"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { BRAND_PALETTE, DEFAULT_BRAND_COLOR, type BrandRow } from "@/components/control-room/brand-manager";
import { useTr } from "@/lib/i18n/use-tr";

/**
 * CONTROL ROOM — COLOURS (owner 2026-10-19: "let's make colour-setting possible, and make it nice").
 *  - the DISPLAY mode (a per-viewer preference, remembered in this browser): "Brand colours" (dots on the map, logo tiles and chips carry the brand's colour)
 *    or "Calm" (everything neutral — only the status LED keeps a colour);
 *  - every brand's colour, changed right here: click a brand → a palette (12 swatches + any colour) → saved at once (the same brand colour as in Brands).
 */

export type ColorMode = "brand" | "calm";
const KEY = "vono.controlRoom.colors";
const EVENT = "vono:cr-colors";

function readMode(): ColorMode {
  try {
    return window.localStorage.getItem(KEY) === "calm" ? "calm" : "brand";
  } catch {
    return "brand";
  }
}
export function useColorMode(): [ColorMode, (m: ColorMode) => void] {
  const mode = useSyncExternalStore(
    (cb) => {
      window.addEventListener(EVENT, cb);
      window.addEventListener("storage", cb);
      return () => { window.removeEventListener(EVENT, cb); window.removeEventListener("storage", cb); };
    },
    readMode,
    () => "brand" as ColorMode,
  );
  const set = (m: ColorMode) => {
    try { window.localStorage.setItem(KEY, m); } catch { /* not remembered */ }
    window.dispatchEvent(new Event(EVENT));
  };
  return [mode, set];
}

export function ColorPanel({ brands, mode, onMode, onChanged, onClose }: { brands: BrandRow[]; mode: ColorMode; onMode: (m: ColorMode) => void; onChanged: () => void; onClose: () => void }) {
  const tr = useTr();
  const [open, setOpen] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  // Esc / a click outside closes it
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const onDown = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as Element).closest?.("[data-cr-colors-btn]")) onClose(); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("pointerdown", onDown); };
  }, [onClose]);

  const setColor = async (b: BrandRow, color: string) => {
    setSaving(b.id);
    setError(null);
    try {
      const res = await fetch(`/api/control-room/brands/${encodeURIComponent(b.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: b.name, code: b.code, color }) });
      if (!res.ok) { const d = (await res.json().catch(() => ({}))) as { error?: string }; setError(d.error ?? `HTTP ${res.status}`); return; }
      onChanged();
    } catch {
      setError(tr("Could not reach the server."));
    } finally {
      setSaving(null);
    }
  };

  return (
    <div ref={ref} className="cr-colors" role="dialog" aria-label={tr("Colours")}>
      <div className="cr-colors-head">
        <span>{tr("Colours")}</span>
        <button type="button" onClick={onClose} className="cr-colors-x" aria-label={tr("Close")}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>
      <div className="cr-seg" role="radiogroup" aria-label={tr("Display colours")}>
        <button type="button" role="radio" aria-checked={mode === "brand"} className={mode === "brand" ? "is-on" : ""} onClick={() => onMode("brand")}>{tr("Brand colours")}</button>
        <button type="button" role="radio" aria-checked={mode === "calm"} className={mode === "calm" ? "is-on" : ""} onClick={() => onMode("calm")}>{tr("Calm")}</button>
      </div>
      <div className={`cr-colors-list ${mode === "calm" ? "is-dim" : ""}`}>
        {brands.map((b) => {
          const c = b.color ?? DEFAULT_BRAND_COLOR;
          const isOpen = open === b.id;
          return (
            <div key={b.id} className="cr-colors-row">
              <button type="button" className="cr-colors-brand" onClick={() => setOpen(isOpen ? null : b.id)} aria-expanded={isOpen}>
                <span className="cr-colors-dot" style={{ background: c }} aria-hidden />
                <span className="cr-colors-name" dir="auto">{b.name}</span>
                <span className="cr-colors-hex" dir="ltr">{c.toUpperCase()}</span>
              </button>
              {isOpen ? (
                <div className="cr-swatches" aria-busy={saving === b.id}>
                  {BRAND_PALETTE.map((p) => (
                    <button key={p} type="button" disabled={saving === b.id} onClick={() => void setColor(b, p)} className={`cr-swatch ${c.toLowerCase() === p ? "is-on" : ""}`} style={{ background: p }} aria-label={p} />
                  ))}
                  <label className="cr-swatch cr-swatch--custom" title="Any colour">
                    <span aria-hidden>+</span>
                    <input type="color" value={c} disabled={saving === b.id} onChange={(e) => void setColor(b, e.target.value)} className="sr-only" />
                  </label>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {error ? <p className="cr-colors-err">{error}</p> : null}
    </div>
  );
}
