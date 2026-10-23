"use client";

/**
 * GlassModal — the one centred dialog of the design line (share, edit, …): a frosted glass panel in the middle of
 * the screen over a blurred, only slightly darkened backdrop; optional stepper (steps slide in from the side the
 * user is heading to); entrance + exit animations. Styles: `.sb-wz-*` in globals.css.
 *
 * Closing: uncontrolled by default (animates out, then calls `onClose`). A host that wants to run its own work
 * after the exit passes `closing` (controlled) and handles `onClose` itself.
 */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTr } from "@/lib/i18n/use-tr";

export type GlassModalStep = { key: string; label: string };

type Props = {
  title: string;
  subtitle?: string | null;
  cover?: string | null;
  /** No cover image: show the first letter of the subtitle on a soft tile instead. */
  showInitial?: boolean;
  steps?: GlassModalStep[];
  step?: number;
  onStep?: (index: number) => void;
  footer?: ReactNode;
  /** Max panel width in px (default 640). */
  width?: number;
  /** Backdrop click closes (default true; the edit wizard turns it off so a stray click can't drop edits). */
  closeOnBackdrop?: boolean;
  closing?: boolean;
  onClose: () => void;
  children: ReactNode;
};

const EXIT_MS = 240;

export function GlassModal({
  title,
  subtitle,
  cover,
  showInitial = false,
  steps,
  step = 0,
  onStep,
  footer,
  width = 640,
  closeOnBackdrop = true,
  closing,
  onClose,
  children,
}: Props) {
  const tr = useTr();
  const [internalClosing, setInternalClosing] = useState(false);
  const isClosing = closing ?? internalClosing;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestClose = () => {
    if (closing !== undefined) {
      onClose();
      return;
    }
    if (internalClosing) return;
    setInternalClosing(true);
    timerRef.current = setTimeout(onClose, EXIT_MS);
  };
  const requestCloseRef = useRef(requestClose);
  useEffect(() => {
    requestCloseRef.current = requestClose;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // direction of the step change (render-phase state adjustment — allowed pattern)
  const [prevStep, setPrevStep] = useState(step);
  const [dir, setDir] = useState<1 | -1>(1);
  if (step !== prevStep) {
    setDir(step > prevStep ? 1 : -1);
    setPrevStep(step);
  }

  if (typeof document === "undefined") return null;
  const showSteps = !!steps && steps.length > 1;
  return createPortal(
    <div
      className={`sb-wz-backdrop${isClosing ? " is-closing" : ""}`}
      onMouseDown={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) requestClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={tr(title)}
        className={`sb-wz-panel${isClosing ? " is-closing" : ""}`}
        style={{ maxWidth: width }}
      >
        <header className="sb-wz-head">
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="sb-wz-cover" src={cover} alt="" draggable={false} />
          ) : showInitial && subtitle ? (
            <span className="sb-wz-cover sb-wz-cover--initial" aria-hidden>
              {subtitle.trim().charAt(0).toUpperCase()}
            </span>
          ) : null}
          <div className="sb-wz-titles">
            <p className="sb-wz-kicker">{tr(title)}</p>
            {subtitle ? <h2 className="sb-wz-name">{subtitle}</h2> : null}
          </div>
          <button type="button" className="sb-wz-x" onClick={requestClose} aria-label={tr("Close")} title={tr("Close")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </header>
        <div className="sb-wz-body">
          <div key={step} className={`sb-wz-step ${dir > 0 ? "from-right" : "from-left"}`}>
            {children}
          </div>
        </div>
        {showSteps ? (
          <nav className="sb-wz-pager" aria-label={tr("Steps")}>
            <div className="sb-wz-pg-row" style={{ "--i": step } as CSSProperties}>
              {steps!.map((st, i) => (
                <button key={st.key} type="button" className={i === step ? "is-on" : ""} onClick={() => onStep?.(i)} aria-current={i === step ? "step" : undefined} aria-label={tr(st.label)}>
                  <span className="sb-wz-pg-dot" />
                </button>
              ))}
              {/* ONE label that glides under the active circle (it is not part of the layout, so nothing is pushed) */}
              <span className="sb-wz-pg-label" aria-hidden>
                <span key={step}>{tr(steps![Math.min(step, steps!.length - 1)]!.label)}</span>
              </span>
            </div>
          </nav>
        ) : null}
        {footer ? <footer className="sb-wz-foot">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}
