"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useTr } from "@/lib/i18n/use-tr";
import { answerVolumeQuestion, usePendingVolumeQuestion } from "@/lib/schedule-volume";
import "./schedule-volume-guard.css";

/**
 * "This time has its own volume" (owner 2026-11-17: "if it is set and I come to raise it, a window asks whether to break the setting"). Shown when somebody raises the player's volume above the
 * setting of the schedule block in force (lib/schedule-volume.ts). "Keep" leaves the volume alone; "Raise" applies the change and the block stops asking until the next block takes over.
 * Renders nothing while there is no question.
 */
export function ScheduleVolumeGuard() {
  const tr = useTr();
  const q = usePendingVolumeQuestion();
  const keepRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!q) return;
    keepRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") answerVolumeQuestion(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [q]);

  if (!q || typeof document === "undefined") return null;
  const set = q.lock.volume;
  const want = Math.round(q.value);
  return createPortal(
    <div className="vono-vg" role="presentation" onPointerDown={(e) => e.target === e.currentTarget && answerVolumeQuestion(false)}>
      <div className="vono-vg-card" role="alertdialog" aria-modal="true" aria-labelledby="vono-vg-h" aria-describedby="vono-vg-p">
        <div className="vono-vg-meter" aria-hidden>
          <span className="vono-vg-set" style={{ width: `${set}%` }} />
          <span className="vono-vg-want" style={{ left: `${Math.min(100, want)}%` }} />
        </div>
        <h2 id="vono-vg-h" className="vono-vg-h">{tr("This time has its own volume")}</h2>
        <p id="vono-vg-p" className="vono-vg-p">
          {q.lock.name
            ? tr("“{name}” is set to {n}%. Raise it to {v}% anyway?", { name: q.lock.name, n: set, v: want })
            : tr("The schedule set the volume to {n}% for now. Raise it to {v}% anyway?", { n: set, v: want })}
        </p>
        <div className="vono-vg-actions">
          <button ref={keepRef} type="button" className="vono-vg-keep" onClick={() => answerVolumeQuestion(false)}>{tr("Keep {n}%", { n: set })}</button>
          <button type="button" className="vono-vg-raise" onClick={() => answerVolumeQuestion(true)}>{tr("Raise to {v}%", { v: want })}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
