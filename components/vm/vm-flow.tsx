"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { IconChevronForward } from "@/components/vm/vm-icons";

/**
 * THE FLOW (owner 2026-11-18, an experiment: "the background does not move, only the elements rise from below as I scroll down and go back as I scroll up — like the iPhone's Control Center —
 * with an effect, not a plain rise; few frames; and what is not always needed sits behind an arrow, closed").
 *
 *  · `VmFlow`  — a page whose background is FIXED (the song's colours, or a person's) while its parts scroll over it, a part at a time (CSS scroll snapping, gentle).
 *  · `Rise`    — one element of the page: it comes up from below as it enters the screen (a small overshoot, so it settles instead of just sliding), and leaves upward and fades as it
 *                goes out. The motion is SCRUBBED by the scroll position, so scrolling back plays it backwards. Only transform + opacity (cheap on a phone); nothing at rest keeps a transform.
 *  · `VmFold`  — a row with an arrow that opens the details that are not needed every time; closed by default.
 * Nothing here touches playback, the network or any stored data.
 */

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** easeOutBack: goes a little past 1 and settles — the "not a plain rise" part (c1 small: a hint of spring, not a bounce) */
export function easeOutBack(t: number): number {
  const c1 = 1.1;
  const c3 = c1 + 1;
  const x = clamp01(t) - 1;
  return 1 + c3 * x * x * x + c1 * x * x;
}

export type RiseState = { y: number; s: number; o: number };

const ZONE_IN = 90;
const ZONE_OUT = 56;

/**
 * Where one element is drawn, from where it sits (`slot`, its untransformed box) and the visible area (`view`). Pure.
 *  · entering: while its top is within `zone` px above the bottom edge it rises from 64 px below, grows from 93 % to 100 % and fades in (with the small overshoot);
 *  · leaving: while its bottom is within `zone` px of the top edge it drifts up 34 px, shrinks 6 % and fades out.
 * An element that is fully inside the visible area is exactly at rest (y 0, scale 1, opacity 1).
 */
export function riseState(slot: { top: number; bottom: number }, view: { top: number; bottom: number }): RiseState {
  // the zones are short on purpose: an element that sits where its page puts it (a heading at the top, the last row at the bottom) is always fully drawn — only an element that is really on its way in or out is not
  const pin = clamp01((view.bottom - slot.top) / ZONE_IN);
  const pout = clamp01(1 - (slot.bottom - view.top) / ZONE_OUT);
  const e = easeOutBack(pin);
  return {
    y: (1 - e) * 64 - pout * 34,
    s: 0.93 + 0.07 * e - pout * 0.06,
    o: clamp01(pin * 1.25) * (1 - pout * 0.92),
  };
}

function paint(root: HTMLElement, scroller: HTMLElement, reduced: boolean): void {
  const slots = root.querySelectorAll<HTMLElement>("[data-rise]");
  if (reduced) {
    slots.forEach((s) => {
      const inner = s.firstElementChild as HTMLElement | null;
      if (inner) {
        inner.style.transform = "";
        inner.style.opacity = "";
      }
    });
    return;
  }
  const cr = scroller.getBoundingClientRect();
  const view = { top: cr.top + 40, bottom: cr.bottom }; // the top bar is above 40 px; the tab bar covers the lower edge, where the next page's elements come up from
  const rects = Array.from(slots, (s) => s.getBoundingClientRect()); // all reads first, then all writes: one layout per frame
  slots.forEach((s, i) => {
    const inner = s.firstElementChild as HTMLElement | null;
    if (!inner) return;
    const st = riseState(rects[i]!, view);
    const rest = Math.abs(st.y) < 0.2 && st.s > 0.9995 && st.o > 0.995;
    inner.style.transform = rest ? "" : `translate3d(0, ${st.y.toFixed(1)}px, 0) scale(${st.s.toFixed(4)})`;
    inner.style.opacity = st.o > 0.995 ? "" : st.o.toFixed(3);
  });
}

