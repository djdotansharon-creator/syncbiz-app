"use client";

/** The on / off switch of the Permissions screens — a pill with a knob (the same look as the Control Room's switches). */
export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} className="sb-tg" data-on={on ? "1" : "0"}>
      <span className="sb-tg-knob" />
    </button>
  );
}
