"use client";

/**
 * MANAGEMENT VISUAL PRIMITIVES (VONO design language, owner 2026-10-12): Flat Swiss-style management UI — hairline
 * dividers, zero radius, strong typography, an active-state underline indicator. These are the Control Room building
 * blocks MOVED here unchanged (same markup / classes → no visual change) so Jingles / Access Control / Dashboard reuse
 * them. Visual only: no business logic, no data access. The CSS tokens + .vx-* classes live in app/globals.css.
 */
import { DOT_FILL, StatusGlyph, type MapDotStatus } from "@/components/control-room/branch-map";
import type { Mgmt } from "@/lib/i18n/management";

/** a region chip — one compact row (all regions fit), LED bar under the chosen one; the count lives on the map */
export function RegionChip({ label, active, onClick, title }: { label: string; active: boolean; onClick: () => void; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={`relative flex-auto whitespace-nowrap px-1.5 py-2.5 text-[12px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--sb-accent)] ${
        active ? "bg-white/[0.06] font-semibold text-[var(--sb-text)]" : "font-medium text-[var(--sb-text-secondary)] hover:bg-white/[0.03] hover:text-[var(--sb-text)]"
      }`}
    >
      {label}
      <span className={`absolute inset-x-1 bottom-0 h-[3px] rounded-full bg-[var(--sb-accent)] transition-opacity ${active ? "opacity-100" : "opacity-0"}`} aria-hidden />
    </button>
  );
}

/** a filter tab (brands / regions) — the same language as the KPI cards: big, clear, a bar under the chosen one */
/**
 * a brand filter tab (owner 2026-10-15): the brand colour is a permanent strip on TOP, the logo (or a colour dot) is
 * centred, the name sits under it, then the branch count. Selected = a lifted surface + a white bar at the bottom.
 */
export function FilterTab({ label, count, active, onClick, dot, bar, logo }: { label: string; count: number; active: boolean; onClick: () => void; dot?: string | null; bar?: string; /** brand logo (replaces the dot) */ logo?: string | null }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`relative flex flex-auto flex-col items-center justify-center gap-1 px-4 pb-2.5 pt-3.5 text-center transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--sb-accent)] ${
        active ? "bg-white/[0.06]" : "hover:bg-white/[0.03]"
      }`}
    >
      <span className="absolute inset-x-0 top-0 h-[3px]" style={{ background: bar ?? "rgba(255,255,255,0.18)" }} aria-hidden />
      <span className="flex h-8 items-center justify-center">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt="" aria-hidden className="h-8 w-auto max-w-[96px] object-contain" draggable={false} />
        ) : dot ? (
          <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ background: dot }} aria-hidden />
        ) : null}
      </span>
      <span className={`whitespace-nowrap text-sm ${active ? "font-semibold text-[var(--sb-text)]" : "font-medium text-[var(--sb-text-secondary)]"}`} dir="auto">{label}</span>
      <span className="text-xs tabular-nums text-[var(--sb-text-tertiary)]" dir="ltr">{count}</span>
      <span className={`absolute inset-x-3 bottom-0 h-[2px] rounded-full bg-[#f5f5f7] transition-opacity ${active ? "opacity-100" : "opacity-0"}`} aria-hidden />
    </button>
  );
}

/** a KPI counter that is also a status filter (pressed = the active filter; a bar in the status color marks it) */
export function Stat({ L, value, label, status, last, valueColor, active, onClick, disabled }: { L: Mgmt; value: number | string; label: string; status?: MapDotStatus; last?: boolean; valueColor?: string; active: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      title={active && status ? L.t("cr.kpiShowingOnly", { label }) : L.t("cr.kpiShow", { label })}
      className={`relative px-6 py-3.5 text-start transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--sb-accent)] disabled:cursor-default ${
        last ? "" : "border-e border-[color:var(--sb-border)]"
      } ${active ? "bg-white/[0.05]" : "hover:bg-white/[0.025]"}`}
    >
      <div className="text-[34px] font-bold leading-none tracking-tight tabular-nums text-[var(--sb-text)]" dir="ltr" style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </div>
      <div className={`mt-2 flex items-center gap-2 text-base ${active ? "font-semibold text-[var(--sb-text)]" : "text-[var(--sb-text-secondary)]"}`}>
        {status ? <StatusGlyph status={status} size={13} /> : null}
        {label}
      </div>
      <span className={`absolute inset-x-0 bottom-0 h-[3px] transition-opacity ${active ? "opacity-100" : "opacity-0"}`} style={{ background: status ? DOT_FILL[status] : "#f5f5f7" }} aria-hidden />
    </button>
  );
}
