"use client";

import { useEffect, useRef } from "react";
import { reportMpvVideoSlot } from "@/lib/mpv-video-output";

/**
 * P0 Video V1 — the slot where MAIN shows the MPV picture (the SAME player as the sound). This element draws nothing
 * itself: it reports its on-screen rectangle to MAIN, which places the MPV window over it (hidden when unmounted,
 * zero-sized or the page is hidden). Positions are sent only when they change (layout events + a 1 s check for
 * animations) — never a flood.
 */
export function MpvVideoSurface({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    let last = "";
    const send = () => {
      const el = ref.current;
      const r = el?.getBoundingClientRect();
      const visible = !!r && r.width > 1 && r.height > 1 && document.visibilityState === "visible";
      const rect = visible && r ? { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) } : null;
      const key = rect ? `${rect.x},${rect.y},${rect.width},${rect.height}` : "none";
      if (key === last) return;
      last = key;
      reportMpvVideoSlot(rect);
    };
    send();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(send) : null;
    if (ref.current && ro) ro.observe(ref.current);
    window.addEventListener("resize", send);
    window.addEventListener("scroll", send, true);
    document.addEventListener("visibilitychange", send);
    const iv = setInterval(send, 1000);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", send);
      window.removeEventListener("scroll", send, true);
      document.removeEventListener("visibilitychange", send);
      clearInterval(iv);
      reportMpvVideoSlot(null);
    };
  }, []);
  return <div ref={ref} className={className} aria-hidden />;
}
