import type { QuotaCheck } from "@/lib/admin/platform-quotas";

const okRing = "bg-emerald-500/10 text-emerald-300 ring-emerald-500/35";
const overRing = "bg-rose-500/15 text-rose-200 ring-rose-500/40";
const naRing = "bg-neutral-500/10 text-neutral-500 ring-neutral-600/40";

/**
 * One row: compact B/D/U/P pills for the platform workspaces table.
 */
export function PlatformQuotaRowBadges({ checks }: { checks: QuotaCheck[] }) {
  if (checks.length === 0) {
    return <span className="text-[11px] text-neutral-500">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {checks.map((c) => {
        const title = `${c.label}: ${c.current} / ${c.max} max${c.over ? " · over limit" : ""}`;
        return (
          <span
            key={c.key}
            title={title}
            className={`inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10px] font-medium ring-1 ring-inset ${
              c.over ? overRing : okRing
            }`}
          >
            {c.short} {c.current}/{c.max}
          </span>
        );
      })}
    </div>
  );
}

/**
 * Status word for a quick column: "OK" vs "Over limit" vs n/a.
 */
export function PlatformQuotaStatusPill({ anyOver, hasEntitlement }: { anyOver: boolean; hasEntitlement: boolean }) {
  if (!hasEntitlement) {
    return (
      <span
        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${naRing}`}
        title="No entitlement row — run backfill"
      >
        n/a
      </span>
    );
  }
  if (anyOver) {
    return (
      <span
        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${overRing}`}
      >
        Over limit
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${okRing}`}
    >
      OK
    </span>
  );
}

type DetailProps = {
  checks: QuotaCheck[];
  hasEntitlement: boolean;
  anyOver: boolean;
};

/**
 * Drill-down: full comparison list with OK / Over per dimension.
 */
export function PlatformQuotaDetailsSection({ checks, hasEntitlement, anyOver }: DetailProps) {
  if (!hasEntitlement) {
    return null;
  }
  return (
    <section className="rounded-md border border-neutral-800 bg-neutral-900/40 p-4 text-sm">
      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Resource usage vs limits
        </h2>
        {anyOver ? (
          <p className="text-[11px] text-amber-300/90">
            Over pilot limits in one or more areas. Enforcement is not active — visibility only.
          </p>
        ) : (
          <p className="text-[11px] text-neutral-500">All dimensions within current pilot limits.</p>
        )}
      </div>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {checks.map((c) => (
          <li
            key={c.key}
            className={
              "flex items-center justify-between gap-3 rounded border px-3 py-2 " +
              (c.over
                ? "border-rose-500/30 bg-rose-950/25"
                : "border-neutral-800 bg-neutral-950/40")
            }
          >
            <span className="text-neutral-300">{c.label}</span>
            <span className="flex items-center gap-2 tabular-nums">
              <span className="font-mono text-[13px] text-neutral-200">
                {c.current} / {c.max}
              </span>
              <span
                className={
                  "inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset " +
                  (c.over ? overRing : okRing)
                }
              >
                {c.over ? "Over limit" : "OK"}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
