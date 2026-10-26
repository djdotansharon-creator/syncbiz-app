"use client";

/**
 * MANAGEMENT VISUAL PRIMITIVES (VONO design language, owner 2026-10-12): Flat Swiss-style management UI — hairline
 * dividers, zero radius, strong typography, an active-state underline indicator. These are the Control Room building
 * blocks MOVED here unchanged (same markup / classes → no visual change) so Jingles / Access Control / Dashboard reuse
 * them. Visual only: no business logic, no data access. The CSS tokens + .vx-* classes live in app/globals.css.
 */
import { StatusGlyph, type MapDotStatus } from "@/components/control-room/branch-map";
import { useLogoFit } from "@/components/control-room/logo-fit";
import type { Mgmt } from "@/lib/i18n/management";

/** a region chip — a soft pill in one wrapping row; the chosen one is a lighter glass pill (no bars, no frames) */
export function RegionChip({ label, active, onClick, title }: { label: string; active: boolean; onClick: () => void; title?: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} title={title} className={`cr-chip whitespace-nowrap px-3 py-1.5 text-[12.5px] ${active ? "is-active font-semibold" : "font-medium"}`}>
      {label}
    </button>
  );
}

/**
 * a brand filter chip. A brand WITH a logo is just its logo — WITH its own background, the chip's frame takes the logo's shape (owner 2026-10-20; the squares stay in the list rows).
 * A brand without one: a small letter tile + its name. Several chips can be chosen at once — a chosen one carries a ✓ (what has a ✓ is what is shown).
 */
export function FilterTab({ label, active, onClick, dot, bar, logo, check }: { label: string; active: boolean; onClick: () => void; dot?: string | null; bar?: string; /** brand logo */ logo?: string | null; /** show the ✓ (the brand is one of the chosen) */ check?: boolean }) {
  const letter = (label.trim().split(/\s+/).pop() ?? "").charAt(0).toUpperCase();
  const fit = useLogoFit(logo ?? null);
  // the "All" chip (no logo, no colour): a text tile of the SAME height and look as the logo chips, so the strip reads as one family
  if (!logo && !dot) {
    return (
      <button type="button" onClick={onClick} aria-pressed={active} aria-label={label} title={label} className={`cr-chip cr-chip--logo flex shrink-0 items-center ${active ? "is-active" : ""}`}>
        <span className="cr-chip-logo-box is-text" aria-hidden>{label}</span>
        <span className="cr-chip-bar" aria-hidden />
      </button>
    );
  }
  if (logo && fit !== null) {
    const w = fit ? Math.max(40, Math.min(136, Math.round(40 * fit.aspect))) : 64;
    return (
      <button type="button" onClick={onClick} aria-pressed={active} aria-label={label} title={label} className={`cr-chip cr-chip--logo flex shrink-0 items-center ${active ? "is-active" : ""}`}>
        <span className={`cr-chip-logo-box${fit?.bleed ? " is-bleed" : ""}`} style={{ width: w, ...(fit ? { background: fit.bg } : {}) }} aria-hidden>
          {fit ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={fit.src} alt="" draggable={false} />
          ) : null}
        </span>
        <CheckBadge on={!!check} />
        <span className="cr-chip-bar" aria-hidden />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={label}
      style={active && bar ? ({ ["--cr-chip-ring" as string]: bar } as React.CSSProperties) : undefined}
      className={`cr-chip cr-chip--brand flex shrink-0 items-center gap-2.5 py-1.5 pe-4 ps-1.5 ${active ? "is-active" : ""}`}
    >
      {logo || dot ? (
        <span className={`cr-chip-logo ${logo ? "has-logo" : ""}${fit ? " has-fit" : ""}${fit?.bleed ? " is-bleed" : ""}`} style={{ ...(dot ? { ["--cr-brand" as string]: dot } : {}), ...(fit ? { background: fit.bg } : {}) } as React.CSSProperties} aria-hidden>
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={fit?.src ?? logo} alt="" draggable={false} />
          ) : (
            <span>{letter}</span>
          )}
        </span>
      ) : null}
      <CheckBadge inline on={!!check} />
      <span className={`whitespace-nowrap text-sm ${active ? "font-semibold" : "font-medium"}`} dir="auto">{label}</span>
    </button>
  );
}

/** the ✓ of a chosen brand — always in the DOM, so it can animate BOTH ways: it pops in with an overshoot and, when the brand is un-chosen, shrinks and fades out (CSS transition on `.is-on`) */
function CheckBadge({ inline = false, on }: { inline?: boolean; on: boolean }) {
  return (
    <span className={`cr-chip-check${inline ? " is-inline" : ""}${on ? " is-on" : ""}`} aria-hidden>
      <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="m3.5 8.4 3 3 6-6.8" /></svg>
    </span>
  );
}

/**
 * a KPI counter that is also a status filter — a flat TAB (owner 2026-10-20: no frame, no box): the title ABOVE the number, the chosen one gets an
 * underline, hover = a faint rounded wash. The status colour is the glyph beside the title.
 */
export function Stat({ L, value, label, status, valueColor, active, onClick, disabled }: { L: Mgmt; value: number | string; label: string; status?: MapDotStatus; last?: boolean; valueColor?: string; active?: boolean; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      title={active && status ? L.t("cr.kpiShowingOnly", { label }) : L.t("cr.kpiShow", { label })}
      className={`cr-stat text-start ${active ? "is-active" : ""}`}
    >
      <span className="cr-stat-label">
        {status ? <StatusGlyph status={status} size={12} /> : null}
        {label}
      </span>
      <span className="cr-stat-value" dir="ltr" style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </span>
      <span className="cr-stat-bar" aria-hidden />
    </button>
  );
}
