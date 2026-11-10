"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The release headlines on the /whats-new page (owner 2026-11-10): NO frame — plain text that scrolls, with a soft blur at the top and at the bottom edge.
 * The text climbs up into the blur; the top blur appears only once the reader has scrolled, the bottom one only while more text follows; the scrollbar is hidden.
 * Plain text nodes only (never HTML). Fewer lines than fit → no scrolling and no blur at all.
 */
export function WhatsNewNotes({ paragraphs, items, label }: { paragraphs: string[]; items: string[]; label: string }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [edge, setEdge] = useState({ top: false, bottom: false });

  const sync = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const top = el.scrollTop > 2;
    const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 2;
    setEdge((p) => (p.top === top && p.bottom === bottom ? p : { top, bottom }));
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const id = requestAnimationFrame(sync);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(sync) : null;
    ro?.observe(el);
    return () => {
      cancelAnimationFrame(id);
      ro?.disconnect();
    };
  }, [sync]);

  return (
    <div className="sb-wn-wrap">
      <div ref={scrollRef} className="sb-wn-scroll" tabIndex={0} role="region" aria-label={label} onScroll={sync}>
        {paragraphs.map((p, i) => (
          <p key={`p${i}`} className="sb-wn-para">{p}</p>
        ))}
        {items.length > 0 ? (
          <ul className="sb-wn-list">
            {items.map((it, i) => (
              <li key={`i${i}`}>
                <span aria-hidden className="sb-wn-dot" />
                <span dir="auto">{it}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <span className={`sb-wn-fade sb-wn-fade--top${edge.top ? " is-on" : ""}`} aria-hidden />
      <span className={`sb-wn-fade sb-wn-fade--bot${edge.bottom ? " is-on" : ""}`} aria-hidden />
    </div>
  );
}
