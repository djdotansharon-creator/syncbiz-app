"use client";

/**
 * Top tabs — motion when the operator ADDS or REMOVES a tab from the gear menu (owner 2026-10-25):
 *   · a tab that is added drops in from above with a small bounce while the other tabs slide apart to make room for it;
 *   · a tab that is removed floats up and fades while the others slide together to close the gap.
 * Only a change the operator makes with the switches animates — never the first paint, a language change or a session that finishes loading.
 * Display-only: it animates the tab buttons' own boxes (Web Animations API), nothing else in the page and no navigation / playback code.
 */

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";

/** one animation's length; the leaving tab is dropped from the DOM a little after it ends */
const DURATION = 640;
/** the gap opens / closes smoothly (so the neighbours are SEEN sliding) … */
const SLIDE = "cubic-bezier(0.45, 0, 0.2, 1)";
/** … and the tab itself has a little spring */
const SPRING = "cubic-bezier(0.22, 1, 0.36, 1)";

/** while a tab animates, the nav carries data-tab-motion so the underline follows the active tab frame by frame instead of gliding behind (app-shell) */
function motion(el: HTMLElement, anims: Animation[]): void {
  const nav = el.closest("nav");
  nav?.setAttribute("data-tab-motion", "1");
  Promise.allSettled(anims.map((a) => a.finished)).then(() => nav?.removeAttribute("data-tab-motion"));
}

export type TabPhase = "stay" | "enter" | "leave";
export type TabEntry<T> = { item: T; phase: TabPhase };

const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * The tabs to draw: the current ones (+ which of them just ENTERED) with the ones that just LEFT kept in their old place until their exit
 * animation is over. `userToken` changes whenever the operator flips a switch — a change of the list without it is applied silently.
 */
export function useTabTransitions<T extends { href: string }>(items: T[], userToken: number): Array<TabEntry<T>> {
  const key = items.map((i) => i.href).join("|");
  const [prev, setPrev] = useState<{ key: string; items: T[]; token: number }>({ key, items, token: userToken });
  const [leaving, setLeaving] = useState<Array<{ item: T; index: number }>>([]);
  const [entering, setEntering] = useState<string[]>([]);
  if (prev.key !== key || prev.token !== userToken) {
    if (prev.key !== key && prev.token !== userToken) {
      setLeaving(prev.items.map((item, index) => ({ item, index })).filter(({ item }) => !items.some((c) => c.href === item.href)));
      setEntering(items.filter((c) => !prev.items.some((p) => p.href === c.href)).map((c) => c.href));
    }
    setPrev({ key, items, token: userToken });
  }
  useEffect(() => {
    if (leaving.length === 0 && entering.length === 0) return;
    const t = setTimeout(() => {
      setLeaving([]);
      setEntering([]);
    }, DURATION + 80);
    return () => clearTimeout(t);
  }, [leaving, entering]);

  const merged: Array<TabEntry<T>> = items.map((item) => ({ item, phase: entering.includes(item.href) ? "enter" : "stay" }));
  [...leaving]
    .sort((a, b) => a.index - b.index)
    .forEach((l) => merged.splice(Math.min(l.index, merged.length), 0, { item: l.item, phase: "leave" }));
  return merged;
}

/** a tab button; when it is new it plays the entrance once (width opens from 0 so its neighbours slide apart) */
export function MotionNavLink({ phase, ...props }: ComponentProps<typeof Link> & { phase: "stay" | "enter" }) {
  const ref = useRef<HTMLAnchorElement>(null);
  const played = useRef(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (phase !== "enter" || played.current || !el || reducedMotion()) return;
    played.current = true;
    const cs = getComputedStyle(el);
    const w = el.getBoundingClientRect().width;
    const pl = cs.paddingLeft;
    const pr = cs.paddingRight;
    el.style.overflow = "hidden";
    el.style.whiteSpace = "nowrap";
    const open = el.animate(
      [
        { width: "0px", paddingLeft: "0px", paddingRight: "0px", opacity: 0 },
        { width: `${w}px`, paddingLeft: pl, paddingRight: pr, opacity: 1 },
      ],
      { duration: 480, easing: SLIDE },
    );
    const pop = el.animate(
      [
        { transform: "translateY(-20px) scale(0.82)", easing: SPRING },
        { transform: "translateY(3px) scale(1.05)", offset: 0.58, easing: SPRING },
        { transform: "none" },
      ],
      { duration: DURATION },
    );
    motion(el, [open, pop]);
    const done = () => {
      el.style.overflow = "";
      el.style.whiteSpace = "";
    };
    pop.onfinish = done;
    pop.oncancel = done;
  }, [phase]);
  return <Link ref={ref} {...props} />;
}

/** the ghost of a tab that was just removed: it plays the exit (floats up, fades, its width closes) and is then dropped by the hook */
export function LeavingNavTab({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [skip] = useState(reducedMotion);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || skip) return;
    const cs = getComputedStyle(el);
    const w = el.getBoundingClientRect().width;
    el.style.overflow = "hidden";
    el.style.whiteSpace = "nowrap";
    const fade = el.animate(
      [
        { opacity: 1, transform: "none" },
        { opacity: 0, transform: "translateY(-16px) scale(0.88)" },
      ],
      { duration: 320, easing: SPRING, fill: "forwards" },
    );
    const close = el.animate(
      [
        { width: `${w}px`, paddingLeft: cs.paddingLeft, paddingRight: cs.paddingRight },
        { width: "0px", paddingLeft: "0px", paddingRight: "0px" },
      ],
      { duration: 460, delay: 160, easing: SLIDE, fill: "both" },
    );
    motion(el, [fade, close]);
  }, [skip]);
  if (skip) return null;
  return (
    <span ref={ref} className={className} aria-hidden style={{ pointerEvents: "none", display: "inline-block" }}>
      {children}
    </span>
  );
}
