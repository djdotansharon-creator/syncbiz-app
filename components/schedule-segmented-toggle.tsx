"use client";

/**
 * Segmented control matching Settings → Remote player (MASTER/CONTROL) and LANGUAGE EN/HE:
 * rounded shell, two caps, LED + uppercase label on the active side.
 */
export function ScheduleSegmentedToggle({
  value,
  onChange,
  leftLabel,
  rightLabel,
  ariaLabel,
  size = "md",
}: {
  /** true = right segment active (green); false = left active (red). */
  value: boolean;
  onChange: (next: boolean) => void;
  leftLabel: string;
  rightLabel: string;
  ariaLabel: string;
  size?: "sm" | "md";
}) {
  const pad = size === "sm" ? "px-3 py-1.5 text-[10px]" : "px-4 py-2 text-xs";
  const inactive =
    "inline-flex items-center gap-2 rounded-md border border-transparent bg-transparent text-xs font-semibold tracking-wide text-slate-500 transition-all hover:bg-slate-800/80 hover:text-slate-300";
  const ledOff = "h-1.5 w-1.5 shrink-0 rounded-full bg-slate-500";
  const ledRed =
    "h-1.5 w-1.5 shrink-0 rounded-full bg-red-400 shadow-[0_0_10px_rgba(248,113,113,0.85)]";
  const ledGreen =
    "h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.85)]";

  const activeLeft = `${pad} inline-flex items-center gap-2 rounded-md border border-red-500/60 bg-red-600/25 font-semibold tracking-wide text-red-200 shadow-[0_0_12px_rgba(239,68,68,0.2)] transition-all`;
  const activeRight = `${pad} inline-flex items-center gap-2 rounded-md border border-emerald-500/55 bg-emerald-600/20 font-semibold tracking-wide text-emerald-200 shadow-[0_0_12px_rgba(16,185,129,0.18)] transition-all`;

  return (
    <div
      className="inline-flex rounded-lg border border-slate-700/80 bg-slate-900/60 p-0.5"
      role="group"
      aria-label={ariaLabel}
    >
      <button
        type="button"
        aria-pressed={!value}
        onClick={() => onChange(false)}
        className={!value ? activeLeft : `${inactive} ${pad}`}
      >
        <span className={!value ? ledRed : ledOff} />
        {leftLabel}
      </button>
      <button
        type="button"
        aria-pressed={value}
        onClick={() => onChange(true)}
        className={value ? activeRight : `${inactive} ${pad}`}
      >
        <span className={value ? ledGreen : ledOff} />
        {rightLabel}
      </button>
    </div>
  );
}
