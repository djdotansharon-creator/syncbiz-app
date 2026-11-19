"use client";

/**
 * NewPlaylistPop — the small "name your playlist" window (owner 2026-10-18). A frosted glass card (same glass as the
 * other dialogs) with one frameless name field and a grey check at its right. Tap the check (or press Enter) and the
 * check turns green with a Face-ID-style stroke animation (ring draws, then the tick), the window glides away and
 * the playlist simply appears. Styles: `.sb-npl-*` in globals.css (block bv).
 *
 * DJ AI or by hand (owner 2026-11-19: "when you create a new playlist there should be a choice — DJ AI, or create it yourself"): when the opener passes `onDjAi`, the window first
 * shows the two ways; "DJ AI" hands over to the DJ Creator assistant, "Create it yourself" is the name field below. Without `onDjAi` (e.g. adding a song to a new playlist) it is the name field only.
 *
 * `onCreate` resolves true when the playlist exists. The animation starts at once (feels instant); the window waits
 * for BOTH the animation and the save, and if the save fails the check resets with a short message.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTr } from "@/lib/i18n/use-tr";
import { DjCreatorAiWarmSpark } from "@/components/dj-creator-ai-mark";

type Props = {
  onCreate: (name: string) => Promise<boolean>;
  onClose: () => void;
  /** offer "DJ AI" as the first way to make the playlist; called when it is chosen (the window then glides away) */
  onDjAi?: () => void;
  title?: string;
  placeholder?: string;
  failedLabel?: string;
  createLabel?: string;
};

const ANIM_MS = 1150;
const EXIT_MS = 260;

export function NewPlaylistPop({
  onCreate,
  onClose,
  onDjAi,
  title = "New playlist",
  placeholder = "Playlist name",
  failedLabel = "Couldn't create the playlist — try again",
  createLabel = "Create playlist",
}: Props) {
  const tr = useTr();
  const [name, setName] = useState("");
  /** which way: the two choices (only when DJ AI is offered), or the name field */
  const [step, setStep] = useState<"choose" | "name">(onDjAi ? "choose" : "name");
  const [phase, setPhase] = useState<"idle" | "done" | "closing">("idle");
  const [failed, setFailed] = useState(false);
  const [runId, setRunId] = useState(0);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const list = timers.current;
    return () => list.forEach((t) => window.clearTimeout(t));
  }, []);

  const close = () => {
    setPhase("closing");
    timers.current.push(window.setTimeout(onClose, EXIT_MS));
  };

  const submit = () => {
    const clean = name.trim();
    if (!clean || phase !== "idle") return;
    setFailed(false);
    setRunId((n) => n + 1);
    setPhase("done");
    const minAnim = new Promise<void>((resolve) => timers.current.push(window.setTimeout(resolve, ANIM_MS)));
    const save = onCreate(clean).catch(() => false);
    void Promise.all([save, minAnim]).then(([ok]) => {
      if (ok) {
        close();
      } else {
        setPhase("idle");
        setFailed(true);
      }
    });
  };

  const ready = name.trim().length > 0;
  const closing = phase === "closing";

  return createPortal(
    <div
      className={`sb-wz-backdrop${closing ? " is-closing" : ""}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && phase === "idle") close();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && phase === "idle") close();
      }}
    >
      <form
        className={`sb-wz-panel sb-npl${closing ? " is-closing" : ""}`}
        style={{ maxWidth: 380 }}
        role="dialog"
        aria-label={tr(title)}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <p className="sb-npl-title">
          {onDjAi && step === "name" ? (
            <button type="button" className="sb-npl-back" onClick={() => setStep("choose")} disabled={phase !== "idle"} aria-label={tr("Back")} title={tr("Back")}>
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12.5 4.5L7 10l5.5 5.5" />
              </svg>
            </button>
          ) : null}
          {tr(title)}
        </p>
        {step === "choose" && onDjAi ? (
          <div className="sb-npl-choices">
            <button
              type="button"
              className="sb-npl-choice sb-npl-choice--ai"
              onClick={() => {
                onDjAi();
                close();
              }}
            >
              <DjCreatorAiWarmSpark className="sb-npl-choice-ico" />
              <span className="sb-npl-choice-text">
                <b>{tr("DJ AI")}</b>
                <small>{tr("Tell it the vibe — it builds the playlist for you")}</small>
              </span>
            </button>
            <button type="button" className="sb-npl-choice" onClick={() => setStep("name")}>
              <span className="sb-npl-choice-ico sb-npl-choice-ico--hand" aria-hidden>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 20l4.2-1 10.3-10.3a2 2 0 0 0 0-2.8l-.4-.4a2 2 0 0 0-2.8 0L5 15.8 4 20z" />
                  <path d="M13.5 7.5l3 3" />
                </svg>
              </span>
              <span className="sb-npl-choice-text">
                <b>{tr("Create it yourself")}</b>
                <small>{tr("Name it, then add the songs you want")}</small>
              </span>
            </button>
          </div>
        ) : (
        <div className="sb-npl-field">
          <input
            autoFocus
            dir="auto"
            type="text"
            value={name}
            maxLength={80}
            onChange={(e) => {
              setName(e.target.value);
              if (failed) setFailed(false);
            }}
            placeholder={tr(placeholder)}
            readOnly={phase !== "idle"}
            className="sb-npl-input"
          />
          <button
            key={runId}
            type="submit"
            className={`sb-npl-go${ready ? " is-ready" : ""}${phase !== "idle" ? " is-done" : ""}`}
            disabled={!ready || phase !== "idle"}
            aria-label={tr(createLabel)}
            title={tr(createLabel)}
          >
            <svg viewBox="0 0 40 40" fill="none" aria-hidden>
              <circle className="sb-npl-ring" cx="20" cy="20" r="17" pathLength="1" />
              <path className="sb-npl-tick" d="M12.5 20.8l5.2 5.2 9.8-11.2" pathLength="1" />
            </svg>
          </button>
        </div>
        )}
        {failed && step === "name" ? <p className="sb-npl-fail">{tr(failedLabel)}</p> : null}
      </form>
    </div>,
    document.body,
  );
}
