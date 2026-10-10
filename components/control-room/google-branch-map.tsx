"use client";

import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps, onGoogleMapsAuthFailure, type GoogleNS } from "@/lib/google-maps-client";
import { DOT_FILL, type MapBranch } from "@/components/control-room/branch-map";

/**
 * CONTROL ROOM — Google Maps (owner-approved 2026-10-10): dark map, one marker per branch at its stored latitude /
 * longitude, colored by live status (playing pulses), click → open the branch, auto-fit to all the organization's
 * branches in ANY country, normal zoom / pan. Branches without coordinates are not drawn (they stay in the list).
 * If Google fails (no key / key refused / offline) → `onFailed` and the caller shows the built-in map.
 */

const PULSE_CSS = `@keyframes vonoMarkerPulse{0%{box-shadow:0 0 0 0 rgba(10,132,255,.55)}70%{box-shadow:0 0 0 12px rgba(10,132,255,0)}100%{box-shadow:0 0 0 0 rgba(10,132,255,0)}}`;
function ensurePulseCss() {
  if (document.getElementById("vono-marker-css")) return;
  const st = document.createElement("style");
  st.id = "vono-marker-css";
  st.textContent = PULSE_CSS;
  document.head.appendChild(st);
}

function styleDot(el: HTMLDivElement, b: MapBranch, selected: boolean) {
  const size = selected ? 18 : 14;
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  el.style.borderRadius = "9999px";
  el.style.background = DOT_FILL[b.status];
  el.style.border = selected ? "3px solid #ffffff" : "2px solid rgba(10,10,12,0.9)";
  el.style.boxShadow = "0 1px 4px rgba(0,0,0,0.6)";
  el.style.cursor = "pointer";
  el.style.animation = b.status === "playing" ? "vonoMarkerPulse 2s infinite" : "none";
  el.title = b.name;
}

export function GoogleBranchMap({
  branches,
  selectedId,
  onSelect,
  browserKey,
  mapId,
  onFailed,
  height = 560,
  fitZoomSingle = 15,
}: {
  branches: MapBranch[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  browserKey: string;
  mapId: string | null;
  onFailed: () => void;
  height?: number;
  fitZoomSingle?: number;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<GoogleNS>(null);
  const gRef = useRef<GoogleNS>(null);
  const markersRef = useRef(new Map<string, { marker: GoogleNS; el: HTMLDivElement }>());
  const fittedKeyRef = useRef<string>("");
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const [ready, setReady] = useState(false);

  // create the map once
  useEffect(() => {
    let cancelled = false;
    const off = onGoogleMapsAuthFailure(() => { if (!cancelled) onFailed(); });
    loadGoogleMaps(browserKey)
      .then(async (google: GoogleNS) => {
        if (cancelled || !hostRef.current) return;
        const { Map } = await google.maps.importLibrary("maps");
        await google.maps.importLibrary("marker");
        if (cancelled || !hostRef.current) return;
        gRef.current = google;
        mapRef.current = new Map(hostRef.current, {
          mapId: mapId ?? "DEMO_MAP_ID",
          colorScheme: "DARK",
          center: { lat: 31.6, lng: 34.9 },
          zoom: 7,
          disableDefaultUI: true,
          zoomControl: true,
          fullscreenControl: true,
          clickableIcons: false,
          gestureHandling: "greedy",
        });
        ensurePulseCss();
        setReady(true);
      })
      .catch(() => { if (!cancelled) onFailed(); });
    return () => { cancelled = true; off(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- created once per key / map id
  }, [browserKey, mapId]);

  // markers: add / update / remove; auto-fit when the SET of placed branches changes (not on every live status update)
  useEffect(() => {
    const google = gRef.current;
    const map = mapRef.current;
    if (!ready || !google || !map) return;
    const placed = branches.filter((b) => typeof b.latitude === "number" && typeof b.longitude === "number");
    const seen = new Set<string>();
    for (const b of placed) {
      seen.add(b.id);
      const position = { lat: b.latitude as number, lng: b.longitude as number };
      const existing = markersRef.current.get(b.id);
      if (existing) {
        existing.marker.position = position;
        styleDot(existing.el, b, b.id === selectedId);
        existing.marker.title = b.name;
        continue;
      }
      const el = document.createElement("div");
      styleDot(el, b, b.id === selectedId);
      const marker = new google.maps.marker.AdvancedMarkerElement({ map, position, content: el, title: b.name, gmpClickable: true });
      marker.addListener("click", () => onSelectRef.current(b.id));
      markersRef.current.set(b.id, { marker, el });
    }
    for (const [id, m] of markersRef.current) {
      if (!seen.has(id)) { m.marker.map = null; markersRef.current.delete(id); }
    }
    const key = placed.map((b) => `${b.id}:${b.latitude},${b.longitude}`).sort().join("|");
    if (key && key !== fittedKeyRef.current) {
      fittedKeyRef.current = key;
      if (placed.length === 1) {
        map.setCenter({ lat: placed[0].latitude, lng: placed[0].longitude });
        map.setZoom(fitZoomSingle);
      } else {
        const bounds = new google.maps.LatLngBounds();
        for (const b of placed) bounds.extend({ lat: b.latitude, lng: b.longitude });
        map.fitBounds(bounds, 48);
      }
    }
  }, [ready, branches, selectedId, fitZoomSingle]);

  return <div ref={hostRef} style={{ height }} className="w-full overflow-hidden rounded-xl bg-[#0f1115]" aria-label="Branch map" />;
}
