"use client";

/**
 * NewPlaylistPop — the small "name your playlist" window (owner 2026-10-18). A frosted glass card (same glass as the
 * other dialogs) with one frameless name field and a grey check at its right. Tap the check (or press Enter) and the
 * check turns green with a Face-ID-style stroke animation (ring draws, then the tick), the window glides away and
 * the playlist simply appears. Styles: `.sb-npl-*` in globals.css (block bv).
 *
 * `onCreate` resolves true when the playlist exists. The animation starts at once (feels instant); the window waits
 * for BOTH the animation and the save, and if the save fails the check resets with a short message.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTr } from "@/lib/i18n/use-tr";

type Props = {
  onCreate: (name: string) => Promise<boolean>;
  onClose: () => void;
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
  title = "New playlist",
  placeholder = "Playlist name",
  failedLabel = "Couldn't create the playlist — try again",
  createLabel = "Create playlist",
}: Props) {
  const tr = useTr();
  const [name, setName] = useState("");
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
        <p className="sb-npl-title">{tr(title)}</p>
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
        {failed ? <p className="sb-npl-fail">{tr(failedLabel)}</p> : null}
      </form>
    </div>,
    document.body,
  );
}
