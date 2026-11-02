"use client";

/**
 * PlayerAutoCompact — scroll and the player shrinks UP into a slim bar (cover, title · artist, the transport icons where they are, the
 * volume at the right edge); scroll back and it opens again (owner 2026-10-18). It only sets attributes on <html> — every visual change is CSS
 * (`(da)`/`(dd)`/`(de)` in globals.css), so the playback chain is untouched. Back to exactly the old player in a second:
 * `localStorage.setItem("syncbiz:compactPlayer", "off")` (or the constant below).
 *
 * Trigger (owner 2026-10-19: "the scroll should work no matter where it happens"): a wheel DOWN anywhere on the page shrinks the player; a wheel UP
 * anywhere opens it again — unless that wheel is still scrolling a list that is not at its top (the list scrolls first, then the player opens).
 * Keyboard / scrollbar / touch scrolling of the song list or the search results are covered by the scroll listener (shrink only while moving down).
 * Nothing happens while a dialog is open, and a wheel over the player's queue panel (open or folded) is ignored (owner 2026-10-22).
 *
 * While it glides, `data-sb-pc-moving` switches the live glass (backdrop blur) off for the glide only — every frame re-laid-out the deck and re-blurred everything behind it (jerky, owner 2026-11-02).
 * The morph is choreographed: `data-sb-player="compact"` = geometry, flips at once and glides; `data-sb-pc-swap` = the title block + the timeline (the
 * only things that change place) fade out while `data-sb-pc-row` (their slim-bar placement) is switched; then they fade back in.
 * Renders null.
 */

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const ENABLED = true;
const SCROLLERS = ".sb-glow-scroll, .sb-search-panel";
const ENTER_AT = 70; // px scrolled (list / search results) before it shrinks
const LEAVE_AT = 14; // px from the top before it opens again
const WHEEL_MIN = 4; // ignore tiny wheel / trackpad noise
const SWAP_OUT_MS = 150; // content fade-out (CSS: 140ms) → then the layout switches
const SWAP_IN_SHRINK_MS = 270; // shrinking: content returns once the bar is ~85% down
const SWAP_IN_GROW_MS = 380; // growing: content returns once the bar is nearly full height
const LOCK_MS = 900; // no new flip until the glide + fade have finished
const DIALOGS = ".sb-wz-backdrop, [role='dialog'], [aria-modal='true']";
const QUEUE_ASIDE = ".library-deck-slot-aside"; // the player's own queue panel (open or folded to its cover strip): scrolling it is its own business

/** the nearest ancestor (of the wheel's target) that can still scroll UP — a list that is not at its top */
function scrollsUp(target: EventTarget | null): boolean {
  let el = target instanceof Element ? target : null;
  while (el && el !== document.documentElement) {
    if (el instanceof HTMLElement && el.scrollTop > LEAVE_AT) {
      const oy = getComputedStyle(el).overflowY;
      if (oy === "auto" || oy === "scroll") return true;
    }
    el = el.parentElement;
  }
  return false;
}

/**
 * Scroll smoothness (owner 2026-10-19, "the scroll is not smooth at all"): measured — the song tiles' real-glass chips (the YouTube corner badge, the
 * playlist glyph) are `backdrop-filter` nodes, and with them on, every scroll frame had to copy + blur the whole list surface once per chip
 * (58 ms/frame → 8 ms/frame with them off). While the list moves, its own `data-scrolling` attribute switches that blur off (CSS block (df)/(dh)); it comes
 * back 180 ms after the last scroll / wheel event. Pure styling — nothing else is touched.
 */
const MANAGEMENT_ROUTE = /^\/(dashboard|access-control|owner\/control-room)(\/|$)/;

function useScrollingFlag(off: boolean) {
  useEffect(() => {
    if (off) return;
    const timers = new WeakMap<Element, ReturnType<typeof setTimeout>>();
    // the flag lives on the SCROLLER (not on <html>): toggling an attribute on the root re-evaluated the styles of the whole page at every scroll start / stop
    const mark = (scroller: Element) => {
      if (!scroller.hasAttribute("data-scrolling")) scroller.setAttribute("data-scrolling", "1");
      const t = timers.get(scroller);
      if (t) clearTimeout(t);
      timers.set(scroller, setTimeout(() => scroller.removeAttribute("data-scrolling"), 180));
    };
    const SC = ".sb-glow-scroll, .sb-search-panel";
    const onScroll = (e: Event) => {
      const t = e.target;
      if (!(t instanceof HTMLElement) || !t.matches(SC)) return;
      mark(t);
      // the list's top edge fades only while it is scrolled (at rest the first heading is fully visible); CSS (dh)
      const scrolled = t.scrollTop > 2;
      if (scrolled !== t.hasAttribute("data-scrolled")) t.toggleAttribute("data-scrolled", scrolled);
    };
    const onWheel = (e: WheelEvent) => {
      const t = e.target instanceof Element ? e.target.closest(SC) : null;
      if (t) mark(t);
    };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    document.addEventListener("wheel", onWheel, { capture: true, passive: true });
    return () => {
      document.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("wheel", onWheel, true);
      document.querySelectorAll("[data-scrolling]").forEach((el) => el.removeAttribute("data-scrolling"));
    };
  }, [off]);
}

