"use client";

import { useEffect, useRef, useState } from "react";

/** The Control Room's add / edit wizards (branch, brand) are `GlassModal` dialogs with steps — the same dialog + pager as the Edit playlist wizard.
 *  The modal is controlled: Cancel / ✕ / Esc play the exit animation, then `after()` runs. */
export function useWizardClosing(after: () => void) {
  const [closing, setClosing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const afterRef = useRef(after);
  useEffect(() => { afterRef.current = after; });
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const request = () => {
    if (closing) return;
    setClosing(true);
    timer.current = setTimeout(() => { afterRef.current(); setClosing(false); }, 260);
  };
  return { closing, request };
}