/** the page: a fixed background in `tone` (the CSS variables --vm-t1 / --vm-t2) and the parts that scroll over it */
export function VmFlow({ tone, snap, children }: { tone: CSSProperties; /** screen by screen: every part is a full screen and the scroll always lands on one (a swipe moves one screen; you cannot stop in between) */ snap?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState({ count: 0, active: 0 });
  useIsoLayoutEffect(() => {
    const root = ref.current;
    const scroller = document.getElementById("vm-scroll");
    if (!root || !scroller) return;
    const mq = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    let raf = 0;
    const run = (first = false) => {
      raf = 0;
      // the height of ONE screen: the scroll area without the tab bar (the parts are exactly this tall, so the scroll lands on each one's start)
      const dock = parseFloat(getComputedStyle(scroller).paddingBottom) || 0;
      root.style.setProperty("--vm-snap-h", `${Math.max(320, Math.round(scroller.clientHeight - dock))}px`);
      paint(root, scroller, !!mq?.matches);
      if (first) return;
      // which page we are on (the nearest part start) — for the dots at the edge
      const secs = root.querySelectorAll<HTMLElement>(".vm-flow-sec");
      const top = scroller.getBoundingClientRect().top;
      let best = 0;
      let bestD = Infinity;
      secs.forEach((el, i) => {
        const d = Math.abs(el.getBoundingClientRect().top - top);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      setPages((p) => (p.count === secs.length && p.active === best ? p : { count: secs.length, active: best }));
    };
    const schedule = () => {
      if (!raf) raf = window.requestAnimationFrame(() => run());
    };
    run(true);
    schedule();
    scroller.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null; // a part that appears later (the people row) changes the page's height
    ro?.observe(root);
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      scroller.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      ro?.disconnect();
    };
  }, []);
  return (
    <div className="vm-flow" style={tone} ref={ref} data-snap={snap ? "" : undefined}>
      <div className="vm-flow-bg" aria-hidden />
      {snap && pages.count > 1 ? (
        <nav className="vm-pgdots">
          {Array.from({ length: pages.count }, (_, i) => (
            <button
              key={i}
              type="button"
              className="vm-pgdot"
              data-on={i === pages.active ? "" : undefined}
              aria-label={`${i + 1} / ${pages.count}`}
              aria-current={i === pages.active ? "true" : undefined}
              onClick={() => {
                const sec = ref.current?.querySelectorAll<HTMLElement>(".vm-flow-sec")[i];
                const sc = document.getElementById("vm-scroll");
                if (sec && sc) sc.scrollTo({ top: sc.scrollTop + sec.getBoundingClientRect().top - sc.getBoundingClientRect().top, behavior: "smooth" });
              }}
            />
          ))}
        </nav>
      ) : null}
      {children}
    </div>
  );
}

/** one part of the page (the scroll settles on its start); `tall` = at least a screen high, so a part is a "page" */
export function VmFlowSection({ children, tall, fill, label }: { children: ReactNode; tall?: boolean; /** the part is a column whose last element (a `Rise fill`) takes the rest of the screen */ fill?: boolean; label?: string }) {
  return (
    <section className="vm-flow-sec" data-tall={tall ? "" : undefined} data-fill={fill ? "" : undefined} aria-label={label}>
      {children}
    </section>
  );
}

/** one element that rises into place; `enter` (0, 1, 2…) also plays a short staggered entrance when the page opens */
export function Rise({ children, enter, fill, className }: { children: ReactNode; enter?: number; /** takes the rest of the screen (inside a `VmFlowSection fill`) */ fill?: boolean; className?: string }) {
  return (
    <div data-rise data-fill={fill ? "" : undefined} className={`vm-rise${className ? ` ${className}` : ""}`} style={enter === undefined ? undefined : ({ ["--vm-i" as string]: enter } as CSSProperties)} data-enter={enter === undefined ? undefined : ""}>
      <div className="vm-rise-in">{children}</div>
    </div>
  );
}

/** a row with an arrow that opens what is not needed every time (an e-mail, a time zone…); closed until it is pressed */
export function VmFold({ label, summary, children }: { label: string; summary?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="vm-fold" data-open={open ? "" : undefined}>
      <button type="button" className="vm-fl-row vm-fold-head" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
        <span className="vm-fl-text">
          {label}
          {summary ? <small className="vm-bdi">{summary}</small> : null}
        </span>
        <IconChevronForward className="vm-fold-chev" />
      </button>
      <div className="vm-fold-body" id={id} role="region" aria-label={label} inert={!open}>
        <div className="vm-fold-inner">{children}</div>
      </div>
    </div>
  );
}

/** a label and its value, on one line — the rows inside a fold */
export function VmKv({ label, value, dir }: { label: string; value: ReactNode; dir?: "ltr" }) {
  return (
    <div className="vm-kv">
      <span>{label}</span>
      <b className="vm-bdi" dir={dir}>{value}</b>
    </div>
  );
}
