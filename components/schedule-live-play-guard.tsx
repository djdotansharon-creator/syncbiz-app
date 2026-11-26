"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useTr } from "@/lib/i18n/use-tr";
import { answerLivePlayQuestion, usePendingLivePlay } from "@/lib/schedule-live-play";
import "./schedule-live-play-guard.css";

/**
 * "A schedule is playing - play this anyway?" (owner 2026-11-25). Shown when somebody starts a song / playlist by hand while a schedule block is playing music (lib/schedule-live-play.ts).
 * "No" changes nothing; "Yes, play it" plays it and the block stops asking until the next block takes over. No card (owner 2026-11-26): the screen blurs, centred text, two buttons side by side (blue and white).
 * Renders nothing while there is no question.
 */
export function ScheduleLivePlayGuard() {
  const tr = useTr();
  const q = usePendingLivePlay();
  const noRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!q) return;
    noRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") answerLivePlayQuestion(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [q]);

  if (!q || typeof document === "undefined") return null;
  const { name, endTime } = q.block;
  return createPortal(
    <div className="vono-lp" role="presentation" data-live-play-guard onPointerDown={(e) => e.target === e.currentTarget && answerLivePlayQuestion(false)}>
      <div className="vono-lp-body" role="alertdialog" aria-modal="true" aria-labelledby="vono-lp-h" aria-describedby="vono-lp-p">
        <h2 id="vono-lp-h" className="vono-lp-h">{tr("A schedule is active")}</h2>
        <p id="vono-lp-p" className="vono-lp-p">
          {name
            ? endTime
              ? tr("“{name}” is playing now, until {t}. Play this anyway?", { name, t: endTime })
              : tr("“{name}” is playing now. Play this anyway?", { name })
            : endTime
              ? tr("The schedule is playing now, until {t}. Play this anyway?", { t: endTime })
              : tr("The schedule is playing now. Play this anyway?")}
        </p>
        <div className="vono-lp-actions">
          <button ref={noRef} type="button" className="vono-lp-btn vono-lp-no" data-live-play-no onClick={() => answerLivePlayQuestion(false)}>{tr("No")}</button>
          <button type="button" className="vono-lp-btn vono-lp-yes" data-live-play-yes onClick={() => answerLivePlayQuestion(true)}>{tr("Yes, play it")}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
