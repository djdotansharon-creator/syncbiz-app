"use client";

import { useEffect, useState } from "react";

/**
 * Control Room — Google Maps in the browser (owner-approved 2026-10-10). Loads the Maps JavaScript API ONCE with the
 * browser key from /api/control-room/map-config (runtime, no rebuild). Any problem (no key, network, key refused) →
 * callers keep the built-in map; nothing else depends on Google. Minimal local types — no new dependency.
 */

export type MapsConfig = { browserKey: string | null; mapId: string | null };

/* eslint-disable @typescript-eslint/no-explicit-any -- the Google Maps namespace is untyped here on purpose (no @types dependency) */
export type GoogleNS = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

let configPromise: Promise<MapsConfig> | null = null;
export function getMapsConfig(): Promise<MapsConfig> {
  if (!configPromise) {
    configPromise = fetch("/api/control-room/map-config", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<MapsConfig>) : { browserKey: null, mapId: null }))
      .catch(() => ({ browserKey: null, mapId: null }));
  }
  return configPromise;
}

export function useMapsConfig(): MapsConfig | null {
  const [cfg, setCfg] = useState<MapsConfig | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getMapsConfig().then((c) => { if (!cancelled) setCfg(c); });
    return () => { cancelled = true; };
  }, []);
  return cfg;
}

let loadPromise: Promise<GoogleNS> | null = null;
let authFailed = false;
const failListeners = new Set<() => void>();

/** Google calls this when the key is refused (wrong referrer / API not enabled) — the built-in map takes over. */
export function onGoogleMapsAuthFailure(cb: () => void): () => void {
  if (authFailed) cb();
  failListeners.add(cb);
  return () => { failListeners.delete(cb); };
}

export function loadGoogleMaps(browserKey: string): Promise<GoogleNS> {
  if (loadPromise) return loadPromise;
  loadPromise = new Promise((resolve, reject) => {
    const w = window as unknown as Record<string, unknown> & { google?: { maps?: unknown } };
    if (w.google?.maps) { resolve(w.google); return; }
    w.gm_authFailure = () => {
      authFailed = true;
      for (const cb of [...failListeners]) { try { cb(); } catch { /* ignore */ } }
    };
    w.__vonoGoogleMapsReady = () => resolve(w.google);
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(browserKey)}&v=weekly&loading=async&libraries=marker,places&callback=__vonoGoogleMapsReady`;
    s.async = true;
    s.onerror = () => { loadPromise = null; reject(new Error("Google Maps could not be loaded")); };
    document.head.appendChild(s);
  });
  return loadPromise;
}
