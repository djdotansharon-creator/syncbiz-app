"use client";

import { BranchMap, type MapBranch, type MapRegions } from "@/components/control-room/branch-map";
import { BranchMapV2 } from "@/components/control-room/branch-map-v2";

/**
 * CONTROL ROOM — the light built-in map (owner decision 2026-10-11: no Google Maps tiles in the Control Room).
 * 2026-10-19: v2 (rounded outlines, regions fly away on zoom, long-hover bubble) is the default; the CLASSIC map (branch-map.tsx, untouched) is one switch away:
 * `localStorage.setItem("syncbiz:crMap", "classic")` (remove the key to return to v2). Same props for both.
 */
function classicRequested(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem("syncbiz:crMap") === "classic";
  } catch {
    return false;
  }
}

export function NetworkMap({ branches, selectedId, onSelect, regions, height, controlsSlot, colorMode, pinnedId }: { branches: MapBranch[]; selectedId: string | null; onSelect: (id: string) => void; regions?: MapRegions; height?: number | string; controlsSlot?: HTMLElement | null; colorMode?: "brand" | "calm"; /** a branch whose white bubble stays open (v2 map only) */ pinnedId?: string | null }) {
  if (classicRequested()) return <BranchMap branches={branches} selectedId={selectedId} onSelect={onSelect} regions={regions} height={height} controlsSlot={controlsSlot} />;
  return <BranchMapV2 branches={branches} selectedId={selectedId} onSelect={onSelect} regions={regions} height={height} controlsSlot={controlsSlot} colorMode={colorMode} pinnedId={pinnedId} />;
}
