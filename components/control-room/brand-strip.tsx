"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Control Room — the brand strip (owner 2026-10-20). ONE row of brand chips; when they do not all fit, the ones that do not are NOT scrolled sideways: a "more" button at the
 * end of the row (a chevron) opens the rest in rows right below it, the page below glides down, and the button turns into "less".
 * The chips that DO fit are the only ones in the row, so the row can sit exactly in the CENTRE of the space (owner 2026-10-21: it was stuck to the start when they overflowed).
 * Fitting is decided on an invisible RULER that holds every chip at its natural width (re-measured when the strip or any chip changes size — a logo finishing loading …).
 * Several brands can be chosen at once (each chosen chip carries a ✓ — the chips themselves decide what is chosen); a dot on the button says a chosen brand is inside the hidden ones.
 * Styles: `.cr-strip*` in globals.css.
 */
export type StripItem = { id: string; node: ReactNode; chosen?: boolean; /** not a brand (the "+" that adds one): sits in the flow like a chip but is never counted as a hidden brand */ plain?: boolean; /** stays at the start of the strip, outside the centred / clipped row (the "All" chip) */ pinned?: boolean };

const GAP = 8; // keep in step with `.cr-strip-row { gap }`
const MORE_W = 40; // the "more" button

export function BrandStrip({ items, label, moreLabel, lessLabel, trailing }: { items: StripItem[]; label: string; moreLabel: string; lessLabel: string; /** always visible at the end of the strip — never counted as a hidden brand (unused now: the "+" is the last item) */ trailing?: ReactNode }) {
  const topRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [measured, setMeasured] = useState(false);
  const [open, setOpen] = useState(false);
  const itemsKey = items.map((i) => i.id).join("|");

  useEffect(() => {
    const top = topRef.current, ruler = rulerRef.current;
    if (!top || !ruler || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const kids = Array.from(ruler.children) as HTMLElement[];
      const widths = kids.map((el) => ({ id: el.dataset.rulerId ?? "", w: el.getBoundingClientRect().width }));
      const fixed = Array.from(top.querySelectorAll<HTMLElement>(".cr-strip-pin, .cr-strip-trailing")).reduce((s, el) => s + el.getBoundingClientRect().width + GAP, 0);
      const avail = top.clientWidth - fixed - 4; // 4 = the row's own padding
      const total = widths.reduce((s, x, i) => s + x.w + (i ? GAP : 0), 0);
      let out: string[] = [];
      if (total > avail) {
        const room = avail - MORE_W - GAP; // the "more" button takes its place
        let used = 0, fits = true;
        out = [];
        widths.forEach((x) => {
          const next = used + x.w + (used ? GAP : 0);
          if (fits && next <= room) used = next;
          else { fits = false; out.push(x.id); }
        });
      }
      setHidden((cur) => (cur.join("|") === out.join("|") ? cur : out));
      setMeasured(true);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(top);
    ruler.querySelectorAll("[data-ruler-id]").forEach((el) => ro.observe(el));
    top.querySelectorAll(".cr-strip-pin, .cr-strip-trailing").forEach((el) => ro.observe(el));
    return () => ro.disconnect();
  }, [itemsKey]);

  const movable = items.filter((i) => !i.pinned);
  const hiddenItems = movable.filter((i) => hidden.includes(i.id));
  const visibleItems = movable.filter((i) => !hidden.includes(i.id));
  const hiddenCount = hiddenItems.filter((i) => !i.plain).length; // brands only — the "+" is not one
  const showMore = hiddenItems.length > 0;
  const isOpen = open && showMore;
  const chosenInside = hiddenItems.some((i) => i.chosen);

  return (
    <div className="cr-strip" role="group" aria-label={label} data-some-chosen={items.some((i) => i.chosen) ? "1" : undefined}>
      <div ref={topRef} className="cr-strip-top">
        {items.filter((i) => i.pinned).map((i) => <div key={i.id} className="cr-strip-pin">{i.node}</div>)}
        <div className="cr-strip-row" data-ready={measured ? "1" : "0"}>
          {visibleItems.map((i) => <div key={i.id} className="cr-strip-item">{i.node}</div>)}
        </div>
        {showMore ? (
          <button type="button" className={`cr-strip-more${isOpen ? " is-open" : ""}`} aria-expanded={isOpen} title={`${isOpen ? lessLabel : moreLabel} (${hiddenCount})`} aria-label={`${isOpen ? lessLabel : moreLabel} (${hiddenCount})`} onClick={() => setOpen((v) => !v)}>
            {chosenInside && !isOpen ? <i className="cr-strip-more-dot" aria-hidden /> : null}
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m3.5 6 4.5 4.5L12.5 6" /></svg>
          </button>
        ) : null}
        {trailing ? <div className="cr-strip-trailing">{trailing}</div> : null}
      </div>
      {/* the ruler: every movable chip at its natural width, invisible and inert — only used to decide what fits */}
      <div ref={rulerRef} className="cr-strip-ruler" aria-hidden inert>
        {movable.map((i) => <div key={i.id} data-ruler-id={i.id} className="cr-strip-item">{i.node}</div>)}
      </div>
      <div className={`cr-strip-panel${isOpen ? " is-open" : ""}`} inert={!isOpen}>
        <div className="cr-strip-panel-in">
          {hiddenItems.map((i) => <div key={i.id} className="cr-strip-item">{i.node}</div>)}
        </div>
      </div>
    </div>
  );
}
