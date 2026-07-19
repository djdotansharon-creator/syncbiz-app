"use client";

import { useEffect } from "react";

/**
 * Registers the minimal service worker so the mobile app is installable as a
 * PWA (which is what lets it register as a Web Share Target — e.g. receiving a
 * shared Shazam link). No-op on browsers without service workers.
 */
export function PwaRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    if (typeof window !== "undefined" && window.location.protocol !== "https:" && window.location.hostname !== "localhost") {
      return; // SWs require a secure context
    }
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* registration is best-effort */
    });
  }, []);
  return null;
}
