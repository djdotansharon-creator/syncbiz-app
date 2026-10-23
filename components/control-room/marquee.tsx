"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A single line of text that STAYS PUT when it fits and runs past like a ticker tape when it is too long for its box (owner 2026-10-19).
 * Direction follows the text: Hebrew starts at the right edge and runs the other way, English starts at the left. The text is doubled while it
 * runs so the loop has no gap; the speed is constant (≈ 38 px / s). Reduced-motion → plain ellipsis-free clipping.
 */
export function Marquee({ text, className = "" }: { text: string; className?: string }) {
  const box = useRef<HTMLSpanElement | null>(null);
  const one = useRef<HTMLSpanElement | null>(null);
  const [run, setRun] = useState<{ over: boolean; secs: number }>({ over: false, secs: 10 });
  useEffect(() => {
    const b = box.current, o = one.current;
    if (!b || !o || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const over = o.scrollWidth > b.clientWidth + 1;
      const secs = Math.max(6, Math.round((o.scrollWidth + 36) / 38));
      setRun((cur) => (cur.over === over && cur.secs === secs ? cur : { over, secs }));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(b);
    ro.observe(o);
    return () => ro.disconnect();
  }, [text]);
  const rtl = /[\u0590-\u05FF\u0600-\u06FF]/.test(text);
  return (
    <span ref={box} dir={rtl ? "rtl" : "ltr"} className={`cr-marquee ${run.over ? "is-running" : ""} ${className}`} style={run.over ? ({ ["--cr-mq-secs" as string]: `${run.secs}s` } as React.CSSProperties) : undefined} title={undefined}>
      <span className="cr-marquee-track">
        <span ref={one} className="cr-marquee-one">{text}</span>
        {run.over ? <span className="cr-marquee-one" aria-hidden>{text}</span> : null}
      </span>
    </span>
  );
}
