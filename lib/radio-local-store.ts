/**
 * Client-side localStorage cache for radio stations.
 * Used as fallback when API returns empty (e.g. Railway ephemeral fs).
 * SSR-safe: returns [] when window is undefined.
 */

import type { RadioStream } from "./source-types";

const STORAGE_KEY = "syncbiz-radio-local";

export function getRadioStationsLocal(): RadioStream[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((r): r is RadioStream => r && typeof r === "object" && typeof (r as RadioStream).id === "string" && typeof (r as RadioStream).url === "string") : [];
  } catch {
    return [];
  }
}

export function setRadioStationsLocal(stations: RadioStream[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stations));
  } catch {
    /* ignore */
  }
}

export function addRadioStationLocal(station: RadioStream): void {
  const list = getRadioStationsLocal();
  if (list.some((s) => s.id === station.id)) return;
  setRadioStationsLocal([...list, station]);
}

export function removeRadioStationLocal(id: string): void {
  setRadioStationsLocal(getRadioStationsLocal().filter((s) => s.id !== id));
}
