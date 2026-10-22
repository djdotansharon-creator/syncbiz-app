"use client";

/**
 * UndoToastHost — one slim glass toast at the bottom of the screen for "done · Undo" moments (owner 2026-10-18: deleting a
 * song no longer asks again; this is the safety net). Anyone can raise it with
 * `window.dispatchEvent(new CustomEvent("syncbiz:toast", { detail: { message, actionLabel, onAction } }))`.
 * Styles: `.sb-toast*` in globals.css.
 */

import { useEffect, useRef, useState } from "react";

type ToastDetail = { message: string; actionLabel?: string; onAction?: () => void | Promise<void> };
type Shown = ToastDetail & { id: number };

const SHOW_MS = 7000;
const EXIT_MS = 320;

export function UndoToastHost() {
  const [toast, setToast] = useState<Shown | null>(null);
  const [leaving, setLeaving] = useState(false);
  const idRef = useRef(0);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const clear = () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
    };
    const onToast = (e: Event) => {
      const d = (e as CustomEvent<ToastDetail>).detail;
      if (!d?.message) return;
      clear();
      idRef.current += 1;
      setLeaving(false);
      setToast({ ...d, id: idRef.current });
      timers.current.push(window.setTimeout(() => setLeaving(true), SHOW_MS));
      timers.current.push(window.setTimeout(() => setToast(null), SHOW_MS + EXIT_MS));
    };
    window.addEventListener("syncbiz:toast", onToast);
    return () => {
      window.removeEventListener("syncbiz:toast", onToast);
      clear();
    };
  }, []);

  if (!toast) return null;
  const dismiss = () => {
    setLeaving(true);
    timers.current.push(window.setTimeout(() => setToast(null), EXIT_MS));
  };
  return (
    <div key={toast.id} className={`sb-toast${leaving ? " is-leaving" : ""}`} role="status" aria-live="polite">
      <span className="sb-toast-msg">{toast.message}</span>
      {toast.onAction ? (
        <button
          type="button"
          className="sb-toast-act"
          onClick={() => {
            void toast.onAction?.();
            dismiss();
          }}
        >
          {toast.actionLabel ?? "Undo"}
        </button>
      ) : null}
    </div>
  );
}