export function PlayerAutoCompact(): null {
  const pathname = usePathname();
  // the management pages (Control Room …) hide the player — nothing to shrink there, and no attribute flips while the operator uses them
  const management = MANAGEMENT_ROUTE.test(pathname ?? "");
  useScrollingFlag(management);
  useEffect(() => {
    const root = document.documentElement;
    const ATTRS = ["data-sb-player", "data-sb-pc-swap", "data-sb-pc-row", "data-sb-pc-moving"];
    const clearAll = () => ATTRS.forEach((a) => root.removeAttribute(a));
    clearAll(); // a new page always starts with the full player
    if (!ENABLED || management) return;
    try {
      if (localStorage.getItem("syncbiz:compactPlayer") === "off") return;
    } catch {
      /* ignore */
    }
    let compact = false;
    let lockUntil = 0;
    let timers: ReturnType<typeof setTimeout>[] = [];
    const later = (fn: () => void, ms: number) => timers.push(setTimeout(fn, ms));
    let pendingEl: HTMLElement | null = null; // a scroll that arrived while the glide was still running — judged again once it ends
    const lastY = new WeakMap<HTMLElement, number>();
    const set = (on: boolean) => {
      compact = on;
      lockUntil = performance.now() + LOCK_MS;
      timers.forEach(clearTimeout);
      timers = [];
      root.setAttribute("data-sb-pc-moving", "1"); // the live glass is off while the bar glides (CSS: smooth glide, owner 2026-11-02) …
      root.setAttribute("data-sb-pc-swap", "1"); // the title block + timeline fade out …
      if (on) root.setAttribute("data-sb-player", "compact"); // … while the geometry starts gliding at once
      else root.removeAttribute("data-sb-player");
      later(() => {
        // … and their placement switches while they are invisible
        if (on) root.setAttribute("data-sb-pc-row", "1");
        else root.removeAttribute("data-sb-pc-row");
      }, SWAP_OUT_MS);
      later(() => root.removeAttribute("data-sb-pc-swap"), on ? SWAP_IN_SHRINK_MS : SWAP_IN_GROW_MS);
      later(() => root.removeAttribute("data-sb-pc-moving"), LOCK_MS); // … and comes back when the glide has finished
      later(() => {
        const el = pendingEl;
        pendingEl = null;
        if (el) evaluate(el, true);
      }, LOCK_MS + 20);
    };
    // `late` = judged after the glide ended for a scroll that came during it. Only shrinking is decided late: while the bar shrinks the list gets
    // taller and the browser clamps its scrollTop (a short list lands on 0) — that is not the user scrolling up, so it must never re-open the player.
    const evaluate = (el: HTMLElement, late = false) => {
      const y = el.scrollTop;
      const down = y > (lastY.get(el) ?? 0);
      lastY.set(el, y);
      if (!compact && down && y > ENTER_AT) set(true);
      else if (compact && !late && y < LEAVE_AT) set(false);
    };
    const onScroll = (e: Event) => {
      const el = e.target;
      if (!(el instanceof HTMLElement) || !el.matches(SCROLLERS)) return;
      if (performance.now() < lockUntil) {
        pendingEl = el;
        return;
      }
      evaluate(el);
    };
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaY) < WHEEL_MIN) return; // pinch-zoom / noise
      if (performance.now() < lockUntil) return;
      if (document.querySelector(DIALOGS)) return;
      if (e.target instanceof Element && e.target.closest(QUEUE_ASIDE)) return; // owner 2026-10-22: wheeling over the queue never shrinks / opens the player
      if (e.deltaY > 0 && !compact) set(true);
      else if (e.deltaY < 0 && compact && !scrollsUp(e.target)) set(false);
    };
    document.addEventListener("scroll", onScroll, true);
    document.addEventListener("wheel", onWheel, { passive: true, capture: true });
    return () => {
      document.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("wheel", onWheel, true);
      timers.forEach(clearTimeout);
      clearAll();
    };
  }, [pathname, management]);
  return null;
}
